import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";

/**
 * POST /api/payments/simulate { invoiceId }
 * Demo-only shortcut for the dashboard "Simulate Paid" button.
 * Performs the same deterministic PAID transition + stopping rule as a
 * verified webhook, without accepting unsigned webhooks (see SEC-01).
 * Disable in real deployments: ALLOW_DEMO_SIMULATE=false
 */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_DEMO_SIMULATE === "false") {
    return NextResponse.json({ error: "Demo simulation disabled" }, { status: 403 });
  }
  await initDb();
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  if (!body.invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  const r = await db.execute({ sql: "SELECT id, status FROM invoices WHERE id = ?", args: [body.invoiceId] });
  if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const eventId = `evt_sim_${Date.now()}`;
  const seen = await db.execute({ sql: "SELECT id FROM processed_webhooks WHERE id = ?", args: [eventId] });
  if (seen.rows.length > 0) return NextResponse.json({ ok: true, deduped: true });

  const now = new Date().toISOString();
  await db.execute({ sql: "INSERT INTO processed_webhooks (id, created_at) VALUES (?, ?)", args: [eventId, now] });
  await db.execute({ sql: "UPDATE invoices SET status='PAID', promised_date=NULL, updated_at=? WHERE id=?", args: [now, body.invoiceId] });
  await db.execute({
    sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound', ?, 0, ?)",
    args: [body.invoiceId, `🎉 Payment Successfully Recovered! Dhanyavaad! Invoice marked PAID. All reminders cancelled.`, now],
  });
  await audit(body.invoiceId, "PAYMENT_CAPTURED", `Demo simulation ${eventId} — STOPPING RULE: reminders cancelled`);
  return NextResponse.json({ ok: true, status: "PAID", stoppingRule: "reminders-cancelled", demo: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/razorpay";

/**
 * POST /api/webhook — Razorpay verified webhook.
 * Verifies HMAC-SHA256, enforces idempotency, triggers STOPPING RULE.
 */
export async function POST(req: NextRequest) {
  await initDb();
  const db = getDb();
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  let body: {
    event?: string;
    id?: string;
    payload?: { payment?: { entity?: { id?: string; notes?: { invoice_id?: string }; amount?: number } } };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // SEC-01: strict in production. "test"/missing signatures are dev-only.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (!signature || signature === "test") {
      await audit(null, "WEBHOOK_REJECTED", "Production: missing or test signature rejected");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Server misconfigured: RAZORPAY_WEBHOOK_SECRET not set" }, { status: 500 });
    }
  }
  // Dev-only bypass for E2E/demo (requires no secret configured OR explicit test sig in dev)
  const isTestBypass = !isProd && signature === "test";
  if (!isTestBypass && !verifyWebhookSignature(raw, signature)) {
    await audit(null, "WEBHOOK_REJECTED", "Invalid HMAC signature — possible tampering");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const eventId = body.id || `${body.event}-${Date.now()}`;
  const seen = await db.execute({ sql: "SELECT id FROM processed_webhooks WHERE id = ?", args: [eventId] });
  if (seen.rows.length > 0) return NextResponse.json({ ok: true, deduped: true });

  await db.execute({ sql: "INSERT INTO processed_webhooks (id, created_at) VALUES (?, ?)", args: [eventId, new Date().toISOString()] });

  if (body.event === "payment.captured" || body.event === "payment_link.paid" || body.event === "test.payment_captured") {
    const entity = body.payload?.payment?.entity;
    const invoiceId = entity?.notes?.invoice_id;
    if (!invoiceId) return NextResponse.json({ error: "Missing invoice_id in notes" }, { status: 400 });
    // Deterministic amount check: flag under/over-payments instead of blindly marking PAID
    if (typeof entity?.amount === "number") {
      const inv0 = await db.execute({ sql: "SELECT amount FROM invoices WHERE id = ?", args: [invoiceId] });
      const expected = inv0.rows.length ? Math.round(Number((inv0.rows[0] as unknown as { amount: number }).amount) * 100) : null;
      if (expected !== null && entity.amount !== expected) {
        await audit(invoiceId, "AMOUNT_MISMATCH", `Expected ₹${(expected / 100).toLocaleString("en-IN")} but got ₹${(entity.amount / 100).toLocaleString("en-IN")} — flagged for human review`);
        return NextResponse.json({ error: "Amount mismatch — flagged for review", expected, got: entity.amount }, { status: 400 });
      }
    }
    const now = new Date().toISOString();
    await db.execute({ sql: "UPDATE invoices SET status='PAID', promised_date=NULL, updated_at=? WHERE id=?", args: [now, invoiceId] });
    await db.execute({
      sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound', ?, 0, ?)",
      args: [invoiceId, `🎉 Payment Successfully Recovered! Dhanyavaad! Invoice marked PAID. All reminders cancelled.`, now],
    });
    await audit(invoiceId, "PAYMENT_CAPTURED", `Event ${eventId} (${body.event}) — STOPPING RULE: reminders cancelled`);
    return NextResponse.json({ ok: true, status: "PAID", stoppingRule: "reminders-cancelled" });
  }

  if (body.event === "payment.failed" || body.event === "payment_failed") {
    const invoiceId = body.payload?.payment?.entity?.notes?.invoice_id;
    await audit(invoiceId ?? null, "PAYMENT_FAILED", `Event ${eventId} — retained status for scheduled retry`);
    return NextResponse.json({ ok: true, logged: "payment_failed" });
  }

  await audit(null, "WEBHOOK_IGNORED", `Event ${body.event} ignored`);
  return NextResponse.json({ ok: true, ignored: body.event });
}

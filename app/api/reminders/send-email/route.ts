import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { generateReminder } from "@/lib/ai";
import { sendRecoveryEmail, emailSubject, emailBody } from "@/lib/email";
import { MAX_ATTEMPTS, type Invoice } from "@/lib/types";

/**
 * POST /api/reminders/send-email { invoiceId }
 * Second channel: email. Same guardrails as WhatsApp (shared 3-touch cap,
 * stopping rule on PAID). Resend when configured, mock-logged otherwise.
 */
export async function POST(req: NextRequest) {
  await initDb();
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const invoiceId = body.invoiceId;
  if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  const r = await db.execute({ sql: "SELECT * FROM invoices WHERE id = ?", args: [invoiceId] });
  if (r.rows.length === 0) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const inv = r.rows[0] as unknown as Invoice;

  if (inv.status === "PAID") {
    await audit(inv.id, "EMAIL_BLOCKED", "Stopping rule: invoice already PAID, email blocked");
    return NextResponse.json({ error: "Stopping rule: invoice already PAID" }, { status: 400 });
  }
  if (inv.status === "DISPUTED" || inv.status === "WRONG_CONTACT") {
    return NextResponse.json({ error: `Halted: status is ${inv.status}, needs human` }, { status: 400 });
  }
  if (inv.attempts >= MAX_ATTEMPTS) {
    await db.execute({ sql: "UPDATE invoices SET status='ESCALATED', updated_at=? WHERE id=?", args: [new Date().toISOString(), inv.id] });
    await audit(inv.id, "ESCALATED", `Max ${MAX_ATTEMPTS} touches exhausted (all channels) — routed to human`);
    return NextResponse.json({ error: "Max touches exhausted — escalated to human", escalated: true }, { status: 400 });
  }

  const attempt = inv.attempts + 1;
  const { text, source } = await generateReminder(inv, attempt);
  const subject = emailSubject(inv);
  const sent = await sendRecoveryEmail(inv, subject, emailBody(text, inv));
  const now = new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound-email', ?, ?, ?)",
    args: [inv.id, `✉️ To: ${sent.to}\nSubject: ${subject}\n\n${emailBody(text, inv)}`, attempt, now],
  });
  const nextStatus = attempt >= MAX_ATTEMPTS ? "ESCALATED" : inv.status === "PENDING" ? "OVERDUE" : inv.status;
  await db.execute({
    sql: "UPDATE invoices SET attempts=?, status=?, updated_at=? WHERE id=?",
    args: [attempt, nextStatus, now, inv.id],
  });
  await audit(inv.id, "EMAIL_SENT", `Touch #${attempt} via ${sent.mocked ? "mock" : "resend"} (${source} draft) → ${sent.to}`);
  return NextResponse.json({ ok: true, attempt, id: sent.id, mocked: sent.mocked, to: sent.to, subject, status: nextStatus });
}

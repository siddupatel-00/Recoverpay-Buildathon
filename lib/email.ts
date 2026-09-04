import type { Invoice } from "./types";

export interface EmailResult {
  id: string;
  mocked: boolean;
  to: string;
  subject: string;
}

/**
 * Second channel: email. Resend (fetch, zero-dep) when RESEND_API_KEY set,
 * else deterministic mock — logged to messages + audit like everything else.
 * Never throws: falls back to mock so merchant flow never breaks.
 */
export async function sendRecoveryEmail(
  invoice: Invoice & { email?: string | null },
  subject: string,
  body: string
): Promise<EmailResult> {
  const to = invoice.email || "";
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "RecoverPay <reminders@recoverpay.in>";

  if (apiKey && to) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text: body }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = (await res.json()) as { id?: string };
        return { id: j.id || `re_${Date.now()}`, mocked: false, to, subject };
      }
    } catch { /* fall through to mock */ }
  }
  return { id: `mock_${Date.now().toString(36)}`, mocked: true, to: to || "(no email on file)", subject };
}

export function emailSubject(invoice: Invoice): string {
  return `Payment reminder: ${invoice.invoice_no} — ₹${Number(invoice.amount).toLocaleString("en-IN")} due ${invoice.due_date}`;
}

export function emailBody(greeting: string, invoice: Invoice): string {
  const link = (invoice as Invoice & { payment_link?: string | null }).payment_link;
  return `${greeting}\n\nInvoice: ${invoice.invoice_no}\nAmount: ₹${Number(invoice.amount).toLocaleString("en-IN")}\nDue date: ${invoice.due_date}\n${link ? `Pay here: ${link}\n` : ""}\nReply to this email with your expected payment date and we'll schedule the follow-up automatically.\n\n— RecoverPay (auto-recovery agent)`;
}

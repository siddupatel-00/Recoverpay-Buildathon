import crypto from "crypto";
import type { Invoice } from "./types";

function hasRealKeys(): boolean {
  const id = process.env.RAZORPAY_KEY_ID || "";
  const secret = process.env.RAZORPAY_KEY_SECRET || "";
  return id.startsWith("rzp_test_") || id.startsWith("rzp_live_");
}

export async function createRazorpayLink(invoice: Invoice): Promise<{ link: string; mocked: boolean }> {
  if (!hasRealKeys()) {
    // Hackathon-safe mock that still looks like a real rzp.io link
    return { link: `https://rzp.io/rzp/mock-${invoice.id.slice(-8)}`, mocked: true };
  }
  const Razorpay = (await import("razorpay")).default;
  const rzp = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
  const link = await rzp.paymentLink.create({
    amount: Math.round(Number(invoice.amount) * 100), // paise
    currency: "INR",
    description: `RecoverPay ${invoice.invoice_no} — ${invoice.customer_name}`,
    customer: { name: invoice.customer_name, contact: invoice.phone },
    notify: { sms: true, email: false },
    notes: { invoice_id: invoice.id, invoice_no: invoice.invoice_no },
  });
  return { link: (link as { short_url: string }).short_url, mocked: false };
}

/** Verify Razorpay webhook HMAC-SHA256 signature. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

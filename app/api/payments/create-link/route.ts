import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { createRazorpayLink } from "@/lib/razorpay";
import type { Invoice } from "@/lib/types";

/** POST /api/payments/create-link { invoiceId } — server-side only, keys never hit browser. */
export async function POST(req: NextRequest) {
  await initDb();
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  if (!body.invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  const r = await db.execute({ sql: "SELECT * FROM invoices WHERE id = ?", args: [body.invoiceId] });
  if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const inv = r.rows[0] as unknown as Invoice;
  if (inv.status === "PAID") return NextResponse.json({ error: "Already paid" }, { status: 400 });

  try {
    const { link, mocked } = await createRazorpayLink(inv);
    const now = new Date().toISOString();
    await db.execute({ sql: "UPDATE invoices SET payment_link=?, updated_at=? WHERE id=?", args: [link, now, inv.id] });
    await db.execute({
      sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound', ?, 0, ?)",
      args: [inv.id, `Payment link taiyaar hai ${inv.customer_name} ji! 💳 ${inv.invoice_no} (${"₹" + Number(inv.amount).toLocaleString("en-IN")}) yahan pay karein: ${link}`, now],
    });
    await audit(inv.id, "PAYMENT_LINK_CREATED", `${mocked ? "MOCK" : "LIVE"} Razorpay link: ${link}`);
    return NextResponse.json({ ok: true, link, mocked });
  } catch (e) {
    await audit(inv.id, "PAYMENT_LINK_FAILED", String(e));
    return NextResponse.json({ error: "Failed to create payment link" }, { status: 500 });
  }
}

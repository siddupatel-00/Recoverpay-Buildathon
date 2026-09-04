import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { analyzeReply } from "@/lib/analyzer";
import { createRazorpayLink } from "@/lib/razorpay";
import type { Invoice } from "@/lib/types";

/**
 * POST /api/whatsapp/webhook
 * Accepts: simulator {invoiceId|from, text} + Meta Cloud API + Twilio shapes.
 * Zero-refactor ready for real WhatsApp.
 */
export async function POST(req: NextRequest) {
  await initDb();
  const db = getDb();
  const body = await req.json().catch(() => ({}));

  // Normalize inbound: Meta Cloud API shape
  let from: string | null = null;
  let text: string | null = null;
  let invoiceId: string | null = body.invoiceId ?? null;

  try {
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    if (entry?.messages?.[0]) {
      from = entry.messages[0].from ?? null;
      text = entry.messages[0].text?.body ?? null;
    }
  } catch { /* ignore */ }
  // Twilio shape
  if (!text && (body.Body || body.body)) text = body.Body ?? body.body;
  if (!from && (body.From || body.from || body.WaId)) from = body.From ?? body.from ?? body.WaId;
  // Simulator shape
  if (!text && body.text) text = body.text;

  if (!text) return NextResponse.json({ error: "No text found in payload" }, { status: 400 });

  // Resolve invoice: explicit id > phone lookup > most recent overdue
  let inv: Invoice | null = null;
  if (invoiceId) {
    const r = await db.execute({ sql: "SELECT * FROM invoices WHERE id = ?", args: [invoiceId] });
    if (r.rows.length) inv = r.rows[0] as unknown as Invoice;
  }
  if (!inv && from) {
    const digits = String(from).replace(/\D/g, "").slice(-10);
    const all = await db.execute({ sql: "SELECT * FROM invoices ORDER BY updated_at DESC LIMIT 50", args: [] });
    const rows = all.rows as unknown as Invoice[];
    inv = rows.find((i) => i.phone.replace(/\D/g, "").slice(-10) === digits) ?? null;
  }
  // SEC-03: no blind fallback. Unmatched senders are logged, never bound to a random invoice.
  if (!inv) {
    await audit(null, "UNMAPPED_INBOUND", `Inbound from ${from || "unknown"} could not be matched to any invoice — ignored`);
    return NextResponse.json({ ok: false, error: "No matching invoice for this sender" }, { status: 404 });
  }

  const { result, source } = await analyzeReply(text);
  const now = new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'inbound', ?, 0, ?)",
    args: [inv.id, text, now],
  });
  await audit(inv.id, "INTENT_PARSED", `${result.intent} (${source}, conf ${result.confidence}): ${result.reason} → action: ${result.recommendedAction}`, result.confidence);

  let newStatus = inv.status;
  let agentReply: string | null = null;

  switch (result.intent) {
    case "PROMISE_TO_PAY":
      newStatus = "PROMISED";
      await db.execute({ sql: "UPDATE invoices SET status='PROMISED', promised_date=?, updated_at=? WHERE id=?", args: [result.promisedDate, now, inv.id] });
      await audit(inv.id, "PROMISE_SCHEDULED", `Follow-up scheduled for ${result.promisedDate} — ${result.reason}`);
      agentReply = `Dhanyavaad ${inv.customer_name} ji! 🙏 ${result.promisedDate} ka promise note kar liya hai. Us din hum yaad dila denge. Agar pehle pay karna ho to payment link bhej dun?`;
      break;
    case "DISPUTE":
      newStatus = "DISPUTED";
      await db.execute({ sql: "UPDATE invoices SET status='DISPUTED', promised_date=NULL, updated_at=? WHERE id=?", args: [now, inv.id] });
      await audit(inv.id, "ESCALATED", "Dispute raised — automated reminders halted, routed to merchant");
      agentReply = `Samajh gaye ${inv.customer_name} ji, aapki concern note kar liya hai. Hamari team jald sampark karegi. 🙏`;
      break;
    case "WRONG_CONTACT":
      newStatus = "WRONG_CONTACT";
      await db.execute({ sql: "UPDATE invoices SET status='WRONG_CONTACT', promised_date=NULL, updated_at=? WHERE id=?", args: [now, inv.id] });
      await audit(inv.id, "ESCALATED", "Wrong contact flagged — number invalid, merchant must update");
      agentReply = `Maafi chahenge, galat number par message kar diya! 🙏`;
      break;
    case "ALREADY_PAID":
      newStatus = "VERIFY_PAID";
      await db.execute({ sql: "UPDATE invoices SET status='VERIFY_PAID', updated_at=? WHERE id=?", args: [now, inv.id] });
      await audit(inv.id, "VERIFY_REQUESTED", "Customer claims ALREADY_PAID — merchant must cross-verify bank statement");
      agentReply = `Dhanyavaad batane ke liye! 🙏 Hum bank statement verify karke confirm karte hain. UTR/reference ho to bhej dein.`;
      break;
    case "READY_TO_PAY": {
      // Autonomous: generate + send the link right in chat, no dashboard detour.
      let link = inv.payment_link;
      if (!link) {
        try {
          const created = await createRazorpayLink(inv);
          link = created.link;
          await db.execute({ sql: "UPDATE invoices SET payment_link=?, updated_at=? WHERE id=?", args: [link, now, inv.id] });
          await audit(inv.id, "PAYMENT_LINK_CREATED", `${created.mocked ? "MOCK" : "LIVE"} Razorpay link (auto-sent, customer asked): ${link}`);
        } catch (e) {
          await audit(inv.id, "PAYMENT_LINK_FAILED", String(e));
        }
      }
      agentReply = link
        ? `Bahut badhiya ${inv.customer_name} ji! 🎉 ${inv.invoice_no} (₹${Number(inv.amount).toLocaleString("en-IN")}) yahan pay karein: ${link}`
        : `Maafi ${inv.customer_name} ji, link banane me dikkat aayi — merchant ko inform kar diya hai, thodi der me bhejte hain. 🙏`;
      break;
    }
    default:
      await audit(inv.id, "UNKNOWN_INTENT", "Reply needs human review");
      agentReply = `Dhanyavaad ${inv.customer_name} ji! Aapka message mil gaya hai, team jald reply karegi. 🙏`;
  }

  if (agentReply) {
    await db.execute({
      sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound', ?, 0, ?)",
      args: [inv.id, agentReply, new Date().toISOString()],
    });
  }

  return NextResponse.json({ ok: true, invoiceId: inv.id, intent: result.intent, promisedDate: result.promisedDate, reason: result.reason, confidence: result.confidence, recommendedAction: result.recommendedAction, summary: result.summary, status: newStatus, agentReply, source });
}

// Meta verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN || "recoverpay-test")) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ ok: true, hint: "POST {invoiceId, text} or Meta/Twilio payload" });
}

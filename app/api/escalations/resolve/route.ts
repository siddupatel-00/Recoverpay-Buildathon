import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/** POST /api/escalations/resolve { invoiceId, action: 'mark_paid'|'reset_retries', note } — SEC-02 bearer-protected in production */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  await initDb();
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const { invoiceId, action, note } = body;
  if (!invoiceId || !action) return NextResponse.json({ error: "invoiceId + action required" }, { status: 400 });
  const r = await db.execute({ sql: "SELECT * FROM invoices WHERE id = ?", args: [invoiceId] });
  if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date().toISOString();
  if (action === "mark_paid") {
    await db.execute({ sql: "UPDATE invoices SET status='PAID', promised_date=NULL, updated_at=? WHERE id=?", args: [now, invoiceId] });
    await audit(invoiceId, "HUMAN_RESOLVED", `Marked PAID by merchant. Note: ${note || "-"} — stopping rule applied`);
    return NextResponse.json({ ok: true, status: "PAID" });
  }
  if (action === "reset_retries") {
    await db.execute({ sql: "UPDATE invoices SET attempts=0, status='OVERDUE', updated_at=? WHERE id=?", args: [now, invoiceId] });
    await audit(invoiceId, "RETRIES_RESET", `Retries reset to 0 by merchant. Note: ${note || "-"}`);
    return NextResponse.json({ ok: true, status: "OVERDUE" });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  await initDb();
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const id = searchParams.get("id");
  if (id) {
    const r = await db.execute({ sql: "SELECT * FROM invoices WHERE id = ?", args: [id] });
    if (r.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const msgs = await db.execute({ sql: "SELECT * FROM messages WHERE invoice_id = ? ORDER BY id ASC", args: [id] });
    const logs = await db.execute({ sql: "SELECT * FROM audit_logs WHERE invoice_id = ? ORDER BY id DESC LIMIT 50", args: [id] });
    return NextResponse.json({ invoice: r.rows[0], messages: msgs.rows, audit: logs.rows });
  }
  const rows = status
    ? await db.execute({ sql: "SELECT * FROM invoices ORDER BY due_date ASC", args: [] }).then((r) => ({ ...r, rows: r.rows.filter((x) => (x as unknown as { status: string }).status === status) }))
    : await db.execute({ sql: "SELECT * FROM invoices ORDER BY due_date ASC", args: [] });
  const msgs = await db.execute({ sql: "SELECT * FROM messages ORDER BY id DESC LIMIT 200", args: [] });
  const logs = await db.execute({ sql: "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200", args: [] });
  // Summary stats
  const invoices = rows.rows as unknown as { status: string; amount: number }[];
  const overdue = invoices.filter((i) => ["OVERDUE", "PROMISED", "ESCALATED"].includes(i.status));
  const paid = invoices.filter((i) => i.status === "PAID");
  return NextResponse.json({
    invoices: rows.rows,
    messages: msgs.rows,
    audit: logs.rows,
    env: {
      db: process.env.TURSO_URL ? "turso-cloud" : "local-file",
      razorpay: (process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_") ? "test-live" : "mock",
      gemini: process.env.GEMINI_API_KEY ? "configured" : "fallback",
    },
    stats: {
      total: invoices.length,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, i) => s + Number(i.amount), 0),
      recoveredCount: paid.length,
      recoveredAmount: paid.reduce((s, i) => s + Number(i.amount), 0),
    },
  });
}

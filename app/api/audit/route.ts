import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  await initDb();
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("invoiceId");
  const rows = invoiceId
    ? await db.execute({ sql: "SELECT * FROM audit_logs WHERE invoice_id = ? ORDER BY id DESC LIMIT 500", args: [invoiceId] })
    : await db.execute({ sql: "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500", args: [] });
  return NextResponse.json({ logs: rows.rows });
}

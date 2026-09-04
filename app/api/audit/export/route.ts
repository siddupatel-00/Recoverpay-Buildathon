import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/** GET /api/audit/export — SEC-02 bearer-protected in production */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  await initDb();
  const db = getDb();
  const rows = await db.execute({ sql: "SELECT * FROM audit_logs ORDER BY id ASC", args: [] });
  const header = "id,invoice_id,event,detail,confidence,created_at";
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = (rows.rows as unknown as Record<string, unknown>[]).map((r) =>
    [r.id, r.invoice_id, r.event, r.detail, r.confidence, r.created_at].map(esc).join(",")
  );
  const csv = [header, ...lines].join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=recoverpay-audit.csv" },
  });
}

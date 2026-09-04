import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { classifyOnIngest, todayStr, uid, type InvoiceStatus } from "@/lib/types";

interface IngestItem {
  invoice_no: string;
  customer_name: string;
  phone: string;
  email?: string;
  amount: number;
  due_date: string;
}

// Realistic Zoho-style fixtures for 1-click demo ingest (mirrors ERP auto-sync)
const ZOHO_FIXTURES: IngestItem[] = [
  { invoice_no: "ZH-INV-701", customer_name: "Karthik Subbaraj", phone: "9443311223", email: "karthik@maduraimills.in", amount: 21500, due_date: "2026-08-14" },
  { invoice_no: "ZH-INV-702", customer_name: "Meera Iyer", phone: "9840122334", email: "meera@chennaichem.com", amount: 45000, due_date: "2026-08-19" },
  { invoice_no: "ZH-INV-703", customer_name: "Girish Karnad", phone: "9880133445", email: "girish@bangaloreelec.in", amount: 13200, due_date: "2026-08-25" },
];

function parseCSV(csv: string): IngestItem[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    // SEC-05: tolerate formatted amounts like "₹14,500.00"
    const rawAmt = String(cols[idx("amount")] ?? cols[3] ?? "").replace(/[^0-9.]/g, "");
    return {
      invoice_no: cols[idx("invoice_no")] ?? cols[0],
      customer_name: cols[idx("customer_name")] ?? cols[1],
      phone: cols[idx("phone")] ?? cols[2],
      email: idx("email") >= 0 ? cols[idx("email")] : undefined,
      amount: Number(rawAmt),
      due_date: cols[idx("due_date")] ?? cols[4],
    };
  });
}

/**
 * POST /api/integrations/sync
 * Body: { invoices?: IngestItem[], csv?: string, source?: "csv"|"zoho"|"tally"|"quickbooks" }
 * Empty body → Zoho demo fixtures (1-click "Sync Zoho").
 * Deterministic overdue classification on ingest. Idempotent on invoice_no.
 */
export async function POST(req: NextRequest) {
  await initDb();
  const db = getDb();
  let body: { invoices?: IngestItem[]; csv?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  let items: IngestItem[] = body.invoices ?? [];
  if (body.csv) items = [...items, ...parseCSV(body.csv)];
  const source = body.source || (body.csv || body.invoices ? "csv" : "zoho");
  if (items.length === 0) items = ZOHO_FIXTURES;

  const today = todayStr();
  const created: string[] = [];
  let skipped = 0;
  for (const it of items) {
    if (!it.invoice_no || !it.customer_name || !it.amount || !it.due_date) continue;
    const dup = await db.execute({ sql: "SELECT id FROM invoices WHERE invoice_no = ?", args: [it.invoice_no] });
    if (dup.rows.length > 0) { skipped++; continue; }
    const status: InvoiceStatus = classifyOnIngest(it.due_date, today);
    const id = uid("inv");
    const now = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO invoices (id, invoice_no, customer_name, phone, email, amount, due_date, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      args: [id, it.invoice_no, it.customer_name, it.phone || "", it.email || null, Number(it.amount), it.due_date, status, now, now],
    });
    await audit(id, "INGEST", `Imported via ${source} — due ${it.due_date} → ${status}`);
    created.push(id);
  }
  return NextResponse.json({ ok: true, source, count: created.length, skipped, ids: created });
}

// Mock Zoho-style auto-sync info
export async function GET() {
  return NextResponse.json({
    ok: true,
    integrations: ["csv", "zoho", "tally", "quickbooks"],
    hint: "POST { invoices:[{invoice_no,customer_name,phone,amount,due_date}], source:'zoho' } or empty body for Zoho demo fixtures",
  });
}

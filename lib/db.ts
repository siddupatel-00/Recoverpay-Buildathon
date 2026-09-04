import { createClient, type Client } from "@libsql/client";
import path from "path";

let client: Client | null = null;
let initPromise: Promise<void> | null = null;

export function getDb(): Client {
  if (!client) {
    // Production (Vercel etc.): set TURSO_URL + TURSO_AUTH_TOKEN for persistent cloud SQLite.
    // Local dev: falls back to file:recoverpay.db
    const url = process.env.TURSO_URL || `file:${path.join(process.cwd(), "recoverpay.db")}`;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    client = createClient(authToken ? { url, authToken } : { url });
  }
  return client;
}

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getDb();
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_no TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        amount REAL NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        promised_date TEXT,
        payment_link TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
      CREATE INDEX IF NOT EXISTS idx_messages_invoice ON messages(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_logs(invoice_id);
    `);
    // Lightweight migration: email channel column (safe if already exists)
    try {
      const cols = await db.execute({ sql: "PRAGMA table_info(invoices)", args: [] });
      const names = (cols.rows as unknown as { name: string }[]).map((c) => c.name);
      if (!names.includes("email")) {
        await db.execute({ sql: "ALTER TABLE invoices ADD COLUMN email TEXT", args: [] });
      }
    } catch { /* older engine — email falls back to ingest-time only */ }
  })();
  return initPromise;
}

export async function audit(
  invoiceId: string | null,
  event: string,
  detail: string,
  confidence: number | null = null
): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO audit_logs (invoice_id, event, detail, confidence, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [invoiceId, event, detail, confidence, new Date().toISOString()],
  });
}

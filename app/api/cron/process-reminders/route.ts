import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb, audit } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateReminder } from "@/lib/ai";
import { MAX_ATTEMPTS, todayStr, type Invoice } from "@/lib/types";

const COOLDOWN_MS = 48 * 60 * 60 * 1000; // SEC-04: min gap between touches

/**
 * POST /api/cron/process-reminders
 * SEC-02: bearer-token protected in production.
 * Persistent background scheduler: promised_date matured → auto follow-up.
 * Also nudges stale OVERDUE (attempts < 3), honoring the 48h cooldown.
 */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  await initDb();
  const db = getDb();
  const today = todayStr();
  const all = await db.execute({
    sql: "SELECT * FROM invoices WHERE status IN ('OVERDUE','PROMISED','PENDING')",
    args: [],
  });
  const rows = all.rows as unknown as Invoice[];
  const due = rows.filter((i) => {
    if (i.status === "PROMISED" && i.promised_date) return i.promised_date <= today;
    if (i.status === "OVERDUE") return true;
    if (i.status === "PENDING" && i.due_date < today) return true;
    return false;
  });

  const sent: string[] = [];
  const escalated: string[] = [];
  const skippedCooldown: string[] = [];
  for (const inv of due) {
    if (inv.status === "PAID") continue;
    if (inv.attempts >= MAX_ATTEMPTS) {
      await db.execute({ sql: "UPDATE invoices SET status='ESCALATED', updated_at=? WHERE id=?", args: [new Date().toISOString(), inv.id] });
      await audit(inv.id, "ESCALATED", "Cron: max retries exhausted");
      escalated.push(inv.id);
      continue;
    }
    // SEC-04: 48h cooldown since last outbound touch
    const last = await db.execute({
      sql: "SELECT created_at FROM messages WHERE invoice_id = ? AND direction LIKE 'outbound%' ORDER BY id DESC LIMIT 1",
      args: [inv.id],
    });
    if (last.rows.length > 0) {
      const lastAt = Date.parse((last.rows[0] as unknown as { created_at: string }).created_at);
      if (!isNaN(lastAt) && Date.now() - lastAt < COOLDOWN_MS) {
        await audit(inv.id, "CRON_SKIPPED_COOLDOWN", "Last touch <48h ago — skipped");
        skippedCooldown.push(inv.id);
        continue;
      }
    }
    const attempt = inv.attempts + 1;
    const { text, source } = await generateReminder(inv, attempt);
    const now = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO messages (invoice_id, direction, body, attempt_no, created_at) VALUES (?, 'outbound', ?, ?, ?)",
      args: [inv.id, text, attempt, now],
    });
    const nextStatus = attempt >= MAX_ATTEMPTS ? "ESCALATED" : inv.status === "PROMISED" ? "OVERDUE" : "OVERDUE";
    await db.execute({
      sql: "UPDATE invoices SET attempts=?, status=?, promised_date=NULL, updated_at=? WHERE id=?",
      args: [attempt, nextStatus, now, inv.id],
    });
    await audit(inv.id, "CRON_FOLLOWUP", `Promise matured / overdue nudge #${attempt} via ${source}`);
    sent.push(inv.id);
  }
  return NextResponse.json({ ok: true, today, processed: due.length, sent, escalated, skippedCooldown });
}

export async function GET(req: NextRequest) {
  return POST(req);
}

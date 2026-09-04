export type InvoiceStatus =
  | "PENDING"
  | "OVERDUE"
  | "PROMISED"
  | "DISPUTED"
  | "WRONG_CONTACT"
  | "ESCALATED"
  | "PAID"
  | "VERIFY_PAID";

export interface Invoice {
  id: string;
  invoice_no: string;
  customer_name: string;
  phone: string;
  email?: string | null;
  amount: number; // rupees
  due_date: string; // YYYY-MM-DD
  status: InvoiceStatus;
  attempts: number;
  promised_date: string | null;
  payment_link: string | null;
  created_at: string;
  updated_at: string;
}

export type Intent =
  | "PROMISE_TO_PAY"
  | "DISPUTE"
  | "WRONG_CONTACT"
  | "ALREADY_PAID"
  | "READY_TO_PAY"
  | "UNKNOWN";

export interface ParseResult {
  intent: Intent;
  promisedDate: string | null;
  reason: string;
  confidence: number;
  recommendedAction: "schedule_reminder" | "verify_payment" | "escalate_to_human" | "send_payment_link" | "clarify";
  summary: string;
}

export const MAX_ATTEMPTS = 3;

export function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic overdue classification. No LLM involved. */
export function classifyOnIngest(dueDate: string, today = todayStr()): InvoiceStatus {
  return dueDate < today ? "OVERDUE" : "PENDING";
}

export function uid(prefix = "inv"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

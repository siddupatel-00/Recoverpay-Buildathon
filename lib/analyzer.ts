import type { ParseResult, Intent } from "./types";
import { todayStr } from "./types";

/**
 * Customer Reply NLP Intent Parser for Romanized Hinglish.
 * Deterministic rules first (offline-safe) + optional Gemini classification.
 */

function addDays(base: Date, n: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseDateFromText(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  // ISO date
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dmy) {
    let y = dmy[3] ? parseInt(dmy[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    const m = dmy[2].padStart(2, "0");
    const d = dmy[1].padStart(2, "0");
    // Heuristic: if month > 12, swap (MM/DD input)
    return `${y}-${m}-${d}`;
  }
  // "5th ko", "5 ko", "5 tarikh", "5th sept", "5 september"
  const months: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
    october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };
  const dm = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(ko|tarikh|tarik|sep|sept|september|oct|october|nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august)?/);
  const monthWord = t.match(/(january|february|march|april|may|june|july|august|sept|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/);
  if (dm && (t.includes("ko") || t.includes("tarikh") || t.includes("tarik") || monthWord || /salary|pay|dung/.test(t))) {
    const day = dm[1].padStart(2, "0");
    let month = monthWord ? months[monthWord[1]] : String(now.getMonth() + 1).padStart(2, "0");
    let year = now.getFullYear();
    // If day already passed this month and no explicit month, assume next month
    if (!monthWord) {
      const candidate = `${year}-${month}-${day}`;
      if (candidate < todayStr(now)) {
        const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        month = String(nm.getMonth() + 1).padStart(2, "0");
        year = nm.getFullYear();
      }
    }
    return `${year}-${month}-${day}`;
  }
  if (/\bkal\b/.test(t)) return addDays(now, 1); // kal = tomorrow (promise context)
  if (/\bparso/.test(t)) return addDays(now, 2);
  if (/next week/.test(t)) return addDays(now, 7);
  if (/\bmonday\b/.test(t)) return nextWeekday(now, 1);
  if (/\btuesday\b/.test(t)) return nextWeekday(now, 2);
  if (/\bwednesday\b/.test(t)) return nextWeekday(now, 3);
  if (/\bthursday\b/.test(t)) return nextWeekday(now, 4);
  if (/\bfriday\b/.test(t)) return nextWeekday(now, 5);
  if (/\bsaturday\b/.test(t)) return nextWeekday(now, 6);
  if (/\bsunday\b/.test(t)) return nextWeekday(now, 0);
  return null;
}

function nextWeekday(now: Date, day: number): string {
  const d = new Date(now);
  let diff = (day - d.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function ruleClassify(text: string, now = new Date()): ParseResult {
  const t = text.toLowerCase();

  const wrongHints = ["wrong number", "galat number", "wrong person", "not sharma", "i am not", "main woh nahi", "rang number"];
  if (wrongHints.some((h) => t.includes(h)))
    return {
      intent: "WRONG_CONTACT", promisedDate: null, reason: "Customer indicated wrong contact/number", confidence: 0.92,
      recommendedAction: "escalate_to_human", summary: "Recipient disavows account. Contact details need human verification.",
    };

  const disputeHints = ["damaged", "defective", "kharab", "galat maal", "wrong goods", "dispute", "complaint", "short supply", "quality", "return", "wapas", "double counted", "won't pay", "nahi dunga"];
  if (disputeHints.some((h) => t.includes(h)))
    return {
      intent: "DISPUTE", promisedDate: null, reason: "Customer raised goods/service dispute", confidence: 0.9,
      recommendedAction: "escalate_to_human", summary: "Invoice contested. Immediate human investigation needed.",
    };

  const paidHints = ["already paid", "pay kar diya", "payment kar diya", "paid", "upi done", "neft done", "transfer done", "paise bhej diye", "de diya", "kar di hai", "transferred", "payment ho gaya"];
  if (paidHints.some((h) => t.includes(h)))
    return {
      intent: "ALREADY_PAID", promisedDate: null, reason: "Customer claims payment already made — verify bank statement", confidence: 0.85,
      recommendedAction: "verify_payment", summary: "Customer stated payment completed. Reconcile bank statement.",
    };

  const readyHints = ["link bhejo", "pay now", "ready to pay", "link send", "abhi pay", "settle", "payment link", "link do", "bhejo", "qr", "upi"];
  if (readyHints.some((h) => t.includes(h)))
    return {
      intent: "READY_TO_PAY", promisedDate: null, reason: "Customer ready to settle — send Razorpay link", confidence: 0.88,
      recommendedAction: "send_payment_link", summary: "Customer eager to pay immediately upon receipt of payment link.",
    };

  const promiseHints = ["pay kar", "kar dunga", "kar denge", "promise", "salary", "5th", "kal", "parso", "next week", "will pay", "pakka", "confirm", "date", "ko ", "tarikh", "monday", "tuesday", "wednesday", "thursday", "friday", "friday", "hafta", "salary aayegi", "credit"];
  if (promiseHints.some((h) => t.includes(h))) {
    const d = parseDateFromText(text, now);
    if (d)
      return {
        intent: "PROMISE_TO_PAY",
        promisedDate: d,
        reason: salaryReason(t),
        confidence: 0.87,
        recommendedAction: "schedule_reminder",
        summary: `Promise detected. Payment committed for ${d}.`,
      };
    // promise language without explicit date -> default +3 days
    return {
      intent: "PROMISE_TO_PAY", promisedDate: addDays(now, 3), reason: "Promise detected without explicit date; defaulted to +3 days", confidence: 0.62,
      recommendedAction: "schedule_reminder", summary: "Promise detected without explicit date. Follow up in 3 days.",
    };
  }

  // bare date with no other signal still counts as promise
  const dOnly = parseDateFromText(text, now);
  if (dOnly && /\d/.test(t))
    return {
      intent: "PROMISE_TO_PAY", promisedDate: dOnly, reason: "Date detected in reply", confidence: 0.7,
      recommendedAction: "schedule_reminder", summary: `Date detected in reply. Follow up on ${dOnly}.`,
    };

  return {
    intent: "UNKNOWN", promisedDate: null, reason: "Could not classify reply — needs human review", confidence: 0.4,
    recommendedAction: "clarify", summary: "Response ambiguous. Prompt for clarification or escalate.",
  };
}

function salaryReason(t: string): string {
  if (t.includes("salary")) return "Awaiting monthly salary credit";
  if (t.includes("credit") || t.includes("payment aayega")) return "Awaiting incoming credit";
  if (t.includes("kal") || t.includes("parso")) return "Promised near-term payment";
  return "Customer promised payment on extracted date";
}

async function geminiClassify(text: string): Promise<ParseResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.0-flash" });
    const prompt =
      `Classify this Indian customer WhatsApp reply about an unpaid invoice into exactly one intent: PROMISE_TO_PAY, DISPUTE, WRONG_CONTACT, ALREADY_PAID, READY_TO_PAY, UNKNOWN. ` +
      `Also extract promised payment date as YYYY-MM-DD or null, a short reason, and confidence 0-1. ` +
      `Reply: "${text}". Today is ${todayStr()}. ` +
      `Return ONLY JSON: {"intent":"...","promisedDate":"... or null","reason":"...","confidence":0.0}`;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
    const gen = (async () => {
      const res = await model.generateContent(prompt);
      return res.response.text();
    })();
    const raw = await Promise.race([gen, timeout]);
    if (!raw) return null;
    const jsonStr = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    const valid: Intent[] = ["PROMISE_TO_PAY", "DISPUTE", "WRONG_CONTACT", "ALREADY_PAID", "READY_TO_PAY", "UNKNOWN"];
    if (!valid.includes(parsed.intent)) return null;
    const actionFor: Record<Intent, ParseResult["recommendedAction"]> = {
      PROMISE_TO_PAY: "schedule_reminder",
      DISPUTE: "escalate_to_human",
      WRONG_CONTACT: "escalate_to_human",
      ALREADY_PAID: "verify_payment",
      READY_TO_PAY: "send_payment_link",
      UNKNOWN: "clarify",
    };
    return {
      intent: parsed.intent,
      promisedDate: parsed.promisedDate ?? null,
      reason: parsed.reason ?? "Gemini classification",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.75,
      recommendedAction: actionFor[parsed.intent as Intent],
      summary: parsed.reason ?? "Gemini classification",
    };
  } catch {
    return null;
  }
}

export async function analyzeReply(text: string, now = new Date()): Promise<{ result: ParseResult; source: "gemini" | "rules" }> {
  const g = await geminiClassify(text);
  if (g) return { result: g, source: "gemini" };
  return { result: ruleClassify(text, now), source: "rules" };
}

// Sync version for cron/tests/offline determinism
export function analyzeReplySync(text: string, now = new Date()): ParseResult {
  return ruleClassify(text, now);
}

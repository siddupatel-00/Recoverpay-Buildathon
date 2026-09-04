import type { Invoice } from "./types";

/**
 * Google Gemini 3.6 Flash Hinglish agent with deterministic fallback.
 * LLM only drafts TEXT — never mutates DB. All mutations are deterministic code.
 */

function fallbackTemplate(invoice: Invoice, attempt: number): string {
  const amt = `₹${Number(invoice.amount).toLocaleString("en-IN")}`;
  if (attempt <= 1) {
    return (
      `Namaste ${invoice.customer_name} ji! 🙏 Umeed hai aap badhiya hain. ` +
      `Aapka bill ${invoice.invoice_no} amount ${amt} ka payment due ho gaya hai (due date: ${invoice.due_date}). ` +
      `Kripya confirm karein kab tak payment ho jayega? Agar UPI se pay karna ho to batayein, hum payment link bhej denge. - RecoverPay`
    );
  }
  if (attempt === 2) {
    return (
      `Namaste ${invoice.customer_name} ji, reminder: ${invoice.invoice_no} (${amt}, due ${invoice.due_date}) abhi bhi unpaid hai. ` +
      `Request hai ki 48 hours me clear kar dein taaki aage credit hold / late follow-up na karna pade. ` +
      `Pay karne ke liye link chahiye to "link bhejo" reply karein. - RecoverPay`
    );
  }
  return (
    `${invoice.customer_name} ji, FINAL reminder: ${invoice.invoice_no} (${amt}) overdue hai aur 3rd attempt hai. ` +
    `Agar aaj payment ya promise-date confirm nahi hui to account human collection team ko escalate ho jayega. ` +
    `Kripya turant reply karein — pay / dispute / date batayein. - RecoverPay`
  );
}

async function geminiDraft(invoice: Invoice, attempt: number): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    // Spec names "Gemini 3.6 Flash"; use newest flash model available, graceful fallback.
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });
    const tone =
      attempt <= 1
        ? "polite, warm, culturally respectful Hinglish (Roman script + some Hindi respect words like ji, kripya)"
        : attempt === 2
          ? "firm but respectful, urgent, direct call-to-action"
          : "final firm notice before human escalation, still respectful, no threats";
    const prompt =
      `You are RecoverPay, an Indian B2B invoice recovery assistant. Draft a short WhatsApp reminder (max 60 words) in Hinglish (Romanized Hindi + English mix). ` +
      `Tone: ${tone}. Attempt ${attempt} of 3. ` +
      `Customer: ${invoice.customer_name}, Invoice: ${invoice.invoice_no}, Amount: Rs ${invoice.amount}, Due: ${invoice.due_date}. ` +
      `Mention invoice no + amount + due date. Ask for promise date or offer payment link. No hallucinations, no fake legal threats. Return ONLY the message text.`;

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const gen = (async () => {
      const res = await model.generateContent(prompt);
      const text = res.response.text().trim();
      return text || null;
    })();
    const result = await Promise.race([gen, timeout]);
    return result;
  } catch {
    return null;
  }
}

export async function generateReminder(
  invoice: Invoice,
  attempt: number
): Promise<{ text: string; source: "gemini" | "fallback" }> {
  const drafted = await geminiDraft(invoice, attempt);
  if (drafted) return { text: drafted, source: "gemini" };
  return { text: fallbackTemplate(invoice, attempt), source: "fallback" };
}

export function getFallbackTemplate(invoice: Invoice, attempt: number): string {
  return fallbackTemplate(invoice, attempt);
}

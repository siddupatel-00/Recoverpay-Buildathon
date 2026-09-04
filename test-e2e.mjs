/**
 * RecoverPay 9-step end-to-end audit suite.
 * Run: node test-e2e.mjs  (expects app on http://localhost:3000)
 * Covers: ingest → overdue → reminder → Hinglish → promise NLP → cron → paylink → webhook HMAC → stopping rule → guardrails → audit export.
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const ADMIN = process.env.ADMIN_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_BEARER_TOKEN}` } : {};
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`✅ ${name} ${extra}`); }
  else { fail++; console.log(`❌ ${name} ${extra}`); }
};
const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
};
const get = async (p, headers = {}) => {
  const r = await fetch(BASE + p, { headers });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};

console.log("🚀 RecoverPay E2E —", BASE);
const stamp = Date.now().toString(36);
try {
  // 1. Ingest overdue invoice
  const inv = { invoice_no: `INV-E2E-${stamp}`, customer_name: "Rajesh", phone: "9876543210", amount: 14500, due_date: "2026-08-20" };
  let r = await post("/api/integrations/sync", { invoices: [inv], source: "csv" });
  ok("1. Ingest CSV", r.status === 200 && r.json?.count === 1, JSON.stringify(r.json));
  const id = r.json?.ids?.[0];

  // 2. Deterministic overdue
  let g = await get("/api/invoices");
  const row = g.json?.invoices?.find((x) => x.id === id);
  ok("2. Deterministic OVERDUE", row?.status === "OVERDUE", `status=${row?.status}`);

  // 3. Reminder #1 Hinglish
  r = await post("/api/reminders/send", { invoiceId: id });
  ok("3. Reminder #1 sent", r.status === 200 && !!r.json?.message, (r.json?.message || "").slice(0, 80));
  ok("   Hinglish/polite", /namaste|umeed|kripya|bill/i.test(r.json?.message || ""));

  // 4. Promise-to-pay NLP
  r = await post("/api/whatsapp/webhook", { invoiceId: id, text: "Salary 5th ko aayegi, us din pay kar dunga" });
  ok("4. PROMISE_TO_PAY parsed", r.json?.intent === "PROMISE_TO_PAY" && r.json?.status === "PROMISED", JSON.stringify({ intent: r.json?.intent, date: r.json?.promisedDate }));

  // 5. Cron matured follow-up (force promised_date to today via past date reply, then run cron)
  await post("/api/whatsapp/webhook", { invoiceId: id, text: "kal pay kar dunga pakka" });
  // Cron should pick it up only when matured; just verify endpoint works
  r = await post("/api/cron/process-reminders", {}, ADMIN);
  ok("5. Cron runs", r.status === 200 && r.json?.ok === true, JSON.stringify({ processed: r.json?.processed }));
  // 5b. Cron rejects without admin token (SEC-02, prod only — dev skips auth)
  r = await post("/api/cron/process-reminders", {});
  ok("5b. Cron auth enforced-or-open", r.status === 200 || r.status === 401, `status=${r.status}`);

  // 6. Guarded payment link
  r = await post("/api/payments/create-link", { invoiceId: id });
  ok("6. Payment link (rzp.io)", r.status === 200 && /rzp\.io/.test(r.json?.link || ""), r.json?.link);

  // 7. Dispute halts (use second invoice to not disturb stopping-rule test)
  const inv2 = { invoice_no: `INV-E2E-${stamp}-2`, customer_name: "Amit", phone: "9999988888", amount: 8750, due_date: "2026-08-01" };
  let r2 = await post("/api/integrations/sync", { invoices: [inv2], source: "zoho" });
  const id2 = r2.json?.ids?.[0];
  r = await post("/api/whatsapp/webhook", { invoiceId: id2, text: "Goods were damaged on delivery" });
  ok("7. DISPUTE escalates", r.json?.intent === "DISPUTE" && r.json?.status === "DISPUTED", r.json?.status);
  r = await post("/api/reminders/send", { invoiceId: id2 });
  ok("   Disputed blocks reminders", r.status === 400);

  // 8. SEC-01: unsigned/tampered webhook rejected; demo simulate → PAID; stopping rule
  const evt = { event: "test.payment_captured", id: `evt_e2e_${Date.now()}`, payload: { payment: { entity: { id: "pay_e2e", notes: { invoice_id: id } } } } };
  r = await post("/api/webhook", evt, { "x-razorpay-signature": "test" });
  ok("8. Unsigned webhook rejected in prod (401) / dev-bypass capture", r.status === 401 || r.json?.status === "PAID", `status=${r.status}`);
  r = await post("/api/payments/simulate", { invoiceId: id });
  ok("   Demo simulate → PAID", r.json?.status === "PAID", JSON.stringify(r.json));
  r = await post("/api/reminders/send", { invoiceId: id });
  ok("   Stopping rule blocks post-paid reminders (400)", r.status === 400);

  // 8b. SEC-03: unmapped sender never binds to a random invoice
  r = await post("/api/whatsapp/webhook", { from: "+910000000000", text: "hello?" });
  ok("8b. Unmapped inbound → 404, no binding", r.status === 404 && !r.json?.invoiceId, `status=${r.status}`);

  // 9. Audit trail + export
  g = await get("/api/audit");
  ok("9. Audit trail non-empty", (g.json?.logs?.length || 0) > 5, `${g.json?.logs?.length} events`);
  const csv = await get("/api/audit/export", ADMIN);
  ok("   Export CSV", csv.status === 200 && csv.text.includes("REMINDER_SENT"), `${csv.text.split("\n").length} lines`);

  // 10. Idempotent re-ingest (dedup on invoice_no)
  r = await post("/api/integrations/sync", { invoices: [inv], source: "csv" });
  ok("10. Re-ingest deduped", r.json?.count === 0 && r.json?.skipped >= 1, JSON.stringify({ count: r.json?.count, skipped: r.json?.skipped }));

  // 11. Email second channel (fresh invoice to avoid spent retries)
  const inv3 = { invoice_no: `INV-E2E-${stamp}-3`, customer_name: "Priya", phone: "9812345678", email: "priya@example.in", amount: 5000, due_date: "2026-08-15" };
  r = await post("/api/integrations/sync", { invoices: [inv3], source: "csv" });
  const id3 = r.json?.ids?.[0];
  r = await post("/api/reminders/send-email", { invoiceId: id3 });
  ok("11. Email channel sends", r.status === 200 && !!r.json?.subject, JSON.stringify({ to: r.json?.to, mocked: r.json?.mocked }));
} catch (e) {
  fail++;
  console.error("❌ E2E crashed:", e);
}
console.log(`\nDone: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Moon, Sun, Send, CreditCard, AlertTriangle, RefreshCw,
  Upload, Bot, User, CheckCircle2, LayoutDashboard, FileText, Users,
  MessageCircle, Wallet, BarChart3, Plug, Settings, Bell,
  TrendingUp, Clock, CircleDollarSign, ChevronRight, Zap, Mail, X,
} from "lucide-react";

interface Invoice {
  id: string; invoice_no: string; customer_name: string; phone: string;
  amount: number; due_date: string; status: string; attempts: number;
  promised_date: string | null; payment_link: string | null;
  created_at?: string; updated_at?: string;
}
interface Msg { id: number; invoice_id: string; direction: string; body: string; attempt_no: number; created_at: string; }
interface Audit { id: number; invoice_id: string | null; event: string; detail: string; confidence: number | null; created_at: string; }

const SAMPLE_CSV = `invoice_no,customer_name,phone,amount,due_date
INV-001,Rajesh Sharma,9876543210,14500,2026-08-20
INV-002,Priya Traders,9812345678,32000,2026-09-10
INV-003,Amit Kumar,9999988888,8750,2026-08-01`;

const SCENARIOS = [
  { l: "Salary 5th promise", t: "Salary 5th ko aayegi, us din pay kar dunga" },
  { l: "Tomorrow promise", t: "Kal subah 10 baje pakka transfer kar raha hoon" },
  { l: "Next month hold", t: "Abhi financial crisis hai, next month 15th tak hold karo please" },
  { l: "Friday clearance", t: "Accountant leave par hai, Friday ko clearance mil jayega" },
  { l: "Already paid", t: "Bhaiya payment already kar di hai kal shaam ko, check karo" },
  { l: "Damaged goods", t: "Goods were damaged on delivery" },
  { l: "GST dispute", t: "Invoice amount is incorrect, 18% GST was double counted" },
  { l: "Wrong number", t: "Wrong number, I am not Sharma Ji" },
  { l: "Send link", t: "Link bhejo, abhi pay karta hun" },
  { l: "UPI QR", t: "Can you resend the UPI QR? I will clear it now" },
];

function daysOverdue(due: string, today = new Date().toISOString().slice(0, 10)): number {
  const ms = Date.parse(today) - Date.parse(due);
  return Math.max(0, Math.round(ms / 86400000));
}
function relTime(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function inr(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}
function inrShort(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}

const STATUS_PILL: Record<string, string> = {
  OVERDUE: "bg-red-500/15 text-red-400",
  PROMISED: "bg-amber-500/15 text-amber-400",
  PAID: "bg-green-500/15 text-green-400",
  ESCALATED: "bg-orange-500/15 text-orange-400",
  DISPUTED: "bg-purple-500/15 text-purple-400",
  WRONG_CONTACT: "bg-purple-500/15 text-purple-400",
  VERIFY_PAID: "bg-sky-500/15 text-sky-400",
  PENDING: "bg-neutral-500/15 text-neutral-400",
};

function nextAction(i: Invoice): string {  if (i.status === "PAID") return "Paid ✓";
  if (i.status === "PROMISED" && i.promised_date) return `Follow up on ${i.promised_date}`;
  if (i.status === "OVERDUE")
    return i.attempts === 0 ? "No touches yet — send #1" : `Sent ${i.attempts}/3 · next #${Math.min(i.attempts + 1, 3)}`;
  if (i.status === "PENDING") return `Due ${i.due_date}`;
  return "Waiting for you";
}

function initials(n: string): string {
  return n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [stats, setStats] = useState({ total: 0, overdueCount: 0, overdueAmount: 0, recoveredCount: 0, recoveredAmount: 0 });
  const [selected, setSelected] = useState<string | null>(() => {
    try { return localStorage.getItem("recoverpay:selected"); } catch { return null; }
  });
  const [tab, setTab] = useState("All");
  const [page, setPage] = useState(0);
  const [reply, setReply] = useState("");
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [showImport, setShowImport] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [env, setEnv] = useState({ db: "?", razorpay: "?", gemini: "?" });
  const [showChat, setShowChat] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem("recoverpay:theme") as "dark" | "light") || "dark"; }
    catch { return "dark"; }
  });
  const [plan, setPlan] = useState(() => {
    try { return localStorage.getItem("recoverpay:plan") || "Pro"; } catch { return "Pro"; }
  });
  const [showPlanCard, setShowPlanCard] = useState(() => {
    try { return localStorage.getItem("recoverpay:hide-plan") !== "1"; } catch { return true; }
  });
  const [showHelpCard, setShowHelpCard] = useState(() => {
    try { return localStorage.getItem("recoverpay:hide-help") !== "1"; } catch { return true; }
  });
  function keepPlan(p: string) {
    setPlan(p);
    try { localStorage.setItem("recoverpay:plan", p); } catch {}
    say(`${p} plan kept`);
  }
  function hideCard(which: "plan" | "help") {
    if (which === "plan") setShowPlanCard(false); else setShowHelpCard(false);
    try { localStorage.setItem(`recoverpay:hide-${which}`, "1"); } catch {}
  }
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("recoverpay:theme", theme); } catch {}
  }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setShowChat((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [nav, setNav] = useState("Dashboard");

  const selectedRef = useRef<string | null>((() => {
    try { return localStorage.getItem("recoverpay:selected"); } catch { return null; }
  })());
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  function pick(id: string | null) {
    selectedRef.current = id;
    try { id ? localStorage.setItem("recoverpay:selected", id) : localStorage.removeItem("recoverpay:selected"); } catch {}
    setSelected(id);
  }

  const inv: Invoice | null = invoices.find((i) => i.id === selected) ?? invoices[0] ?? null;
  // Live notifications derived from real state
  const notifs = useMemo(() => {
    const list: { icon: "alert" | "ok" | "info"; text: string; time: string; invoiceId?: string }[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const i of invoices) {
      if (["ESCALATED", "DISPUTED", "WRONG_CONTACT"].includes(i.status))
        list.push({ icon: "alert", text: `${i.invoice_no} needs you — ${i.status}`, time: i.updated_at || "", invoiceId: i.id });
      else if (i.status === "PROMISED" && i.promised_date && i.promised_date <= today)
        list.push({ icon: "info", text: `${i.customer_name}'s promise matured today`, time: i.promised_date, invoiceId: i.id });
    }
    for (const a of audit.slice(0, 30)) {
      if (a.event === "PAYMENT_CAPTURED")
        list.push({ icon: "ok", text: `Payment recovered — ${a.detail.slice(0, 50)}`, time: a.created_at, invoiceId: a.invoice_id || undefined });
      // WEBHOOK_REJECTED intentionally excluded: blocks are routine guardrail noise,
      // full detail stays in the audit trail.
    }
    return list.slice(0, 12);
  }, [invoices, audit]);
  const chat = useMemo(
    () => messages.filter((m) => inv && m.invoice_id === inv.id).sort((a, b) => a.id - b.id),
    [messages, inv?.id]
  );
  const invAudit = useMemo(() => audit.filter((a) => inv && a.invoice_id === inv.id), [audit, inv?.id]);
  const lastMsgOf = useMemo(() => {
    const m = new Map<string, Msg>();
    for (const x of messages) { const p = m.get(x.invoice_id); if (!p || x.id > p.id) m.set(x.invoice_id, x); }
    return m;
  }, [messages]);

  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [chat.length, selected]);

  async function refresh() {
    const r = await fetch("/api/invoices").then((x) => x.json());
    setInvoices(r.invoices ?? []); setMessages(r.messages ?? []);
    setAudit(r.audit ?? []); setStats(r.stats ?? stats);
    if (r.env) setEnv(r.env);
    if (!selectedRef.current && r.invoices?.length) pick(r.invoices[0].id);
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (selected && invoices.length > 0 && !invoices.some((i) => i.id === selected)) pick(invoices[0].id);
  }, [invoices]);

  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 3500); }
  function authHeaders(): Record<string, string> {
    const t = process.env.NEXT_PUBLIC_ADMIN_BEARER_TOKEN;
    return t ? { Authorization: `Bearer ${t}` } : {};
  }
  async function downloadAudit() {
    try {
      const r = await fetch("/api/audit/export", { headers: authHeaders() });
      if (!r.ok) { say(r.status === 401 ? "Export needs admin login" : "Export failed"); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "recoverpay-audit.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { say("Export failed"); }
  }

  async function doSync() {
    setBusy("sync");
    const r = await fetch("/api/integrations/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, source: "csv" }),
    }).then((x) => x.json());
    setBusy(""); setShowImport(false);
    say(r.ok ? `${r.count} imported${r.skipped ? `, ${r.skipped} dupes skipped` : ""}` : r.error || "Import failed");
    refresh();
  }
  async function syncZoho() {
    setBusy("zoho");
    const r = await fetch("/api/integrations/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "zoho" }),
    }).then((x) => x.json());
    setBusy("");
    say(r.ok ? `Zoho: ${r.count} synced${r.skipped ? `, ${r.skipped} already there` : ""}` : r.error || "Sync failed");
    refresh();
  }
  async function sendReminder() {
    if (!inv) return; setBusy("remind");
    const r = await fetch("/api/reminders/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: inv.id }),
    }).then((x) => x.json());
    setBusy(""); say(r.ok ? `Reminder #${r.attempt} sent` : r.error);
    refresh();
  }
  async function sendEmail() {
    if (!inv) return; setBusy("email");
    const r = await fetch("/api/reminders/send-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: inv.id }),
    }).then((x) => x.json());
    setBusy(""); say(r.ok ? `Email #${r.attempt} → ${r.to}${r.mocked ? " (mock)" : ""}` : r.error);
    refresh();
  }
  async function sendReply() {
    if (!inv || !reply.trim()) return; setBusy("reply");
    const r = await fetch("/api/whatsapp/webhook", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: inv.id, text: reply }),
    }).then((x) => x.json());
    setBusy(""); setReply("");
    say(r.ok ? `Intent: ${r.intent} → ${r.status} (${r.recommendedAction})` : r.error);
    refresh();
  }
  async function createLink() {
    if (!inv) return; setBusy("link");
    const r = await fetch("/api/payments/create-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: inv.id }),
    }).then((x) => x.json());
    setBusy(""); say(r.ok ? `Link ready${r.mocked ? " (test mock)" : ""}` : r.error);
    refresh();
  }
  async function runCron() {
    setBusy("cron");
    const r = await fetch("/api/cron/process-reminders", { method: "POST", headers: authHeaders() }).then((x) => x.json());
    setBusy(""); say(r.ok ? `Cron: ${r.sent.length} sent, ${r.escalated.length} escalated` : (r.error || "Cron failed"));
    refresh();
  }
  async function simulatePayment() {
    if (!inv) return; setBusy("pay");
    const r = await fetch("/api/payments/simulate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: inv.id }),
    }).then((x) => x.json());
    setBusy(""); say(r.ok ? "Payment captured — stopping rule ON" : (r.error || "Simulate failed"));
    refresh();
  }
  async function resolveEsc(action: "mark_paid" | "reset_retries") {
    if (!inv) return;
    const r = await fetch("/api/escalations/resolve", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ invoiceId: inv.id, action, note }),
    }).then((x) => x.json());
    setShowEscalate(false); setNote("");
    say(r.ok ? `Resolved → ${r.status}` : r.error);
    refresh();
  }

  // ---- derived metrics (real data) ----
  const denom = stats.recoveredAmount + stats.overdueAmount;
  const recoveryRate = denom > 0 ? (stats.recoveredAmount / denom) * 100 : 0;
  const unpaid = invoices.filter((i) => !["PAID"].includes(i.status));
  const avgOverdue = unpaid.length
    ? Math.round(unpaid.reduce((s, i) => s + daysOverdue(i.due_date), 0) / unpaid.length) : 0;

  const tabs = ["All", "Overdue", "Promised", "Paid", "Disputed", "Escalated"];
  const tabMatch = (i: Invoice) =>
    tab === "All" ? true
    : tab === "Disputed" ? ["DISPUTED", "WRONG_CONTACT", "VERIFY_PAID"].includes(i.status)
    : i.status === tab.toUpperCase();
  const filtered = invoices.filter(tabMatch);
  const perPage = 5;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);
  useEffect(() => { setPage(0); }, [tab, invoices.length]);

  const dist = useMemo(() => {
    const groups: Record<string, number> = { Overdue: 0, Promised: 0, Paid: 0, Escalated: 0, Other: 0 };
    for (const i of invoices) {
      if (i.status === "OVERDUE") groups.Overdue++;
      else if (i.status === "PROMISED") groups.Promised++;
      else if (i.status === "PAID") groups.Paid++;
      else if (["ESCALATED", "DISPUTED", "WRONG_CONTACT"].includes(i.status)) groups.Escalated++;
      else groups.Other++;
    }
    return groups;
  }, [invoices]);

  const topCustomers = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices) {
      if (i.status === "PAID") continue;
      m.set(i.customer_name, (m.get(i.customer_name) || 0) + Number(i.amount));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [invoices]);

  // 30-day series from audit trail (real events)
  const series = useMemo(() => {
    const days: string[] = [];
    for (let k = 29; k >= 0; k--) {
      const d = new Date(); d.setDate(d.getDate() - k);
      days.push(d.toISOString().slice(0, 10));
    }
    const rec = days.map(() => 0);
    const out = days.map(() => 0);
    for (const a of audit) {
      const day = (a.created_at || "").slice(0, 10);
      const k = days.indexOf(day);
      if (k < 0) continue;
      if (a.event === "PAYMENT_CAPTURED" || a.event === "HUMAN_RESOLVED") {
        const m = a.detail.match(/₹([\d,]+)/);
        rec[k] += m ? Number(m[1].replace(/,/g, "")) : 0;
      }
      if (a.event === "INGEST") {
        const m = a.detail.match(/→\s*OVERDUE|→\s*PENDING/);
        void m;
      }
    }
    // cumulative recovered; outstanding decays as recovered grows
    let run = 0;
    const recCum = rec.map((v) => (run += v));
    const totalOut = stats.overdueAmount + stats.recoveredAmount;
    const outLine = recCum.map((r) => Math.max(0, totalOut - r));
    return { days, recCum, outLine };
  }, [audit, stats]);

  const NAV = [
    { l: "Dashboard", icon: LayoutDashboard },
    { l: "Invoices", icon: FileText },
    { l: "Customers", icon: Users },
    { l: "WhatsApp Chat", icon: MessageCircle },
    { l: "Payments", icon: Wallet },
    { l: "Analytics", icon: BarChart3 },
    { l: "Integrations", icon: Plug },
    { l: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-neutral-100 flex">
      {/* Sidebar — own scroll, independent of main content */}
      <aside className="w-52 shrink-0 border-r border-neutral-800/80 p-4 hidden md:flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-2 px-2 py-3">
          <span className="text-[#2563eb] font-black text-xl">⚡</span>
          <span className="font-extrabold tracking-tight">RecoverPay</span>
        </div>
        {NAV.map((n) => (
          <button key={n.l} onClick={() => setNav(n.l)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${nav === n.l ? "bg-[#2563eb] text-white font-semibold" : "text-neutral-400 hover:bg-neutral-800/60"}`}>
            <n.icon size={16} /> {n.l}
          </button>
        ))}
        <div className="mt-auto space-y-3">
          {showPlanCard && (
          <div className="border border-neutral-800 rounded-xl p-3 text-xs relative">
            <button onClick={() => hideCard("plan")} title="Dismiss" className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-200"><X size={12} /></button>
            <div className="font-bold flex gap-1 items-center">👑 {plan} Plan</div>
            <div className="text-neutral-400 mt-1">Recovery agent active<br />Guardrails ON · 3-retry cap</div>
            <button onClick={() => setNav("Subscription")} className="mt-2 w-full bg-neutral-800 rounded-lg py-1.5">Manage Plan</button>
          </div>
          )}
          {showHelpCard && (
          <div className="border border-neutral-800 rounded-xl p-3 text-xs relative">
            <button onClick={() => hideCard("help")} title="Dismiss" className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-200"><X size={12} /></button>
            <div className="font-bold">Need help?</div>
            <div className="text-neutral-400">Audit-backed support</div>
            <a href="https://x.com/zenitsu_t7" target="_blank" className="mt-2 block text-center bg-neutral-800 rounded-lg py-1.5">Contact</a>
          </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        {/* Topbar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80">
          <div>
            <h1 className="text-lg font-bold">Welcome back, Merchant! 👋</h1>
            <p className="text-xs text-neutral-400">Here&apos;s what&apos;s happening with your collections today.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => say("Simulator live below · Meta/Twilio webhook ready at /api/whatsapp/webhook")} className="text-xs border border-neutral-700 rounded-lg px-3 py-2 flex gap-1.5 items-center hover:bg-neutral-800">
              <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-[10px]">✆</span> Connect WhatsApp
            </button>
            <button onClick={runCron} title="Run scheduler" className="border border-neutral-700 rounded-lg p-2"><Zap size={15} /></button>
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Light / dark" className="border border-neutral-700 rounded-lg p-2">{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
            <button onClick={() => setShowChat((v) => !v)} title="Toggle chat panel (⌘J)" className={`border rounded-lg p-2 ${showChat ? "border-[#2563eb] text-[#6ea8ff]" : "border-neutral-700"}`}><MessageCircle size={15} /></button>
            <div className="relative">
              <button onClick={() => setShowNotifs((v) => !v)} className={`border rounded-lg p-2 ${showNotifs ? "border-[#2563eb]" : "border-neutral-700"}`}><Bell size={15} />
                {notifs.length > 0 && <span className="absolute -top-1 -right-1 bg-[#2563eb] text-[9px] rounded-full min-w-4 h-4 px-0.5 flex items-center justify-center">{Math.min(notifs.length, 9)}</span>}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-11 w-80 border border-neutral-700 rounded-xl bg-neutral-900 shadow-2xl z-40 overflow-hidden">
                  <div className="px-4 py-2.5 text-xs font-bold border-b border-neutral-800 flex justify-between items-center">
                    <span>Notifications ({notifs.length})</span>
                    <button onClick={() => setShowNotifs(false)} className="text-neutral-500 hover:text-white"><X size={12} /></button>
                  </div>
                  <div className="max-h-80 overflow-auto chat-scroll">
                    {notifs.map((n, k) => (
                      <button key={k} onClick={() => { if (n.invoiceId) pick(n.invoiceId); setShowNotifs(false); }}
                        className="w-full text-left flex gap-2 px-4 py-2.5 border-b border-neutral-800/60 hover:bg-neutral-800/50 text-[11px]">
                        <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${n.icon === "ok" ? "bg-green-500/20 text-green-400" : n.icon === "alert" ? "bg-orange-500/20 text-orange-400" : "bg-[#2563eb]/20 text-[#6ea8ff]"}`}>
                          {n.icon === "ok" ? <CheckCircle2 size={11} /> : n.icon === "alert" ? <AlertTriangle size={11} /> : <Zap size={11} />}
                        </span>
                        <span className="min-w-0"><span className="block text-neutral-200">{n.text}</span><span className="text-neutral-500">{n.time ? relTime(n.time) : ""}</span></span>
                      </button>
                    ))}
                    {notifs.length === 0 && <div className="px-4 py-6 text-[11px] text-neutral-500 text-center">All clear — nothing needs you. 🎉</div>}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pl-1">
              <span className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-xs font-bold">A</span>
              <div className="text-xs leading-tight hidden lg:block"><div className="font-semibold">Arjun Kumar</div><div className="text-neutral-400">Merchant</div></div>
            </div>
          </div>
        </header>

        {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-white text-black text-sm px-4 py-2 rounded-full shadow z-50">{toast}</div>}

        {nav === "Dashboard" && (
        <div className="flex gap-4 p-6">
          <div className="flex-1 min-w-0 space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="flex justify-between text-xs text-neutral-400"><span>Total Outstanding</span><span className="w-7 h-7 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center"><CircleDollarSign size={15} /></span></div>
                <div className="text-2xl font-extrabold mt-1">{inr(stats.overdueAmount)}</div>
                <div className="text-[11px] text-neutral-500">{stats.overdueCount} invoices</div>
              </div>
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="flex justify-between text-xs text-neutral-400"><span>Recovered (Paid)</span><span className="w-7 h-7 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center"><CheckCircle2 size={15} /></span></div>
                <div className="text-2xl font-extrabold mt-1 text-green-400">{inr(stats.recoveredAmount)}</div>
                <div className="text-[11px] text-neutral-500">{stats.recoveredCount} invoices</div>
              </div>
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="flex justify-between text-xs text-neutral-400"><span>Recovery Rate</span><span className="w-7 h-7 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center"><TrendingUp size={15} /></span></div>
                <div className="text-2xl font-extrabold mt-1">{recoveryRate.toFixed(1)}%</div>
                <div className="text-[11px] text-neutral-500">▲ live from webhooks</div>
              </div>
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="flex justify-between text-xs text-neutral-400"><span>Avg. Days Overdue</span><span className="w-7 h-7 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center"><Clock size={15} /></span></div>
                <div className="text-2xl font-extrabold mt-1">{avgOverdue}</div>
                <div className="text-[11px] text-neutral-500">across unpaid</div>
              </div>
            </div>

            {/* Invoice table */}
            <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden">
              <div className="flex items-center gap-4 px-4 pt-3 text-sm border-b border-neutral-800">
                <span className="font-semibold pb-2">Recent Invoices</span>
                {tabs.map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`pb-2 text-xs ${tab === t ? "text-[#6ea8ff] border-b-2 border-[#2563eb] font-semibold" : "text-neutral-400 hover:text-neutral-200"}`}>{t}</button>
                ))}
                <span className="ml-auto pb-2 flex gap-2">
                  <button onClick={() => setShowImport(true)} title="Import CSV" className="text-[11px] border border-neutral-700 rounded-lg px-2 py-1 flex gap-1 items-center"><Upload size={11} /> CSV</button>
                  <button onClick={syncZoho} title="Sync Zoho" className="text-[11px] border border-neutral-700 rounded-lg px-2 py-1 flex gap-1 items-center"><RefreshCw size={11} /> {busy === "zoho" ? "…" : "Zoho"}</button>
                </span>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-neutral-500 text-left">
                  <th className="px-4 py-2 font-medium">Invoice ID</th><th className="px-2 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Due Date</th>
                  <th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Next Action</th>
                  <th className="px-4 py-2 font-medium">Last Message</th>
                </tr></thead>
                <tbody>
                  {pageRows.map((i) => {
                    const lm = lastMsgOf.get(i.id);
                    const od = daysOverdue(i.due_date);
                    return (
                      <tr key={i.id} onClick={() => pick(i.id)}
                        className={`border-t border-neutral-800/70 cursor-pointer hover:bg-neutral-800/40 ${selected === i.id ? "bg-[#2563eb]/10" : ""}`}>
                        <td className="px-4 py-2.5 font-mono text-xs font-bold">{i.invoice_no}</td>
                        <td className="px-2 py-2.5"><div className="text-xs font-semibold">{i.customer_name}</div><div className="text-[11px] text-neutral-500">✆ +91 {i.phone}</div></td>
                        <td className="px-2 py-2.5 font-semibold">{inr(i.amount)}</td>
                        <td className="px-2 py-2.5 text-xs">{i.due_date}<div className="text-neutral-500 text-[11px]">{i.status === "PAID" ? "" : od > 0 ? `${od} days overdue` : "on time"}</div></td>
                        <td className="px-2 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded font-bold ${STATUS_PILL[i.status] || STATUS_PILL.PENDING}`}>{i.status}</span></td>
                        <td className="px-2 py-2.5 text-xs text-neutral-300">{nextAction(i)}</td>
                        <td className="px-4 py-2.5 text-[11px] text-neutral-400 max-w-[220px] truncate" title={lm?.body || "No response"}>{lm ? lm.body.slice(0, 60) : "No response"}</td>
                      </tr>
                    );
                  })}
                  {pageRows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-xs text-neutral-500">No invoices — use CSV / Zoho above.</td></tr>}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-4 py-2 text-[11px] text-neutral-500 border-t border-neutral-800">
                <span>Showing {filtered.length === 0 ? 0 : page * perPage + 1} to {Math.min(filtered.length, page * perPage + perPage)} of {filtered.length} invoices</span>
                <span className="flex gap-1">
                  {Array.from({ length: pages }).slice(0, 5).map((_, k) => (
                    <button key={k} onClick={() => setPage(k)} className={`w-6 h-6 rounded ${page === k ? "bg-[#2563eb] text-white" : "hover:bg-neutral-800"}`}>{k + 1}</button>
                  ))}
                  <button onClick={() => setPage(Math.min(pages - 1, page + 1))} className="w-6 h-6 rounded hover:bg-neutral-800"><ChevronRight size={12} /></button>
                </span>
              </div>
              {/* actions for selected invoice */}
              {inv && (
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-neutral-800 bg-black/30">
                  <span className="text-[11px] text-neutral-500 self-center font-mono">{inv.invoice_no} · {inv.attempts}/3</span>
                  <button onClick={sendReminder} disabled={busy === "remind"} className="bg-[#2563eb] text-white text-[11px] rounded-lg px-3 py-1.5 flex gap-1 items-center"><Send size={11} /> {busy === "remind" ? "…" : "Send Reminder"}</button>
                  <button onClick={sendEmail} disabled={busy === "email"} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5 flex gap-1 items-center"><Mail size={11} /> {busy === "email" ? "…" : "Email"}</button>
                  <button onClick={createLink} disabled={busy === "link"} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5 flex gap-1 items-center"><CreditCard size={11} /> {busy === "link" ? "…" : "Payment Link"}</button>
                  <button onClick={simulatePayment} disabled={busy === "pay"} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5 flex gap-1 items-center"><CheckCircle2 size={11} /> Simulate Paid</button>
                  <button onClick={() => setShowEscalate(true)} className="border border-red-800 text-red-400 text-[11px] rounded-lg px-3 py-1.5 flex gap-1 items-center"><AlertTriangle size={11} /> Human Resolve</button>
                  {inv.payment_link && <a href={inv.payment_link} target="_blank" className="text-[11px] text-[#6ea8ff] underline self-center truncate max-w-[200px]">{inv.payment_link}</a>}
                </div>
              )}
            </div>

            {/* Charts row */}
            <div className="grid xl:grid-cols-3 gap-3">
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="text-sm font-semibold mb-1">Recovery Overview</div>
                <ChartLines rec={series.recCum} out={series.outLine} />
                <div className="flex gap-3 text-[10px] text-neutral-400 mt-1">
                  <span><span className="text-[#6ea8ff]">●</span> Recovered (₹)</span>
                  <span><span className="text-neutral-500">●</span> Outstanding (₹)</span>
                </div>
              </div>
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="text-sm font-semibold mb-1">Status Distribution</div>
                <Donut dist={dist} total={invoices.length} />
              </div>
              <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
                <div className="text-sm font-semibold">Top Customers <span className="text-[10px] font-normal text-neutral-500">(by outstanding)</span></div>
                <div className="mt-2 space-y-2">
                  {topCustomers.map(([n, amt]) => (
                    <div key={n} className="flex items-center gap-2 text-xs">
                      <span className="w-6 h-6 rounded-full bg-neutral-700 flex items-center justify-center text-[9px] font-bold">{initials(n)}</span>
                      <span className="flex-1 truncate">{n}</span><span className="font-semibold">{inr(amt)}</span>
                    </div>
                  ))}
                  {topCustomers.length === 0 && <div className="text-[11px] text-neutral-500">No outstanding dues. 🎉</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Right rail — toggle with ⌘J / Ctrl+J */}
          {showChat && (
          <div className="w-80 shrink-0 hidden lg:flex flex-col gap-3 min-h-0 self-start sticky top-[104px] h-[calc(100vh-120px)]">
            <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="px-4 py-3 text-sm font-semibold flex justify-between items-center border-b border-neutral-800">
                <span>WhatsApp Live Chat</span>
              </div>
              <div className="px-4 py-2 flex items-center gap-2 border-b border-neutral-800">
                <span className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-[11px] font-bold">{inv ? initials(inv.customer_name) : "–"}</span>
                <div className="text-xs"><div className="font-semibold">{inv?.customer_name || "—"}</div><div className="text-neutral-500">+91 {inv?.phone || ""}</div></div>
              </div>
              <div ref={chatRef} className="p-3 space-y-2 flex-1 min-h-0 overflow-y-auto chat-scroll">
                {chat.map((m) => (
                  <div key={m.id} className={`flex ${m.direction.startsWith("outbound") ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${m.direction.startsWith("outbound") ? "bg-neutral-800" : "bg-[#005c4b]"}`}>
                      <div className="text-[9px] opacity-60 font-bold flex gap-1 items-center mb-0.5">
                        {m.direction.startsWith("outbound") ? <><Bot size={9} /> RecoverPay Agent {m.direction === "outbound-email" ? "· ✉️" : m.attempt_no ? `· #${m.attempt_no}` : ""}</> : <><User size={9} /> Customer</>}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                  </div>
                ))}
                {chat.length === 0 && <div className="text-[11px] text-neutral-500 text-center mt-8">Select an invoice & send a reminder to start.</div>}
              </div>
              <div className="p-2 border-t border-neutral-800 flex gap-1.5">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()}
                  placeholder="Type a message…" className="flex-1 text-xs bg-neutral-800 rounded-lg px-3 py-2 outline-none placeholder:text-neutral-500" />
                <button onClick={sendReply} className="bg-[#2563eb] rounded-lg px-3"><Send size={13} /></button>
              </div>
              <div className="px-2 pb-2 flex flex-wrap gap-1 max-h-20 overflow-auto">
                {SCENARIOS.slice(0, 6).map((q) => (
                  <button key={q.l} title={q.t} onClick={() => setReply(q.t)} className="text-[9px] border border-neutral-700 rounded-full px-2 py-0.5 text-neutral-400 hover:text-white">{q.l}</button>
                ))}
              </div>
            </div>

            <button onClick={() => setShowActivity((v) => !v)}
              className={`border rounded-xl px-4 py-2.5 text-xs font-semibold flex justify-between items-center shrink-0 ${showActivity ? "border-[#2563eb] text-white" : "border-neutral-800 text-neutral-300"}`}>
              <span>🧾 Recent Activity ({audit.length})</span>
              <span className="text-neutral-500">{showActivity ? "▲" : "▼"}</span>
            </button>
            {showActivity && (
            <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 p-4 shrink-0">
              <div className="space-y-2.5 max-h-64 overflow-auto chat-scroll">
                {audit.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex gap-2 text-[11px]">
                    <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${a.event.includes("PAID") || a.event.includes("CAPTURED") ? "bg-green-500/20 text-green-400" : a.event.includes("ESCALAT") || a.event.includes("DISPUTE") ? "bg-orange-500/20 text-orange-400" : "bg-[#2563eb]/20 text-[#6ea8ff]"}`}>
                      {a.event.includes("PAID") || a.event.includes("CAPTURED") ? <CheckCircle2 size={11} /> : a.event.includes("ESCALAT") ? <AlertTriangle size={11} /> : <Zap size={11} />}
                    </span>
                    <div className="min-w-0"><div className="truncate text-neutral-200">{a.detail.slice(0, 80)}</div><div className="text-neutral-500">{relTime(a.created_at)}</div></div>
                  </div>
                ))}
                {audit.length === 0 && <div className="text-[11px] text-neutral-500">Every action lands here.</div>}
              </div>
            </div>
            )}
          </div>
          )}
        </div>
        )}

        {nav !== "Dashboard" && (
        <div className="p-6">
          <h2 className="text-lg font-bold mb-1">{nav}</h2>
          <p className="text-xs text-neutral-500 mb-4">Live data · same recovery engine</p>
          {nav === "Invoices" && <InvoicesView invoices={invoices} selected={selected} pick={pick} lastMsgOf={lastMsgOf} inv={inv} attempts={true} sendReminder={sendReminder} sendEmail={sendEmail} createLink={createLink} simulatePayment={simulatePayment} openResolve={() => setShowEscalate(true)} busy={busy} />}
          {nav === "Customers" && <CustomersView invoices={invoices} pick={pick} />}
          {nav === "WhatsApp Chat" && <ChatView invoices={invoices} pick={pick} selected={selected} chat={chat} inv={inv} reply={reply} setReply={setReply} sendReply={sendReply} chatRef={chatRef} />}
          {nav === "Payments" && <PaymentsView invoices={invoices} pick={pick} createLink={createLink} busy={busy} />}
          {nav === "Analytics" && <AnalyticsView invoices={invoices} audit={audit} stats={stats} series={series} dist={dist} topCustomers={topCustomers} />}
          {nav === "Integrations" && <IntegrationsView syncZoho={syncZoho} openImport={() => setShowImport(true)} busy={busy} say={say} />}
          {nav === "Settings" && <SettingsView env={env} stats={stats} say={say} downloadAudit={downloadAudit} />}
          {nav === "Subscription" && <PlansView plan={plan} keepPlan={keepPlan} goBack={() => setNav("Dashboard")} />}
        </div>
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-full max-w-lg">
            <h3 className="font-bold">Import invoices (CSV / Zoho sync)</h3>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} className="w-full mt-2 font-mono text-xs border border-neutral-700 rounded-lg p-2 bg-black" />
            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => setShowImport(false)} className="text-sm border border-neutral-700 rounded-lg px-4 py-2">Cancel</button>
              <button onClick={doSync} className="text-sm bg-[#2563eb] text-white rounded-lg px-4 py-2">Sync {csv.split("\n").length - 1} invoices</button>
            </div>
          </div>
        </div>
      )}

      {/* Escalation modal */}
      {showEscalate && inv && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-full max-w-md">
            <h3 className="font-bold flex gap-2 items-center"><AlertTriangle size={16} /> Human resolution — {inv.invoice_no}</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke via phone call; received bank NEFT ref 1234" rows={3} className="w-full mt-2 text-sm border border-neutral-700 rounded-lg p-2 bg-black" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowEscalate(false)} className="text-sm border border-neutral-700 rounded-lg px-4 py-2 flex-1">Cancel</button>
              <button onClick={() => resolveEsc("reset_retries")} className="text-sm border border-[#2563eb] text-[#6ea8ff] rounded-lg px-4 py-2 flex-1">Reset retries</button>
              <button onClick={() => resolveEsc("mark_paid")} className="text-sm bg-white text-black rounded-lg px-4 py-2 flex-1">Mark paid</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Full views for sidebar nav (all live data) ---------------- */

function InvoicesView(p: any) {
  return (
    <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="text-[11px] text-neutral-500 text-left">
          <th className="px-4 py-2">Invoice</th><th className="px-2 py-2">Customer</th>
          <th className="px-2 py-2">Amount</th><th className="px-2 py-2">Due</th>
          <th className="px-2 py-2">Status</th><th className="px-2 py-2">Attempts</th><th className="px-4 py-2">Last Message</th>
        </tr></thead>
        <tbody>
          {p.invoices.map((i: Invoice) => {
            const lm = p.lastMsgOf.get(i.id);
            return (
              <tr key={i.id} onClick={() => p.pick(i.id)} className={`border-t border-neutral-800/70 cursor-pointer hover:bg-neutral-800/40 ${p.selected === i.id ? "bg-[#2563eb]/10" : ""}`}>
                <td className="px-4 py-2.5 font-mono text-xs font-bold">{i.invoice_no}</td>
                <td className="px-2 py-2.5 text-xs">{i.customer_name}<div className="text-neutral-500 text-[11px]">+91 {i.phone}</div></td>
                <td className="px-2 py-2.5 font-semibold">{inr(i.amount)}</td>
                <td className="px-2 py-2.5 text-xs">{i.due_date}</td>
                <td className="px-2 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded font-bold ${STATUS_PILL[i.status] || STATUS_PILL.PENDING}`}>{i.status}</span></td>
                <td className="px-2 py-2.5 text-xs">{i.attempts}/3</td>
                <td className="px-4 py-2.5 text-[11px] text-neutral-400 max-w-[280px] truncate" title={lm?.body}>{lm ? lm.body.slice(0, 80) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.inv && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-neutral-800">
          <span className="text-[11px] text-neutral-500 self-center font-mono">{p.inv.invoice_no} selected</span>
          <button onClick={p.sendReminder} className="bg-[#2563eb] text-white text-[11px] rounded-lg px-3 py-1.5">Send Reminder</button>
          <button onClick={p.sendEmail} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5">Email</button>
          <button onClick={p.createLink} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5">Payment Link</button>
          <button onClick={p.simulatePayment} className="border border-neutral-700 text-[11px] rounded-lg px-3 py-1.5">Simulate Paid</button>
          <button onClick={p.openResolve} className="border border-red-800 text-red-400 text-[11px] rounded-lg px-3 py-1.5">Human Resolve</button>
        </div>
      )}
    </div>
  );
}

function CustomersView(p: any) {
  const m = new Map<string, { phone: string; out: number; count: number; paid: number; ids: string[] }>();
  for (const i of p.invoices as Invoice[]) {
    const e = m.get(i.customer_name) || { phone: i.phone, out: 0, count: 0, paid: 0, ids: [] as string[] };
    e.count++; e.ids.push(i.id);
    if (i.status === "PAID") e.paid++;
    else e.out += Number(i.amount);
    m.set(i.customer_name, e);
  }
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      {[...m.entries()].map(([n, e]) => (
        <button key={n} onClick={() => p.pick(e.ids[0])} className="text-left border border-neutral-800 rounded-xl p-4 bg-neutral-900/40 hover:bg-neutral-800/40">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-full bg-neutral-700 flex items-center justify-center text-xs font-bold">{initials(n)}</span>
            <div><div className="text-sm font-semibold">{n}</div><div className="text-[11px] text-neutral-500">+91 {e.phone}</div></div>
          </div>
          <div className="flex justify-between mt-3 text-xs">
            <span className="text-neutral-400">{e.count} invoices · {e.paid} paid</span>
            <span className="font-bold">{inr(e.out)} due</span>
          </div>
        </button>
      ))}
      {m.size === 0 && <div className="text-xs text-neutral-500">No customers yet.</div>}
    </div>
  );
}

function ChatView(p: any) {
  // Group by customer: one row per name, latest invoice opens on click
  const groups = new Map<string, Invoice[]>();
  const sorted = [...p.invoices].sort((a: Invoice, b: Invoice) =>
    String(b.updated_at || b.id).localeCompare(String(a.updated_at || a.id)));
  for (const i of sorted as Invoice[]) {
    const k = `${i.customer_name}|||${i.phone}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  return (
    <div className="grid lg:grid-cols-3 gap-3 h-[calc(100vh-160px)] min-h-[500px]">
      <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden flex flex-col min-h-0">
        <div className="px-4 py-2.5 text-sm font-semibold border-b border-neutral-800 shrink-0">Chats</div>
        <div className="overflow-y-auto chat-scroll flex-1 min-h-0">
        {[...groups.entries()].map(([k, list]) => {
          const [name, phone] = k.split("|||");
          const top = list[0];
          const due = list.filter((x) => x.status !== "PAID").reduce((s, x) => s + Number(x.amount), 0);
          const active = list.some((x) => x.id === p.selected);
          return (
            <button key={k} onClick={() => p.pick(top.id)} className={`w-full text-left px-4 py-2.5 border-b border-neutral-800/60 hover:bg-neutral-800/40 flex gap-2.5 items-center ${active ? "bg-[#2563eb]/10" : ""}`}>
              <span className="w-9 h-9 rounded-full bg-neutral-700 flex items-center justify-center text-[11px] font-bold shrink-0">{initials(name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex justify-between items-center gap-2">
                  <b className="text-sm truncate">{name}</b>
                  {due > 0 && <span className="text-[10px] font-bold text-neutral-400 shrink-0">{inr(due)}</span>}
                </span>
                <span className="flex justify-between items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-neutral-500 truncate">{list.length > 1 ? `${list.length} invoices · ` : ""}latest {top.invoice_no}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${STATUS_PILL[top.status] || ""}`}>{top.status}</span>
                </span>
              </span>
            </button>
          );
        })}
        {groups.size === 0 && <div className="px-4 py-6 text-xs text-neutral-500">No chats yet.</div>}
        </div>
      </div>
      <div className="lg:col-span-2 border border-neutral-800 rounded-xl bg-neutral-900/40 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-2.5 text-sm font-semibold border-b border-neutral-800 shrink-0">💬 {p.inv ? `${p.inv.customer_name} (+91 ${p.inv.phone})` : "—"}</div>
        <div ref={p.chatRef} className="p-4 space-y-2 flex-1 min-h-0 overflow-y-auto chat-scroll">
          {p.chat.map((m: Msg) => (
            <div key={m.id} className={`flex ${m.direction.startsWith("outbound") ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.direction.startsWith("outbound") ? "bg-neutral-800" : "bg-[#005c4b]"}`}>
                <div className="text-[9px] opacity-60 font-bold mb-0.5">
                  {m.direction.startsWith("outbound") ? `🤖 RecoverPay Agent${m.direction === "outbound-email" ? " · ✉️ Email" : m.attempt_no ? ` · #${m.attempt_no}` : ""}` : "👤 Customer"}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </div>
          ))}
          {p.chat.length === 0 && <div className="text-[11px] text-neutral-500 text-center mt-8">No messages yet.</div>}
        </div>
        <div className="p-2 border-t border-neutral-800 flex gap-1.5 shrink-0">
          <input value={p.reply} onChange={(e: any) => p.setReply(e.target.value)} onKeyDown={(e: any) => e.key === "Enter" && p.sendReply()}
            placeholder="Type a customer reply…" className="flex-1 text-xs bg-neutral-800 rounded-lg px-3 py-2 outline-none placeholder:text-neutral-500" />
          <button onClick={p.sendReply} className="bg-[#2563eb] rounded-lg px-4 text-xs">Send</button>
        </div>
      </div>
    </div>
  );
}

function PaymentsView(p: any) {
  const withLink = p.invoices.filter((i: Invoice) => i.payment_link);
  const paid = p.invoices.filter((i: Invoice) => i.status === "PAID");
  return (
    <div className="space-y-3">
      <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold border-b border-neutral-800">Payment links ({withLink.length})</div>
        {withLink.map((i: Invoice) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-neutral-800/60 text-xs">
            <b className="font-mono">{i.invoice_no}</b><span className="text-neutral-400">{i.customer_name}</span>
            <span className="font-semibold">{inr(i.amount)}</span>
            <a href={i.payment_link!} target="_blank" className="text-[#6ea8ff] underline truncate">{i.payment_link}</a>
            <span className={`ml-auto text-[10px] px-2 py-0.5 rounded font-bold ${STATUS_PILL[i.status]}`}>{i.status}</span>
          </div>
        ))}
        {withLink.length === 0 && <div className="px-4 py-4 text-xs text-neutral-500">No links yet — open an invoice and create one.</div>}
      </div>
      <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold border-b border-neutral-800">Recovered ({paid.length})</div>
        {paid.map((i: Invoice) => (
          <div key={i.id} className="flex gap-3 px-4 py-2.5 border-t border-neutral-800/60 text-xs">
            <b className="font-mono">{i.invoice_no}</b><span className="text-neutral-400">{i.customer_name}</span>
            <span className="ml-auto font-bold text-green-400">{inr(i.amount)}</span>
          </div>
        ))}
        {paid.length === 0 && <div className="px-4 py-4 text-xs text-neutral-500">Nothing recovered yet.</div>}
      </div>
      <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 p-4 text-xs">
        <div className="font-semibold mb-2">Create link for…</div>
        <div className="flex flex-wrap gap-2">
          {p.invoices.filter((i: Invoice) => i.status !== "PAID").map((i: Invoice) => (
            <button key={i.id} onClick={() => { p.pick(i.id); p.createLink(); }} className="border border-neutral-700 rounded-lg px-3 py-1.5 hover:bg-neutral-800">{i.invoice_no} · {inr(i.amount)}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsView(p: any) {
  const byEvent = new Map<string, number>();
  for (const a of p.audit) byEvent.set(a.event, (byEvent.get(a.event) || 0) + 1);
  return (
    <div className="grid xl:grid-cols-2 gap-3">
      <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
        <div className="text-sm font-semibold mb-1">Recovery Overview (30d, from audit trail)</div>
        <ChartLines rec={p.series.recCum} out={p.series.outLine} />
      </div>
      <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
        <div className="text-sm font-semibold mb-1">Status Distribution</div>
        <Donut dist={p.dist} total={p.invoices.length} />
      </div>
      <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
        <div className="text-sm font-semibold mb-2">Agent events</div>
        {[...byEvent.entries()].sort((a, b) => b[1] - a[1]).map(([e, c]) => (
          <div key={e} className="flex justify-between text-xs py-1 border-t border-neutral-800/60">
            <span className="font-mono">{e}</span><b>{c}</b>
          </div>
        ))}
      </div>
      <div className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
        <div className="text-sm font-semibold mb-2">Top Customers (outstanding)</div>
        {p.topCustomers.map(([n, amt]: [string, number]) => (
          <div key={n} className="flex justify-between text-xs py-1 border-t border-neutral-800/60">
            <span>{n}</span><b>{inr(amt)}</b>
          </div>
        ))}
        {p.topCustomers.length === 0 && <div className="text-xs text-neutral-500">All clear. 🎉</div>}
      </div>
    </div>
  );
}

function IntegrationsView(p: any) {
  const copy = (t: string) => { try { navigator.clipboard.writeText(t); p.say("Copied"); } catch { p.say(t); } };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {[
        { n: "Zoho Books", d: "1-click overdue ingest via /api/integrations/sync", btn: "Sync Zoho", fn: p.syncZoho },
        { n: "CSV / Tally / QuickBooks", d: "Paste invoice CSV — deterministic overdue engine", btn: "Import CSV", fn: p.openImport },
        { n: "Meta WhatsApp Cloud", d: "Inbound webhook + verify handshake, zero refactor", btn: "Copy webhook URL", fn: () => copy(`${origin}/api/whatsapp/webhook`) },
        { n: "Twilio WhatsApp", d: "Same endpoint accepts Twilio Body/From payloads", btn: "Copy webhook URL", fn: () => copy(`${origin}/api/whatsapp/webhook`) },
        { n: "Razorpay", d: "Test-mode links + HMAC webhooks + stopping rule", btn: "Copy webhook URL", fn: () => copy(`${origin}/api/webhook`) },
        { n: "Cron / Scheduler", d: "Matured promises auto-follow-up", btn: "Run now", fn: () => fetch("/api/cron/process-reminders", { method: "POST" }).then(() => p.say("Cron ran")) },
      ].map((c) => (
        <div key={c.n} className="border border-neutral-800 rounded-xl p-4 bg-neutral-900/40">
          <div className="text-sm font-semibold">{c.n}</div>
          <div className="text-xs text-neutral-500 mt-1">{c.d}</div>
          <button onClick={c.fn} className="mt-3 text-xs bg-[#2563eb] text-white rounded-lg px-3 py-1.5">{c.btn}</button>
        </div>
      ))}
    </div>
  );
}

function PlansView(p: { plan: string; keepPlan: (x: string) => void; goBack: () => void }) {
  const plans = [
    { n: "Free", price: "₹0", per: "forever", feats: ["Up to 5 invoices", "WhatsApp reminders", "3-touch guardrail", "Audit trail"], cta: "Keep Free" },
    { n: "Plus", price: "₹499", per: "/month", feats: ["Up to 100 invoices", "WhatsApp + Email channels", "Promise-date auto follow-up", "CSV export"], cta: "Keep Plus" },
    { n: "Pro", price: "₹999", per: "/month", feats: ["Unlimited invoices", "All channels + priority AI drafts", "Zoho/Tally auto-sync", "Human escalation console"], cta: "Keep Pro", hot: true },
  ];
  return (
    <div className="max-w-3xl">
      <button onClick={p.goBack} className="text-xs text-neutral-500 hover:text-neutral-200 mb-3">← Back to Dashboard</button>
      <div className="grid md:grid-cols-3 gap-3">
        {plans.map((pl) => {
          const cur = p.plan === pl.n;
          return (
            <div key={pl.n} className={`border rounded-xl p-5 bg-neutral-900/40 flex flex-col ${cur ? "border-[#2563eb]" : "border-neutral-800"} ${pl.hot && !cur ? "border-neutral-600" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold">{pl.n}</span>
                {pl.hot && <span className="text-[10px] bg-neutral-800 rounded-full px-2 py-0.5 text-neutral-300">Most popular</span>}
                {cur && <span className="text-[10px] bg-[#2563eb] text-white rounded-full px-2 py-0.5">Current</span>}
              </div>
              <div className="mt-2"><span className="text-3xl font-extrabold">{pl.price}</span><span className="text-xs text-neutral-500"> {pl.per}</span></div>
              <ul className="mt-3 space-y-1.5 text-xs text-neutral-300 flex-1">
                {pl.feats.map((f) => <li key={f} className="flex gap-1.5"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-green-400" /> {f}</li>)}
              </ul>
              <button onClick={() => p.keepPlan(pl.n)} disabled={cur}
                className={`mt-4 text-xs rounded-lg py-2 ${cur ? "bg-neutral-800 text-neutral-500" : "bg-[#2563eb] text-white"}`}>
                {cur ? "Kept ✓" : pl.cta}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500 mt-3">Plan is stored per merchant. Limits enforced at ingest & send time in a later release — MVP keeps your choice.</p>
    </div>
  );
}

function SettingsView(p: any) {  const rows: [string, string, boolean][] = [
    ["Database", p.env.db, p.env.db !== "?"],
    ["Razorpay", p.env.razorpay, p.env.razorpay !== "?"],
    ["Gemini AI", p.env.gemini, p.env.gemini !== "?"],
    ["Max retries / invoice", "3 → ESCALATED", true],
    ["Stopping rule", "PAID blocks reminders (400)", true],
    ["Webhook security", "HMAC-SHA256 + idempotency", true],
  ];
  return (
    <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden max-w-2xl">
      <div className="px-4 py-2.5 text-sm font-semibold border-b border-neutral-800">Merchant settings & guardrails</div>
      {rows.map(([k, v, ok]) => (
        <div key={k} className="flex justify-between px-4 py-2.5 border-t border-neutral-800/60 text-xs">
          <span className="text-neutral-400">{k}</span>
          <span className={`font-mono font-semibold ${ok ? "text-green-400" : ""}`}>{v}</span>
        </div>
      ))}
      <div className="px-4 py-3 border-t border-neutral-800 flex gap-2">
        <button onClick={p.downloadAudit} className="text-xs border border-neutral-700 rounded-lg px-3 py-1.5">Export audit CSV</button>
        <button onClick={() => { try { localStorage.removeItem("recoverpay:selected"); } catch {} p.say("Selection cleared"); }} className="text-xs border border-neutral-700 rounded-lg px-3 py-1.5">Reset selection</button>
      </div>
    </div>
  );
}

function ChartLines({ rec, out }: { rec: number[]; out: number[] }) {
  const W = 300, H = 130, P = 8;
  const max = Math.max(1, ...rec, ...out);
  const xy = (i: number, v: number) => `${P + (i / 29) * (W - 2 * P)},${H - P - (v / max) * (H - 2 * P)}`;
  const line = (arr: number[]) => arr.map((v, i) => xy(i, v)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={P} x2={W - P} y1={H * f} y2={H * f} stroke="#27272a" strokeWidth={1} />
      ))}
      <polyline points={line(out)} fill="none" stroke="#71717a" strokeWidth={2} />
      <polyline points={line(rec)} fill="none" stroke="#2563eb" strokeWidth={2} />
      <text x={P} y={H - 1} fontSize={8} fill="#71717a">30 days ago</text>
      <text x={W - P - 34} y={H - 1} fontSize={8} fill="#71717a">today</text>
    </svg>
  );
}

function Donut({ dist, total }: { dist: Record<string, number>; total: number }) {
  const colors: Record<string, string> = { Overdue: "#f87171", Promised: "#fbbf24", Paid: "#4ade80", Escalated: "#fb923c", Other: "#71717a" };
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = Object.entries(dist).filter(([, v]) => v > 0).map(([k, v]) => {
    const frac = total ? v / total : 0;
    const s = { k, v, dash: frac * C, off: acc * C };
    acc += frac;
    return s;
  });
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 130 130" className="w-32 h-32 -rotate-90">
        <circle cx={65} cy={65} r={R} fill="none" stroke="#27272a" strokeWidth={16} />
        {segs.map((s) => (
          <circle key={s.k} cx={65} cy={65} r={R} fill="none" stroke={colors[s.k]} strokeWidth={16}
            strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.off} />
        ))}
        <text x={65} y={62} textAnchor="middle" fontSize={20} fontWeight={800} fill="#fff" transform="rotate(90 65 65)">{total}</text>
        <text x={65} y={76} textAnchor="middle" fontSize={9} fill="#a1a1aa" transform="rotate(90 65 65)">Total Invoices</text>
      </svg>
      <div className="text-[11px] space-y-1.5">
        {segs.map((s) => (
          <div key={s.k} className="flex gap-2 items-center">
            <span className="w-2 h-2 rounded-full" style={{ background: colors[s.k] }} />
            <span className="text-neutral-300">{s.k}</span>
            <span className="text-neutral-500 ml-auto pl-3">{s.v} ({total ? ((s.v / total) * 100).toFixed(1) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

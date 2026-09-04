# RecoverPay — 2-Minute Judge Demo Script (Razorpay Buildathon)

## 0:00 — Problem (20s)
MSMEs lose crores to overdue B2B invoices. Accountants nag manually; bulk SMS feels like spam and burns relationships.

## 0:20 — Sync Zoho (15s)
Click **Sync Zoho**. 3 invoices ingest; overdue ones auto-flagged `OVERDUE` by deterministic engine (no LLM).

## 0:35 — AI Hinglish reminder (20s)
Select **ZH-INV-701 (Karthik)** → **Send Reminder**. Gemini drafts polite Hinglish; falls back offline. Note attempt counter `1/3`.

## 0:55 — Customer replies (25s)
Click chip **"Promise: salary 5th"**. Toast shows `PROMISE_TO_PAY → PROMISED (schedule_reminder)`. Recovery panel shows promised date; cron will auto-follow-up.

## 1:20 — Ready-to-pay → live link (20s)
Click chip **"Send link"**. Agent auto-creates a **live `rzp.io` test link** and sends it in chat — no dashboard detour. Open it: real Razorpay checkout.

## 1:40 — Webhook + stopping rule (15s)
Click **Simulate Paid** → celebration card appears; **Send Reminder** now returns 400 (stopping rule). Mention HMAC-SHA256 + idempotency + amount-match guard.

## 1:55 — Guardrails + audit (25s)
Show filter → **ESCALATED**; open **Human Resolve**, add note, mark paid. Scroll audit trail → **Export CSV** for compliance.

## Judge Q&A ammo
- "LLM hallucination risk?" → LLM drafts text only; all DB/status/payment mutations are deterministic code.
- "Real WhatsApp?" → `/api/whatsapp/webhook` accepts Meta + Twilio payloads, verify handshake included.
- "Duplicate ingestion?" → idempotent on `invoice_no` (E2E step 10 proves it).
- "Underpayment fraud?" → webhook rejects amount mismatches with 400 + flags for review.

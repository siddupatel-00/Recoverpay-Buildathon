# RecoverPay — Autonomous AI B2B Invoice Recovery Agent

MSME overdue recovery with Hinglish Gemini drafts, promise-to-pay NLP, guarded Razorpay links, deterministic stopping rule, max-3 guardrail, immutable audit trail.

## Quickstart
```bash
npm install
cp .env.example .env.local  # add GEMINI_API_KEY (optional, fallback templates work offline), Razorpay test keys
npm run dev  # http://localhost:3000
```

## E2E audit suite (9 steps)
```bash
npm run dev &  # or: npm run build && npm start
node test-e2e.mjs
```

## Key routes
- `POST /api/integrations/sync` — CSV/Zoho ingest, deterministic `dueDate < today → OVERDUE`
- `POST /api/reminders/send` — AI Hinglish draft (8s timeout → fallback), max 3, PAID→400
- `POST /api/whatsapp/webhook` — Meta/Twilio/simulator inbound → NLP intent → PROMISED/DISPUTED/…
- `POST /api/payments/create-link` — server-side Razorpay `rzp.io` link (mock when keys absent)
- `POST /api/webhook` — HMAC-SHA256 verify + idempotency → PAID → stopping rule
- `POST /api/cron/process-reminders` — promised_date matured → auto follow-up
- `GET /api/audit/export` — 1-click CSV
- `POST /api/escalations/resolve` — human mark_paid / reset_retries + note
```

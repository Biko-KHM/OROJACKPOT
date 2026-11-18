# Telegram Lottery Mini App — Revised SRS and Gemini Build Plan

Version 1.1 · October 2026 · Implementation-ready

## 1. How to use this document with Gemini

1. Save Sections 2–9 as docs/SPEC.md in your repository. At the start of every Gemini session say: Read docs/SPEC.md fully before doing anything.
2. Run Section 10 one step at a time. Paste only that step's prompt. Do not start the next step until every acceptance check of the current step passes.
3. After each step: run the tests, commit to Git, and paste any failing output back to Gemini.
4. Standing rules to give Gemini in every session:
   - TypeScript strict mode. No any.
   - No business logic in route handlers. Every state change goes through one service function in src/modules/\*/service.ts.
   - Never trust amounts, prices, roles or user IDs sent by the client.
   - No secrets in code. Read configuration from validated environment variables (zod).
   - Every step ships with automated tests.
   - Ask before adding any library not listed in this spec.

## 2. Product summary

A Telegram-integrated lottery ticket platform with three interfaces over one backend:

- **Telegram Mini App (customers):** browse campaigns, pick several numbers, hold them, pay externally (bank transfer or Telebirr), upload payment evidence, track status.
- **Web Admin Dashboard (operators):** manage campaigns, review payment evidence, approve or reject, run the draw, monitor operations, read audit logs.
- **Telegram Bot and Channel automation:** commands, admin review buttons, user notifications, campaign announcements and a live progress post.

### Decisions locked in this version

| Topic | Decision |
| --- | --- |
| Source of truth | PostgreSQL. Telegram is only an interface. |
| Stack | React + Vite + TypeScript, Tailwind, shadcn/ui, Node.js + Express + TypeScript, PostgreSQL, Prisma, S3-compatible private storage |
| Queue | MVP uses a PostgreSQL outbox table processed by a worker with FOR UPDATE SKIP LOCKED. Redis and BullMQ are postponed to v1.1. |
| Customer session | Server verifies Telegram initData, then issues a short-lived JWT access token (15 min) kept in memory, with silent re-authentication from fresh initData. No cookies for customers. |
| Admin session | Separate login with email and password plus TOTP two-factor authentication. HTTP-only, Secure, SameSite=Strict cookie plus CSRF token. 30-minute idle timeout. |
| Money | Integer minor units (BIGINT). Currency ETB. |
| Time | Stored in UTC. Displayed in Africa/Addis\_Ababa. |
| Numbers | Stored as integers, displayed zero-padded to the width of the campaign's number\_end (for example 0001). |
| Terminal records | Rejected, expired and cancelled purchases are never reopened. A retry creates a new purchase. |
| Hold time | 10 minutes by default, configurable per campaign. |
| Review timeout | Submitted payments never expire automatically. Admins are alerted after a configurable delay (default 2 hours). |

## 3. Functional requirements

### 3.1 Customer Mini App

- FR-01 Launch from the bot and authenticate with verified Telegram initData (signature and auth\_date freshness checked on the server).
- FR-02 List open campaigns with price, prize, closing date and rules.
- FR-03 Number grid for up to 2,000 numbers with search, virtualized rendering and a status legend. Statuses use both color and text or icon labels: Available, Selected, Held, Pending review, Reserved.
- FR-04 Select multiple numbers (campaign limit, default 20). Show total computed from the server price.
- FR-05 Create a hold. If any chosen number is unavailable the whole request fails with 409 and nothing is held.
- FR-06 Show payment instructions, the reference code, and a countdown to hold expiry.
- FR-07 Upload payment evidence (JPEG, PNG, WebP or PDF, max 5 MB) and an optional transaction reference and claimed amount.
- FR-08 Show purchase statuses: Awaiting payment, Pending review, Confirmed, Rejected (with reason), Expired, Cancelled.
- FR-09 Purchase history with confirmed numbers.
- FR-10 Availability refresh by short polling (every 5 seconds while the grid is visible) against a cached summary endpoint.

### 3.2 Campaign management

- FR-11 Create, edit, publish, pause, close, cancel and archive campaigns.
- FR-12 Configure title, description, prize, price, number range, sale window, purchase limit, hold minutes and payment instructions.
- FR-13 Independent number inventory per campaign.
- FR-14 Price changes affect only new purchases. A published campaign's range may only grow, or shrink only if the removed numbers are all AVAILABLE with no claims.
- FR-15 Number inventory is limited to 10,000 numbers per campaign in the MVP and is generated in the same transaction that publishes the campaign.

### 3.3 Payment review

- FR-16 Admins see evidence (via short-lived signed URL), claimed amount, reference, customer, campaign and numbers.
- FR-17 Approve or reject. Rejection requires a reason.
- FR-18 Approval confirms all numbers of a purchase atomically or none.
- FR-19 Rejection releases only that purchase's claims.
- FR-20 Flag duplicate transaction references and duplicate file hashes (SHA-256) across purchases.
- FR-21 The admin must tick a confirmation that they compared the evidence with the actual bank or Telebirr record before the Approve button is enabled.
- FR-22 Purchases above a configurable amount require approval by two different admins (default off).

### 3.4 Draw and winner selection

- FR-23 When a campaign is CLOSED, a SUPERADMIN can run one draw per prize.
- FR-24 The eligible set is exactly the numbers with CONFIRMED purchases at the moment of the draw.
- FR-25 Selection uses a cryptographically secure random source on the server (crypto.randomInt), never Math.random.
- FR-26 Store the draw record: eligible-set SHA-256 hash, count, random seed material, selected number, operator, timestamp. Draw records are immutable.
- FR-27 Publish a result announcement to the channel only after the SUPERADMIN confirms.

### 3.5 Cancellation and refunds

- FR-28 Customers may cancel only while a purchase is AWAITING\_PAYMENT.
- FR-29 After confirmation, purchases are non-refundable except when the campaign is cancelled. A cancelled campaign creates refund records (status PENDING, PAID) that admins mark manually after returning the money outside the system.

### 3.6 Telegram automation

- Commands: /start, /mytickets, /status, /help.
- Admin notifications with Approve and Reject inline buttons. A button press carries only an opaque review ID. The server re-checks that the Telegram user is an active admin and the submission is still pending.
- Customer notifications: submitted, approved, rejected (with reason), expired, cancelled, campaign cancelled.
- Channel: one announcement per campaign and one progress post edited after meaningful changes (at most once per 60 seconds) with a scheduled reconciliation every 10 minutes.
- The public channel never shows names, screenshots, references or private data.

## 4. Architecture

```
Telegram Mini App ─┐
Admin Dashboard ───┼─▶ Express API (modules/services) ─▶ PostgreSQL
Telegram Bot ──────┘            │                          ▲
                                ├─▶ Private object storage │
                                └─▶ Outbox table ─▶ Worker ┘─▶ Telegram Bot API
```

Repository layout (monorepo with npm workspaces):

```
apps/api        Express + Prisma + worker entrypoints
apps/web        React app: routes /app/* (Mini App) and /admin/* (dashboard)
packages/shared Zod schemas, types, constants
docs/SPEC.md
```

Backend modules: auth, users, lotteries, numbers, reservations, payments, admin, draws, telegram, announcements, audit, outbox. Worker jobs: expire-holds, process-outbox, reconcile-channel, review-escalation.

## 5. Data model (PostgreSQL)

Use Prisma for the schema and queries. Partial unique indexes, CHECK constraints and triggers go into hand-written SQL migrations. Core structure:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('CUSTOMER','ADMIN','SUPERADMIN');
CREATE TYPE lottery_status AS ENUM ('DRAFT','OPEN','PAUSED','CLOSED','COMPLETED','CANCELLED','ARCHIVED');
CREATE TYPE number_status AS ENUM ('AVAILABLE','HELD','PENDING_REVIEW','RESERVED');
CREATE TYPE reservation_status AS ENUM ('AWAITING_PAYMENT','PENDING_REVIEW','CONFIRMED','REJECTED','EXPIRED','CANCELLED');
CREATE TYPE payment_status AS ENUM ('SUBMITTED','APPROVED','REJECTED');
CREATE TYPE claim_status AS ENUM ('ACTIVE','RELEASED');

users (id uuid pk, telegram_user_id bigint unique not null, username, first_name, last_name,
       role user_role default 'CUSTOMER', is_blocked bool default false, created_at, updated_at)

admin_credentials (user_id uuid pk references users, email unique, password_hash, totp_secret_encrypted,
                   failed_attempts int, locked_until timestamptz)

lotteries (id uuid pk, slug unique, title, description, prize_description, status lottery_status,
           currency char(3) default 'ETB', ticket_price_minor bigint check (>0),
           number_start int check (>=0), number_end int check (>= number_start),
           max_numbers_per_purchase int default 20, hold_minutes int default 10,
           starts_at, ends_at, payment_instructions text, created_by uuid, created_at, updated_at,
           check (number_end - number_start < 10000))

lottery_numbers (id uuid pk, lottery_id fk, number_value int, status number_status default 'AVAILABLE',
                 updated_at, unique (lottery_id, number_value), unique (id, lottery_id))

reservations (id uuid pk, public_reference text unique, user_id fk, lottery_id fk,
              status reservation_status default 'AWAITING_PAYMENT', currency char(3),
              unit_price_minor bigint, ticket_count int, total_amount_minor bigint,
              hold_expires_at timestamptz, submitted_at, reviewed_at, reviewed_by,
              rejection_reason, idempotency_key text, request_hash text, created_at, updated_at,
              unique (user_id, idempotency_key), unique (id, lottery_id))

reservation_items (id uuid pk, reservation_id, lottery_id, lottery_number_id, number_value_snapshot int,
                   unit_price_minor bigint, unique (reservation_id, lottery_number_id))
   -- history table: NO unique on lottery_number_id alone

number_claims (id uuid pk, lottery_number_id fk, reservation_id fk, status claim_status default 'ACTIVE',
               expires_at timestamptz, created_at, released_at)
CREATE UNIQUE INDEX one_active_claim_per_number ON number_claims (lottery_number_id) WHERE status = 'ACTIVE';

payment_submissions (id uuid pk, reservation_id fk, submitted_by fk, storage_key, original_filename,
                     mime_type, file_size_bytes, file_sha256 text, claimed_amount_minor, payment_reference,
                     status payment_status default 'SUBMITTED', created_at)
CREATE UNIQUE INDEX one_open_submission_per_reservation ON payment_submissions (reservation_id) WHERE status = 'SUBMITTED';

payment_reviews (id uuid pk, payment_submission_id fk, reviewer_id fk, decision text, reason text,
                 compared_with_bank_record bool not null, created_at)   -- immutable

draws (id uuid pk, lottery_id fk, prize_label, eligible_count int, eligible_set_sha256 text,
       random_seed text, winning_number int, run_by fk, created_at)       -- immutable

refunds (id uuid pk, reservation_id fk, amount_minor bigint, status text, handled_by, note, created_at)

outbox_events (id uuid pk, event_type text, payload jsonb, status text default 'PENDING',
               attempts int default 0, next_attempt_at timestamptz default now(), last_error text, created_at)

notifications (id uuid pk, user_id fk, event_type, payload jsonb, status, attempts, created_at)

channel_posts (id uuid pk, lottery_id fk, chat_id bigint, message_id bigint, post_type, last_published_at)

audit_logs (id uuid pk, actor_user_id, action text, entity_type text, entity_id uuid, request_id text,
            details jsonb, created_at)
```

Integrity rules:

- The application database user has INSERT and SELECT only on audit\_logs, payment\_reviews and draws. No UPDATE or DELETE. Enforce with GRANT and a trigger that raises on UPDATE or DELETE.
- lottery\_numbers.status is a cache of the claims state. It is changed only inside the same transaction as the claim change, and a reconciliation job reports any mismatch.
- A CHECK or trigger ensures total\_amount\_minor = unit\_price\_minor \* ticket\_count.
- Indexes: lottery\_numbers (lottery\_id, status, number\_value), reservations (user\_id, created\_at DESC), reservations review queue partial index on PENDING\_REVIEW, number\_claims (reservation\_id), outbox\_events (status, next\_attempt\_at), audit\_logs (entity\_type, entity\_id, created\_at DESC).

## 6. State machines

Reservation: AWAITING\_PAYMENT → PENDING\_REVIEW (evidence submitted) → CONFIRMED or REJECTED. AWAITING\_PAYMENT → EXPIRED (hold timeout) or CANCELLED (customer cancels). All other transitions are forbidden and return 409.

Number: AVAILABLE → HELD → PENDING\_REVIEW → RESERVED. HELD or PENDING\_REVIEW → AVAILABLE on expiry, cancellation or rejection. RESERVED is final unless the campaign is cancelled.

Campaign: DRAFT → OPEN ⇄ PAUSED → CLOSED → COMPLETED (after draw). OPEN, PAUSED or CLOSED → CANCELLED. COMPLETED or CANCELLED → ARCHIVED.

## 7. Core algorithms

Each one is a single service function that runs inside one database transaction. Always use the database clock (now()) for expiry.

### 7.1 Create reservation

1. Validate the campaign is OPEN and inside its sale window; validate count within the limit; reject duplicates in the request; reject blocked users; enforce a maximum of 3 simultaneous AWAITING\_PAYMENT reservations and 5 PENDING\_REVIEW reservations per user.
2. If the idempotency key exists for this user: same request\_hash returns the stored reservation; different hash returns 422.
3. SELECT the chosen lottery\_numbers rows ORDER BY number\_value FOR UPDATE NOWAIT. If locking fails or any row is not AVAILABLE, roll back and return 409 NUMBER\_UNAVAILABLE.
4. Read the price from lotteries, never from the client. Insert reservation, reservation\_items and one ACTIVE number\_claim per number. Set numbers to HELD. Set hold\_expires\_at = now() + hold\_minutes.
5. Write an audit row and outbox events (progress update).

### 7.2 Submit payment evidence

Lock the reservation and claims. Require: owner matches, status AWAITING\_PAYMENT, hold not expired, all claims ACTIVE and owned by this reservation, stored file exists and passed validation, no open submission exists. Insert payment\_submissions, set reservation and numbers to PENDING\_REVIEW, write audit and an outbox event for the admin notification.

### 7.3 Approve

Lock submission, reservation and claims in that order. Require submission SUBMITTED, reservation PENDING\_REVIEW, claims ACTIVE and owned by the reservation, and compared\_with\_bank\_record = true. If dual approval is required for the amount, record the first approval and only confirm on the second approval by a different admin. Mark submission APPROVED, reservation CONFIRMED, numbers RESERVED. Insert payment\_reviews, audit, outbox. Never approve a subset.

### 7.4 Reject

Same locks and checks. Require a non-empty reason. Mark submission and reservation REJECTED, mark only this reservation's claims RELEASED, set those numbers AVAILABLE, then write review, audit and outbox. Repeating the request must be a no-op that returns 409 and must never touch claims owned by another reservation.

### 7.5 Expire holds (worker, every 30 seconds)

Select a batch of AWAITING\_PAYMENT reservations with hold\_expires\_at < now() using FOR UPDATE SKIP LOCKED. Re-check status inside the transaction. Mark EXPIRED, release claims, set numbers AVAILABLE, write audit and outbox. Safe to run twice. Never touches PENDING\_REVIEW.

### 7.6 Review escalation (worker)

Find PENDING\_REVIEW reservations older than the configured delay and enqueue one reminder to admins per submission per 6 hours.

### 7.7 Draw

In one transaction: require campaign CLOSED and no existing draw for the prize label. Read the confirmed numbers ordered ascending, compute SHA-256 of the joined list, pick an index with crypto.randomInt, and insert the immutable draws row. Mark the campaign COMPLETED only after all prizes are drawn.

## 8. API (versioned under /api/v1)

Customer: POST /auth/telegram, GET /me, GET /lotteries, GET /lotteries/:id, GET /lotteries/:id/numbers/summary (compact status ranges, cached 2 seconds), GET /lotteries/:id/numbers?cursor=, POST /lotteries/:id/reservations, GET /reservations/:id, POST /uploads/payment-proof, POST /reservations/:id/payment-submissions, POST /reservations/:id/cancel, GET /me/reservations, GET /me/notifications.

Admin (all require admin session, role check and CSRF): POST /admin/auth/login, POST /admin/auth/totp, POST /admin/auth/logout, GET /admin/dashboard, POST and PATCH /admin/lotteries, POST /admin/lotteries/:id/publish | pause | close | cancel, GET /admin/reservations, GET /admin/payment-submissions, GET /admin/payment-submissions/:id/evidence-url, POST /admin/payment-submissions/:id/approve | reject, POST /admin/reservations/:id/resolve, POST /admin/lotteries/:id/draw, GET /admin/audit-logs, GET and PATCH /admin/settings, GET /admin/outbox/failed.

System: POST /webhooks/telegram (secret token header checked, updates deduplicated by update\_id), GET /health/live, GET /health/ready.

Conventions: error body { error: { code, message, requestId } }; status codes 400, 401, 403, 404, 409, 413, 422, 429, 500; never leak stack traces, signed URLs or storage paths; every request gets a request ID.

## 9. Security requirements

1. Validate Telegram initData with HMAC-SHA256 using the bot token, compare in constant time, reject auth\_date older than 1 hour.
2. Authorization checks live in service functions, not only in middleware. Admin bot callbacks re-verify admin status on every press.
3. Admin login: argon2id password hashes, mandatory TOTP, lockout after 5 failed attempts, session rotation on login, idle timeout, CSRF token on every state-changing request.
4. Rate limits per Telegram user ID and per IP: reservations (10 per minute), uploads (5 per minute), auth (20 per minute). Block hoarding: repeated abandoned holds raise a flag and can auto-block creating new holds for a period.
5. File uploads: allowlist JPEG, PNG, WebP, PDF; verify magic bytes, not the extension; maximum 5 MB; re-encode images and strip EXIF; reject SVG and HTML; random storage keys; private bucket; signed URLs valid 5 minutes and issued only to admins and the owner; download with Content-Disposition attachment; SHA-256 stored for duplicate detection; optional ClamAV scan.
6. Input validation with Zod on every endpoint. Parameterized queries only (Prisma).
7. Helmet security headers, strict CORS allowlist, HTTPS only, HSTS.
8. Secrets in the host's secret manager. Rotate the bot token and webhook secret if exposed. Encrypt TOTP secrets at rest.
9. Do not log tokens, initData, payment evidence or full references. Mask personal data in logs.
10. Audit every consequential action. The audit table is append-only (see Section 5).
11. Run npm audit and a secret scanner in CI. Pin dependency versions.
12. Keep a short threat model: customer fraud (fake screenshots), inventory hoarding, insider approval abuse, account takeover of an admin, Telegram outage, data leak of evidence files. Each has a control listed above. The strongest control against fake screenshots is requirement FR-21 plus a real bank record check.
13. Privacy: collect only Telegram ID, name, username and payment evidence. Publish a privacy notice. Retention: payment evidence 12 months after campaign completion, then delete the file and keep the hash. Confirm local legal requirements.

No system is perfectly secure. Treat these controls as the baseline and re-review after the first external security test.

## 10. Step-by-step build plan for Gemini

Each step contains the prompt to paste, the deliverables and the acceptance checks.

### Step 0 — Repository and tooling

Prompt: Read docs/SPEC.md. Create an npm-workspaces monorepo with apps/api (Express, TypeScript strict, Prisma, zod, pino, vitest), apps/web (Vite, React, TypeScript, Tailwind, shadcn/ui) and packages/shared. Add ESLint, Prettier, a docker-compose.yml with PostgreSQL 16 and MinIO, an .env.example, a validated config module, a /health/live and /health/ready endpoint, and a GitHub Actions workflow that runs lint, typecheck and tests.

Acceptance: docker compose up works; npm test passes; /health/ready checks the database.

### Step 1 — Database schema and migrations

Prompt: Implement the schema from Section 5 in Prisma. Add hand-written SQL migrations for partial unique indexes, CHECK constraints, the append-only triggers on audit\_logs, payment\_reviews and draws, and the total-amount check. Add a seed script with one SUPERADMIN and one sample campaign. Write tests that prove: two ACTIVE claims on one number fail; a second SUBMITTED payment for one reservation fails; UPDATE on audit\_logs fails.

Acceptance: migrations apply to an empty database; all constraint tests pass.

### Step 2 — Authentication

Prompt: Implement POST /auth/telegram with initData verification exactly as in Section 9, user upsert, and a 15-minute JWT. Implement admin login with argon2id, TOTP enrollment and verification, lockout, cookie session and CSRF protection. Add role middleware and service-level authorization helpers. Write tests with valid, tampered and stale initData.

Acceptance: tampered or old initData is rejected; admin cannot log in without TOTP; customer token cannot call admin routes.

### Step 3 — Campaigns and inventory

Prompt: Implement the lotteries module: create, edit, publish, pause, close, cancel, archive with the state machine from Section 6 and the range rules in FR-14 and FR-15. Publishing generates lottery\_numbers in one transaction. Add the customer endpoints for listing campaigns and the numbers summary (compact ranges by status, cached 2 seconds). Write audit rows for every admin action.

Acceptance: a 2,000-number campaign publishes in under 2 seconds; invalid transitions return 409; changing the price does not alter existing reservations.

### Step 4 — Reservation service and concurrency tests (most important step)

Prompt: Implement createReservation exactly as in Section 7.1, with idempotency, per-user limits and FOR UPDATE NOWAIT in ascending order. Expose POST /lotteries/:id/reservations. Then write integration tests against a real PostgreSQL: 50 parallel requests for the same number produce exactly one success; a request with five numbers where one is held holds none; a retried request with the same idempotency key returns the original reservation; the same key with a different payload returns 422; overlapping groups of numbers across 20 parallel requests do not deadlock.

Acceptance: all concurrency tests pass 20 runs in a row.

### Step 5 — Hold expiry worker

Prompt: Implement apps/api/src/worker with the expire-holds job from Section 7.5, running every 30 seconds with SKIP LOCKED batches. Add tests: expired holds release; PENDING\_REVIEW is untouched; running the job twice in parallel releases once; a number already re-held by another buyer is not touched.

Acceptance: all tests pass.

### Step 6 — Payment upload and submission

Prompt: Implement POST /uploads/payment-proof (returns a short-lived signed upload URL to the private bucket) and POST /reservations/:id/payment-submissions following Section 7.2. Verify the stored object's size and magic bytes, compute SHA-256, re-encode images and strip EXIF, and detect duplicate hashes and references. Add tests for wrong owner, expired hold, wrong file type, oversized file and duplicate submission.

Acceptance: evidence is never publicly reachable; every negative test returns the right status code.

### Step 7 — Admin review

Prompt: Implement approve and reject exactly as in Sections 7.3 and 7.4, including the bank-record confirmation flag, optional dual approval, immutable payment\_reviews rows, and an evidence-url endpoint that returns a 5-minute signed URL and writes an audit row. Tests: double-click approve; two admins at once; reject on a stale page after the numbers were re-sold; approving a reservation whose claims are no longer active.

Acceptance: only one decision ever commits; another buyer's claims are never released.

### Step 8 — Outbox, bot and channel

Prompt: Implement the outbox writer inside the transactions above and a worker that processes outbox\_events with exponential backoff, a maximum of 8 attempts and a failed state. Implement the Telegram webhook (secret token check, update\_id deduplication), commands /start, /mytickets, /status, /help, admin review messages with Approve and Reject buttons that carry only an opaque review ID, customer notifications, the campaign announcement and an edited progress post throttled to one edit per 60 seconds, plus a 10-minute reconcile job. Handle Telegram 429 responses by honoring retry\_after.

Acceptance: with Telegram mocked as down, reservations still succeed and events are retried later; a non-admin pressing an admin button is rejected.

### Step 9 — Mini App frontend

Prompt: Build the Mini App routes under /app using the Telegram WebApp SDK: campaign list, campaign detail, a virtualized number grid for 2,000 numbers with search and an accessible legend (color plus text), selection cart with server-computed total, hold countdown, payment instructions, upload screen, status screen, history. Poll the numbers summary every 5 seconds while visible. Mobile-first and usable on low-end Android phones. Support English and Afaan Oromoo text through a translation file.

Acceptance: the grid scrolls smoothly with 2,000 items on a mid-range phone; a 409 at checkout shows a clear message and refreshes the grid.

### Step 10 — Admin dashboard

Prompt: Build /admin: login with TOTP, overview metrics from the database, campaign manager, number inventory, payment review screen (evidence viewer, expected versus claimed amount, duplicate flags, mandatory bank-record checkbox, approve and reject with reason), reservations search, customers, failed notifications and outbox view, audit log viewer, settings and admin management.

Acceptance: every action works end to end against the real API; role restrictions are visible and enforced.

### Step 11 — Draw and refunds

Prompt: Implement the draw service from Section 7.7 and a SUPERADMIN-only screen with a confirmation step, then the result announcement. Implement campaign cancellation that creates refund records and a screen for admins to mark them paid. Tests: draw is refused unless the campaign is CLOSED; second draw for the same prize is refused; the eligible set contains confirmed numbers only; the stored hash matches a recomputation.

Acceptance: all tests pass.

### Step 12 — Hardening and load test

Prompt: Add rate limits, Helmet, strict CORS, request IDs and structured logs. Write a k6 script that simulates 500 users browsing and 100 users contending for 50 numbers; report p95 latency and the number of double-bookings (must be zero). Run npm audit and a secret scan. Write a short threat model and a security checklist in docs/SECURITY.md and fix everything that fails.

Acceptance: p95 read latency below 500 ms locally; zero double-bookings; no high-severity audit findings.

### Step 13 — Deployment and handover

Prompt: Write Dockerfiles for API and worker, deployment instructions for a VPS or container platform with HTTPS, managed PostgreSQL with daily backups, a private object storage bucket, webhook setup, channel permissions for the bot, a backup-restore script and a runbook. Write the admin user guide and a test report listing every acceptance test in Section 11.

Acceptance: the restore script recovers a backup into a clean database; the client can run an end-to-end purchase on a real phone.

## 11. Acceptance tests (client sign-off)

| Test | Condition |
| --- | --- |
| Concurrent selection | Two simultaneous requests for one number: exactly one succeeds. |
| Atomic checkout | One unavailable number among five: none held. |
| Idempotency | Retried request returns the original reservation. |
| Expiry | Abandoned hold released after the configured time; pending review never expired. |
| Evidence privacy | Files reachable only through short-lived signed URLs by the owner or admins. |
| Approval | All numbers of a purchase become RESERVED together; a double-click has no extra effect. |
| Rejection | Only that purchase's claims are released; a reason is required. |
| Authorization | A customer cannot view another customer's evidence or call admin routes. |
| Campaign isolation | Same number labels in two campaigns are independent. |
| Outage | Telegram down: reservations succeed, notifications retry. |
| Recovery | Worker restart loses no committed reservation or queued event. |
| Draw | Winner chosen from confirmed numbers only; record immutable and hash verifiable. |
| Backup | A backup restores into a clean environment. |

## 12. Legal and business checklist (before launch)

- Confirm whether a paid prize draw needs a license or permit in Ethiopia and what registration the operator must hold.
- Check Telegram's current terms for gambling-like Mini Apps and channels.
- Publish rules: prices, eligibility, closing date, prizes, how the winner is chosen, cancellation and refund policy, and how winners are contacted.
- Do not state that a screenshot proves a payment settled.
- Keep tax and accounting records for confirmed sales outside this system as required.

## 13. Scope and later versions

MVP: Sections 3 to 9 and Steps 0 to 13. Later: automatic payment verification through a provider API, Redis and BullMQ, promotion codes, advanced analytics, multiple channels, campaign templates. Do not add AI payment verification or fraud scoring to the MVP.

Note on timeline: for one developer working with an AI coding assistant, plan 8 to 10 weeks. Steps 4, 7 and 12 are the ones that must never be skipped or rushed.

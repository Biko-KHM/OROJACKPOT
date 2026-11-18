# Security Architecture, Threat Model, and Operational Checklist

**Platform:** Telegram Lottery Mini App (ETB Currency, Federal Democratic Republic of Ethiopia)  
**Version:** 1.0.0 (Production Hardened)  
**Status:** Approved for Step 12  

---

## 1. Executive Summary & Security Objectives

The platform facilitates the purchase, manual external settlement (via Commercial Bank of Ethiopia, Telebirr, Awash Bank, etc.), verification, and verifiable cryptographic drawing of lottery tickets. Because real money is involved and payments occur outside Telegram, the system is designed under a **Zero-Trust Client** architecture:

1. **PostgreSQL as the Single Source of Truth:** Telegram is treated purely as an untrusted UI presentation layer.
2. **Defensive Concurrency:** Zero tolerance for double-bookings. Strict row-level pessimistic locking (`SELECT ... FOR UPDATE NOWAIT`) in ascending order guarantees that no number can ever be held or purchased twice.
3. **Cryptographic Verifiability:** Draws are executed with CSPRNG (`crypto.randomInt`), generating an immutable SHA-256 fingerprint over ordered confirmed numbers, protected by PostgreSQL database triggers that disallow UPDATE or DELETE operations.
4. **Fraud Mitigation:** Automated SHA-256 duplicate image hashing, duplicate transaction reference flags, and mandatory operator bank-record confirmation before ticket approval.
5. **Defense in Depth:** Argon2id password hashing, mandatory TOTP (RFC 6238), append-only audit logging, rate limiting, and encrypted secrets at rest.

---

## 2. Threat Model & Mitigation Matrix

| Threat ID | Threat Description | Attack Vector / Scenario | Severity | Architectural Controls & Mitigations |
| :--- | :--- | :--- | :--- | :--- |
| **THREAT-01** | **Customer Payment Fraud (Fake Receipts)** | Buyer submits a doctored screenshot, photo of an old receipt, or an altered Telebirr SMS. | **CRITICAL** | • **FR-21 Confirmation:** Approval is disabled in the Admin UI until the operator ticks the mandatory checkbox confirming cross-referencing with the official CBE / Telebirr statement.<br>• **SHA-256 Fingerprinting:** Stored evidence files are hashed; duplicate submissions across any reservation are immediately flagged with alert badges.<br>• **Duplicate Reference Check:** Bank reference codes are checked across all reservations. |
| **THREAT-02** | **Inventory Hoarding & Denial of Service** | Malicious actor or bot script holds dozens of ticket numbers without paying, starving genuine buyers until the campaign ends. | **HIGH** | • **Strict User Limits:** Maximum 3 unpaid holds (`AWAITING_PAYMENT`) and maximum 5 holds under review (`PENDING_REVIEW`) per Telegram user.<br>• **Anti-Hoarding Heuristic:** If a user accumulates $\ge 5$ expired holds in 1 hour without any confirmed purchase, new reservations are automatically blocked for 30 minutes, and an audit flag is raised.<br>• **Rate Limiting:** `reservationsRateLimiter` enforces a strict ceiling of 10 holds per minute per user/IP. |
| **THREAT-03** | **Insider / Rogue Operator Abuse** | A compromised or colluding administrator attempts to approve tickets without actual funds arriving, or attempts to modify draw results. | **CRITICAL** | • **Dual Approval Mode:** Configurable setting where ticket purchases above a threshold (e.g. 10,000 ETB) require two distinct admin approvals.<br>• **Role Separation:** Standard operators cannot execute draws or announce winners (SUPERADMIN role required).<br>• **Append-Only Triggers:** `audit_logs`, `payment_reviews`, and `draws` tables are protected by PostgreSQL triggers (`prevent_record_mutation()`) that unconditionally throw exceptions on `UPDATE` or `DELETE`. |
| **THREAT-04** | **Admin Account Takeover** | Credential stuffing, brute-force password guessing, or session token theft targeting the operator dashboard. | **CRITICAL** | • **Argon2id Hashing:** Industry-standard memory-hard password hashing.<br>• **Mandatory 2FA (TOTP):** Admin login is a two-step handshake; passwords alone cannot issue sessions. TOTP secrets are encrypted at rest with AES-256-GCM.<br>• **Account Lockout:** 5 consecutive failed login attempts lock the credential for 15 minutes.<br>• **Session Security:** HTTP-only, `SameSite=Strict`, `Secure` session cookies, coupled with rotating anti-CSRF tokens validated on all mutating HTTP verbs. |
| **THREAT-05** | **Telegram Webhook Spoofing & Replay** | Attacker sends forged HTTP POST requests to `/webhooks/telegram` pretending to be the Telegram Bot API. | **HIGH** | • **Secret Token Verification:** Every webhook request must contain the `X-Telegram-Bot-Api-Secret-Token` matching the server's cryptographic secret.<br>• **Update Deduplication:** Telegram `update_id`s are logged and deduplicated to eliminate replay attacks. |
| **THREAT-06** | **Evidence File Exposure & Data Leaks** | Unauthorized individuals discover URLs to customer bank deposit slips or transfer receipts. | **HIGH** | • **Private Storage:** Storage buckets (MinIO / S3) have public read/write disabled.<br>• **Short-Lived Presigned URLs:** Download URLs are signed using HMAC-SHA256 with a strict 5-minute lifespan.<br>• **Authorization Enforcement:** Evidence URLs are only issued to the authenticated reservation owner or active administrative operators.<br>• **Attachment Forcing:** Files are downloaded with `Content-Disposition: attachment` to prevent stored XSS attacks via browser rendering. |
| **THREAT-07** | **Concurrency Races & Double Bookings** | Multiple users click the exact same popular ticket numbers (e.g. `#0001`, `#0777`) at the exact same millisecond. | **CRITICAL** | • **Ascending Pessimistic Locking:** Database queries acquire row-level locks via `SELECT ... FROM lottery_numbers WHERE ... ORDER BY number_value ASC FOR UPDATE NOWAIT`.<br>• **All-or-Nothing Holds:** If even one requested number is unavailable or locked, the transaction rolls back immediately and returns HTTP 409 `NUMBER_UNAVAILABLE`. |
| **THREAT-08** | **Draw Rigging & Prediction** | An attacker or dishonest administrator attempts to manipulate the random selection or predict the winning number in advance. | **CRITICAL** | • **CSPRNG Selection:** Node.js native `crypto.randomInt` (backed by the OS entropy source `/dev/urandom` or Windows CryptGenRandom) is strictly used; `Math.random` is prohibited.<br>• **Ascending Eligible Set SHA-256:** The winning pool is locked to strictly confirmed tickets ordered ascending. A SHA-256 hash is computed over `numbers.join(',')` and stored permanently for public verification.<br>• **State Requirement:** Draws are refused by the database transaction unless campaign status is `CLOSED`. |

---

## 3. Comprehensive Security Checklist

### 3.1 Network & Infrastructure Security
- [x] **Helmet Headers:** CSP, HSTS (`max-age=31536000; includeSubDomains`), `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.
- [x] **Strict CORS Policy:** Whitelist restricted to configured origins (`config.CORS_ORIGIN`); wildcards prohibited when credentials are enabled.
- [x] **Reverse Proxy Hardening:** Nginx / Caddy handles TLS termination, enforcing TLS 1.3 and modern cipher suites.
- [x] **Request ID Tracing:** Every HTTP request receives an immutable `X-Request-Id` UUID, propagated across logs, database audit entries, and error responses.

### 3.2 Authentication & Session Management
- [x] **Customer Authentication:** Telegram `initData` is validated server-side by computing HMAC-SHA256 against `WebAppData`. Validated users receive short-lived (15-minute) JWT tokens stored strictly in memory (no persistent customer cookies).
- [x] **Admin Authentication:** Two-step login (credentials + TOTP). Session tokens stored in `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- [x] **CSRF Defense:** State-changing admin requests (`POST`, `PATCH`, `PUT`, `DELETE`) require an `x-csrf-token` header matching the signed session token.
- [x] **Session Invalidation:** Explicit logout clears the session cookie and blacklists the token.

### 3.3 Rate Limiting & Abuse Prevention
- [x] **Global Rate Limiter:** 120 requests per minute per IP to prevent flood attacks.
- [x] **Auth Limiter:** 20 requests per minute per IP on `/auth` and `/admin/auth`.
- [x] **Reservation Limiter:** 10 requests per minute per user/IP on `/lotteries/:id/reservations`.
- [x] **Upload Limiter:** 5 uploads per minute per user/IP on `/uploads`.
- [x] **Anti-Hoarding Heuristics:** Automatic temporary hold lockout for accounts with $\ge 5$ expired unpaid reservations in 1 hour.

### 3.4 Data Integrity & Storage
- [x] **File Magic-Byte Inspection:** File uploads are validated by inspecting binary headers (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`), ignoring user-supplied file extensions.
- [x] **EXIF Stripping:** Uploaded image evidence is sanitized using Sharp to remove GPS location and camera metadata.
- [x] **File Size Cap:** Maximum 5 MB per evidence file enforced at the web server and body-parser level.
- [x] **Append-Only Triggers:** SQL triggers prevent modification or deletion of historical audit logs, payment reviews, and draw records.

### 3.5 Privacy & Data Retention
- [x] **Minimal Data Collection:** Platform stores only Telegram user ID, username, first name, and payment evidence. No credit card or CVV data is ever collected or processed.
- [x] **Logging Redaction:** Pino logger automatically redacts passwords, TOTP secrets, tokens, initData strings, and full payment references.
- [x] **Retention Policy:** Payment evidence images are retained for 12 months after campaign completion for audit compliance, after which files are purged while preserving the SHA-256 cryptographic hash.

---

## 4. Emergency Incident Response Runbook

### Scenario A: Compromised Admin Credential
1. **Immediate Revocation:**
   ```sql
   -- Lock credential and force password reset
   UPDATE admin_credentials SET locked_until = NOW() + INTERVAL '7 days' WHERE email = 'compromised@lottery.et';
   ```
2. **Session Termination:** Rotate `ADMIN_JWT_SECRET` in environment configuration to immediately invalidate all outstanding admin cookies.
3. **Audit Inspection:**
   ```sql
   SELECT * FROM audit_logs WHERE actor_user_id = '<user-id>' ORDER BY created_at DESC;
   ```

### Scenario B: Suspected Telegram Bot Token Leak
1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/revoke` for the lottery bot and generate a new Bot Token.
3. Update `TELEGRAM_BOT_TOKEN` in the secret manager / `.env` file.
4. Set the new webhook URL with a newly generated `TELEGRAM_WEBHOOK_SECRET`.
5. Restart the API server and worker daemon.

### Scenario C: Uncontrolled Traffic Spike / Distributed Abuse
1. Toggle Platform Maintenance Mode:
   ```bash
   # Via Admin Dashboard Settings or direct database update:
   UPDATE platform_settings SET maintenance_mode = true;
   ```
2. In maintenance mode, reservation creation is paused while background workers continue processing existing holds and pending payment reviews.

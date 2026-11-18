# Telegram Lottery Platform — Admin & Operator User Manual

**Target Audience:** Lottery Operators, Reviewers, and Superadmins  
**Interface URL:** `https://admin.lottery.et` (or `/admin` in local deployment)  

---

## 1. Authentication & Two-Factor Setup

All administrative accounts are protected by multi-factor authentication (MFA):

1. **Step 1 — Credentials:** Navigate to `/admin`. Enter your administrator email and password.
2. **Step 2 — TOTP Authenticator:** Enter the 6-digit rolling code from your authenticator app (e.g. Google Authenticator, 1Password, Microsoft Authenticator).
3. **Session Security:**
   - Sessions are protected by an `HttpOnly`, `SameSite=Strict` cookie and a rotating CSRF token.
   - Sessions automatically time out after 30 minutes of inactivity.
   - Entering 5 incorrect passwords or TOTP codes locks your account for 15 minutes.

---

## 2. Managing Lottery Campaigns

Located under the **Campaigns** tab:

### 2.1 Campaign Lifecycle State Machine
- **DRAFT:** Initial state where rules, title, ticket prices (ETB), number range, and payment instructions can be configured freely.
- **OPEN:** Ticket sales active. The customer Mini App displays the virtualized number grid. Numbers can be held and purchased.
  - *Note:* Publishing generates the entire number inventory atomically in the database.
- **PAUSED:** Temporarily halts new ticket holds (e.g. during bank maintenance). Existing reservations can still submit payment.
- **CLOSED:** Ticket sales end. No new holds allowed. Required state before running prize draws.
- **CANCELLED:** Campaign abandoned due to undersubscription or emergency. Automatically creates `PENDING` refund records for all confirmed ticket holders.
- **COMPLETED:** All prize draws successfully executed.
- **ARCHIVED:** Read-only historical archive.

### 2.2 Setting Ticket Rules
- **Range & Inventory:** Number ranges start from 1 up to 2,000 (standard) or 10,000 (maximum MVP).
- **Price Setting:** Configured in ETB. Price changes only apply to future purchases.
- **Hold Duration:** Default is 10 minutes (configurable from 5 to 60 minutes).

---

## 3. Payment Verification & Review Workflow

Located under the **Payment Reviews** tab:

Whenever a customer uploads payment evidence, a review item appears in the queue:

### 3.1 Verification Checklist for Reviewers
1. **Compare Amounts:** Verify that the bank receipt matches the expected amount in ETB.
2. **Inspect Evidence Slip:** Click "Inspect Evidence" to open the high-resolution receipt via a 5-minute signed URL.
3. **Check Duplicate Badges (FR-20):**
   - ⚠️ **Duplicate Reference:** The transaction reference has been seen in another reservation.
   - ⚠️ **Duplicate Receipt (SHA-256):** The exact same image file was submitted previously.
4. **Mandatory Bank Statement Check (FR-21):**
   - Open your official CBE Birr / Telebirr Merchant portal.
   - Confirm funds have actually credited the account.
   - Tick the mandatory checkbox: *"I confirm that I have cross-referenced this evidence with the actual bank statement."*

### 3.2 Decision Actions
- **Approve Payment:** Atomically confirms all numbers in the reservation as `CONFIRMED` and marks the tickets as `SOLD`.
- **Reject Payment:** Mandatory rejection reason required (e.g., *"Payment not received in CBE account"*, *"Blurry unreadable receipt"*). Releases the held numbers back to `AVAILABLE`.
- **Dual Approval (FR-22):** If high-value dual approval is enabled in Settings, the first admin's approval marks the submission as `PARTIALLY_APPROVED`. A second distinct admin must approve before tickets are confirmed.

---

## 4. Executing Verifiable Cryptographic Draws

Located under the **Draws & Winners** tab:

> [!IMPORTANT]
> Draws can only be performed by administrators with the **SUPERADMIN** role. The campaign must be in **CLOSED** status.

### 4.1 Draw Execution Process
1. Select the closed campaign from the dropdown.
2. Input the Prize Label (e.g., *"Grand Prize (Toyota Land Cruiser)"*, *"2nd Prize (50,000 ETB)"*).
3. Review the eligible ticket count (strictly tickets with `CONFIRMED` status).
4. Click **"Execute Cryptographic Draw"**.
5. The system performs:
   - Deterministic sorting of all confirmed ticket numbers ascending.
   - Computation of a SHA-256 fingerprint over `numbers.join(',')`.
   - Cryptographically secure index selection via `crypto.randomInt()`.
   - Insertion into the immutable `draws` table (protected by database triggers).

### 4.2 Announcing the Winner
1. Inspect the generated **Winner Celebration Card** showing the winning ticket number, customer Telegram ID, and cryptographic SHA-256 proof.
2. Click **"Announce to Channel"**.
3. A formatted announcement is dispatched through the outbox queue to the public Telegram channel without exposing the customer's personal data.

---

## 5. Cancellation Refunds Queue

Located under the **Refunds** tab:

When a campaign is cancelled, all buyers who paid for confirmed tickets are queued for refunds:

1. Filter the queue by `PENDING` status.
2. Note the customer's Telegram ID, reservation reference, and amount in ETB.
3. Initiate the transfer through your banking application (CBE, Telebirr, Awash).
4. Click **"Mark Paid"** on the refund item.
5. Enter the external bank transfer reference in the note field and confirm.
6. The record transitions to `PAID` and an immutable audit log entry is recorded.

---

## 6. Audit Trail & Platform Settings

- **Audit Trail:** Read-only log of every administrative action (login, campaign updates, payment approvals/rejections, draws, refunds, and hoarding flags). Cannot be modified or deleted.
- **Team Management:** Invite new operators, assign `ADMIN` or `SUPERADMIN` roles, and manage credentials.
- **Platform Settings:** Toggle maintenance mode, adjust hold durations, configure customer support Telegram usernames, and toggle high-value dual approval.

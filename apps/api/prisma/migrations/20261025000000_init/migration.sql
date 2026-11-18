-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create Enums
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'SUPERADMIN');
CREATE TYPE "LotteryStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "NumberStatus" AS ENUM ('AVAILABLE', 'HELD', 'PENDING_REVIEW', 'RESERVED');
CREATE TYPE "ReservationStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- Table: users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "telegram_user_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

-- Table: admin_credentials
CREATE TABLE "admin_credentials" (
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_encrypted" TEXT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,

    CONSTRAINT "admin_credentials_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "admin_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "admin_credentials_email_key" ON "admin_credentials"("email");

-- Table: lotteries
CREATE TABLE "lotteries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "prize_description" TEXT NOT NULL,
    "status" "LotteryStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'ETB',
    "ticket_price_minor" BIGINT NOT NULL,
    "number_start" INTEGER NOT NULL DEFAULT 0,
    "number_end" INTEGER NOT NULL,
    "max_numbers_per_purchase" INTEGER NOT NULL DEFAULT 20,
    "hold_minutes" INTEGER NOT NULL DEFAULT 10,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "payment_instructions" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotteries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lotteries_slug_key" ON "lotteries"("slug");

-- CHECK constraints on lotteries
ALTER TABLE "lotteries" ADD CONSTRAINT "check_ticket_price_positive" CHECK ("ticket_price_minor" > 0);
ALTER TABLE "lotteries" ADD CONSTRAINT "check_number_start_non_negative" CHECK ("number_start" >= 0);
ALTER TABLE "lotteries" ADD CONSTRAINT "check_number_range" CHECK ("number_end" >= "number_start");
ALTER TABLE "lotteries" ADD CONSTRAINT "check_max_numbers" CHECK ("number_end" - "number_start" < 10000);

-- Table: lottery_numbers
CREATE TABLE "lottery_numbers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lottery_id" UUID NOT NULL,
    "number_value" INTEGER NOT NULL,
    "status" "NumberStatus" NOT NULL DEFAULT 'AVAILABLE',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_numbers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_numbers_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lottery_numbers_lottery_id_number_value_key" ON "lottery_numbers"("lottery_id", "number_value");
CREATE UNIQUE INDEX "lottery_numbers_id_lottery_id_key" ON "lottery_numbers"("id", "lottery_id");
CREATE INDEX "lottery_numbers_lottery_id_status_number_value_idx" ON "lottery_numbers"("lottery_id", "status", "number_value");

-- Table: reservations
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_reference" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "lottery_id" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "currency" CHAR(3) NOT NULL DEFAULT 'ETB',
    "unit_price_minor" BIGINT NOT NULL,
    "ticket_count" INTEGER NOT NULL,
    "total_amount_minor" BIGINT NOT NULL,
    "hold_expires_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "rejection_reason" TEXT,
    "idempotency_key" TEXT,
    "request_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reservations_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reservations_public_reference_key" ON "reservations"("public_reference");
CREATE UNIQUE INDEX "reservations_user_id_idempotency_key_key" ON "reservations"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "reservations_id_lottery_id_key" ON "reservations"("id", "lottery_id");
CREATE INDEX "reservations_user_id_created_at_idx" ON "reservations"("user_id", "created_at" DESC);
CREATE INDEX "reservations_review_queue_idx" ON "reservations"("created_at" DESC) WHERE "status" = 'PENDING_REVIEW';

-- CHECK constraint on reservations total calculation
ALTER TABLE "reservations" ADD CONSTRAINT "check_total_amount_calculation" CHECK ("total_amount_minor" = "unit_price_minor" * "ticket_count");

-- Table: reservation_items
CREATE TABLE "reservation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "lottery_id" UUID NOT NULL,
    "lottery_number_id" UUID NOT NULL,
    "number_value_snapshot" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reservation_items_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reservation_items_lottery_number_id_fkey" FOREIGN KEY ("lottery_number_id") REFERENCES "lottery_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reservation_items_reservation_id_lottery_number_id_key" ON "reservation_items"("reservation_id", "lottery_number_id");

-- Table: number_claims
CREATE TABLE "number_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lottery_number_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "number_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "number_claims_lottery_number_id_fkey" FOREIGN KEY ("lottery_number_id") REFERENCES "lottery_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "number_claims_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "number_claims_reservation_id_idx" ON "number_claims"("reservation_id");

-- Partial Unique Index on number_claims: at most one ACTIVE claim per number
CREATE UNIQUE INDEX "one_active_claim_per_number" ON "number_claims" ("lottery_number_id") WHERE "status" = 'ACTIVE';

-- Table: payment_submissions
CREATE TABLE "payment_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "claimed_amount_minor" BIGINT,
    "payment_reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_submissions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Partial Unique Index: at most one open SUBMITTED payment per reservation
CREATE UNIQUE INDEX "one_open_submission_per_reservation" ON "payment_submissions" ("reservation_id") WHERE "status" = 'SUBMITTED';

-- Table: payment_reviews (immutable)
CREATE TABLE "payment_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_submission_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "compared_with_bank_record" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_reviews_payment_submission_id_fkey" FOREIGN KEY ("payment_submission_id") REFERENCES "payment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Table: draws (immutable)
CREATE TABLE "draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lottery_id" UUID NOT NULL,
    "prize_label" TEXT NOT NULL,
    "eligible_count" INTEGER NOT NULL,
    "eligible_set_sha256" TEXT NOT NULL,
    "random_seed" TEXT NOT NULL,
    "winning_number" INTEGER NOT NULL,
    "run_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draws_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "draws_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draws_run_by_fkey" FOREIGN KEY ("run_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Table: refunds
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "handled_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "refunds_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Table: outbox_events
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- Table: notifications
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Table: channel_posts
CREATE TABLE "channel_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lottery_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "post_type" TEXT NOT NULL,
    "last_published_at" TIMESTAMPTZ,

    CONSTRAINT "channel_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_posts_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Table: audit_logs (append-only)
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "request_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- Append-only trigger function
CREATE OR REPLACE FUNCTION prevent_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Triggers enforcing append-only tables
CREATE TRIGGER "audit_logs_prevent_mutation"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();

CREATE TRIGGER "payment_reviews_prevent_mutation"
BEFORE UPDATE OR DELETE ON "payment_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();

CREATE TRIGGER "draws_prevent_mutation"
BEFORE UPDATE OR DELETE ON "draws"
FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();

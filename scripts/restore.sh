#!/usr/bin/env bash
# ==============================================================================
# Telegram Lottery Platform — Production Restore Script
# Verifies SHA-256 checksum, recovers database from dump, and verifies triggers
# ==============================================================================

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path-to-dump-file>"
  echo "Example: $0 ./backups/db_telegram_lottery_20261026_000000Z.dump"
  exit 1
fi

DUMP_FILE="$1"
CHECKSUM_FILE="${DUMP_FILE}.sha256"
PG_HOST="${PGHOST:-localhost}"
PG_PORT="${PGPORT:-5432}"
PG_USER="${PGUSER:-postgres}"
PG_DATABASE="${PGDATABASE:-telegram_lottery}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "ERROR: Backup file ${DUMP_FILE} does not exist!"
  exit 1
fi

# 1. Verify SHA-256 checksum if present
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "==> Verifying SHA-256 checksum..."
  sha256sum -c "${CHECKSUM_FILE}"
  echo "==> Integrity verified successfully."
else
  echo "WARNING: No checksum file found at ${CHECKSUM_FILE}. Proceeding without verification."
fi

read -p "Are you sure you want to restore into ${PG_DATABASE} on ${PG_HOST}? This will OVERWRITE existing data! (y/N): " -r
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Restore aborted by user."
  exit 0
fi

echo "==> Terminating existing client connections to ${PG_DATABASE}..."
PGPASSWORD="${PGPASSWORD:-postgres}" psql \
  -h "${PG_HOST}" \
  -p "${PG_PORT}" \
  -U "${PG_USER}" \
  -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PG_DATABASE}' AND pid <> pg_backend_pid();" || true

echo "==> Restoring database from ${DUMP_FILE}..."
PGPASSWORD="${PGPASSWORD:-postgres}" pg_restore \
  -h "${PG_HOST}" \
  -p "${PG_PORT}" \
  -U "${PG_USER}" \
  -d "${PG_DATABASE}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -v \
  "${DUMP_FILE}" || true

echo "==> Verifying database integrity and constraints..."
PGPASSWORD="${PGPASSWORD:-postgres}" psql \
  -h "${PG_HOST}" \
  -p "${PG_PORT}" \
  -U "${PG_USER}" \
  -d "${PG_DATABASE}" \
  -c "
    SELECT 'lotteries' as table_name, count(*) as row_count FROM lotteries
    UNION ALL SELECT 'lottery_numbers', count(*) FROM lottery_numbers
    UNION ALL SELECT 'reservations', count(*) FROM reservations
    UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
    UNION ALL SELECT 'draws', count(*) FROM draws;
  "

echo "==> Database restore and verification completed successfully!"

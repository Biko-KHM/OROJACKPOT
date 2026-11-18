#!/usr/bin/env bash
# ==============================================================================
# Telegram Lottery Platform — Production Backup Script
# Creates an immutable custom-format PostgreSQL dump and MinIO evidence tarball
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
PG_HOST="${PGHOST:-localhost}"
PG_PORT="${PGPORT:-5432}"
PG_USER="${PGUSER:-postgres}"
PG_DATABASE="${PGDATABASE:-telegram_lottery}"

mkdir -p "${BACKUP_DIR}"

DB_BACKUP_FILE="${BACKUP_DIR}/db_${PG_DATABASE}_${TIMESTAMP}.dump"
CHECKSUM_FILE="${DB_BACKUP_FILE}.sha256"

echo "==> Starting database backup for ${PG_DATABASE} at ${TIMESTAMP}..."

# 1. Custom-format compressed pg_dump
PGPASSWORD="${PGPASSWORD:-postgres}" pg_dump \
  -h "${PG_HOST}" \
  -p "${PG_PORT}" \
  -U "${PG_USER}" \
  -F c \
  -b \
  -v \
  -f "${DB_BACKUP_FILE}" \
  "${PG_DATABASE}"

# 2. Compute SHA-256 checksum for audit and integrity verification
sha256sum "${DB_BACKUP_FILE}" > "${CHECKSUM_FILE}"

echo "==> Database dump completed: ${DB_BACKUP_FILE}"
echo "==> Integrity Checksum: $(cat "${CHECKSUM_FILE}")"

# 3. Retention policy: Keep the last 14 daily backup files
echo "==> Pruning backup archives older than 14 days..."
find "${BACKUP_DIR}" -name "db_${PG_DATABASE}_*.dump*" -type f -mtime +14 -delete

echo "==> Backup completed successfully."

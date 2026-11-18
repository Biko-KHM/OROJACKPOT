# Telegram Lottery Mini App — Operations & Deployment Runbook

**Document Version:** 1.0.0  
**Target Architecture:** Ubuntu 22.04/24.04 LTS, Docker & Docker Compose, Managed PostgreSQL 16, S3-Compatible Storage  

---

## 1. System Requirements & Architecture Overview

The system consists of three independent deployable runtime units:
1. **API Server (`apps/api`):** Stateless Node.js / Express backend exposing REST API and handling Telegram Webhook callbacks.
2. **Background Worker (`apps/api/src/worker`):** Node.js worker daemon executing outbox delivery (Telegram notifications, channel updates) and hold-expiry releases (`SELECT ... FOR UPDATE SKIP LOCKED`).
3. **Web Frontend (`apps/web`):** Static React single-page application served via Nginx with SPA routing, containing the Telegram Mini App and Admin Dashboard.

### Minimum Recommended Production Specs
- **Compute:** 2 vCPU, 4 GB RAM, 40 GB NVMe SSD (scales up to 5,000 concurrent Telegram users).
- **Database:** PostgreSQL 16 with SSL enabled and connection pool (PgBouncer recommended for $>100$ concurrency).
- **Object Storage:** AWS S3, Cloudflare R2, or self-hosted MinIO with private bucket access.

---

## 2. Environment Configuration Reference

Create `/etc/tg-lottery/.env` with strict file permissions (`chmod 600`):

```bash
# Core Environment
NODE_ENV=production
PORT=3000

# PostgreSQL Connection
DATABASE_URL=postgresql://lottery_user:STRONG_PASSWORD@localhost:5432/telegram_lottery?schema=public&sslmode=prefer

# Cryptographic Secrets (Generate via openssl rand -hex 32)
JWT_SECRET=c0a80101b02030405060708090a0b0c0d0e0f101112131415161718191a1b1c1
ADMIN_JWT_SECRET=d1b90202c131415161718191a1b1c1d1e1f102122232425262728292a2b2c2d2
ENCRYPTION_KEY_32BYTES=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Telegram Integration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_BOT_USERNAME=EthioLotteryBot
TELEGRAM_CHANNEL_ID=@ethio_lottery_channel
TELEGRAM_WEBHOOK_SECRET=f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4

# S3 / MinIO Object Storage
S3_ENDPOINT=https://s3.your-region.amazonaws.com # or http://localhost:9000 for MinIO
S3_PUBLIC_URL=https://s3.your-region.amazonaws.com
S3_REGION=us-east-1
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET_NAME=lottery-payment-evidence

# Security & CORS
CORS_ORIGIN=https://lottery.et,https://admin.lottery.et,https://web.telegram.org
```

---

## 3. Quickstart Deployment with Docker Compose

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Biko-KHM/Mini-Tg-App.git /opt/tg-lottery
   cd /opt/tg-lottery
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your production tokens and database credentials
   ```

3. **Launch the production stack:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **Verify container health:**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

---

## 4. Telegram Bot & Webhook Configuration

### 4.1 Register Bot Commands
Send the following command structure to [@BotFather](https://t.me/BotFather) via `/setcommands`:

```
start - Open the Lottery Mini App
mytickets - View your reserved and confirmed tickets
status - Check the status of your active purchases
help - Contact support and read lottery rules
```

### 4.2 Register Webhook with Secret Token
Execute the following curl command replacing `<TOKEN>` and `<SECRET>`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.lottery.et/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Verify webhook status:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

### 4.3 Configure Channel Permissions
1. Add `@EthioLotteryBot` as an **Administrator** to your public announcement channel (`@ethio_lottery_channel`).
2. Grant permissions:
   - **Post Messages** (Required for campaign announcements & winner broadcasts)
   - **Edit Messages of Others** (Required for the throttled live sales progress post)
   - **Delete Messages** (Optional for cleanup)

---

## 5. Reverse Proxy & HTTPS Configuration (Nginx)

Place this configuration in `/etc/nginx/sites-available/lottery.et`:

```nginx
# API & Webhook
server {
    listen 443 ssl http2;
    server_name api.lottery.et;

    ssl_certificate /etc/letsencrypt/live/api.lottery.et/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.lottery.et/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Mini App & Admin Frontend
server {
    listen 443 ssl http2;
    server_name lottery.et admin.lottery.et;

    ssl_certificate /etc/letsencrypt/live/lottery.et/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lottery.et/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 6. Backup, Health Checks & Disaster Recovery

### Automated Nightly Database Backup (Cron)
Add to `/etc/cron.d/tg-lottery-backup`:
```bash
0 2 * * * root /opt/tg-lottery/scripts/backup.sh >> /var/log/tg-lottery-backup.log 2>&1
```

### Disaster Recovery: Full Database Restoration
In case of server hardware failure or accidental corruption:
```bash
./scripts/restore.sh ./backups/db_telegram_lottery_20261026_020000Z.dump
```
The script validates the SHA-256 hash, prompts for confirmation, terminates open connections, restores all schemas and constraints, and prints row count verification.

### Health Endpoints
- **Liveness:** `GET /health/live` (returns HTTP 200 `{ status: "ok" }`)
- **Readiness:** `GET /health/ready` (queries PostgreSQL `SELECT 1` and verifies database connectivity)

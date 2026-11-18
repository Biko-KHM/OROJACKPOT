# HIREE Lottery: Production Deployment Architecture Guide
**Mini App on Vercel • Backend on Render • PostgreSQL on Supabase**

This document provides complete, production-grade instructions to deploy the entire HIREE Telegram Lottery platform with zero mock data, high performance, and bank-grade cryptographic security.

---

## 1. System Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │            Telegram Client             │
                      │       (iOS / Android / Desktop)        │
                      └───────────────────┬────────────────────┘
                                          │
                  ┌───────────────────────┴────────────────────────┐
                  ▼                                                ▼
     ┌────────────────────────┐                       ┌────────────────────────┐
     │   Telegram Mini App    │                       │   Telegram Bot & Pub   │
     │      (Vercel SPA)      │                       │     (@BotFather)       │
     │ https://app.vercel.app │                       │  Webhooks & Commands   │
     └────────────┬───────────┘                       └────────────┬───────────┘
                  │                                                │
                  │ HTTPS (CORS + Cookies)                         │ Webhook POST
                  ▼                                                ▼
     ┌─────────────────────────────────────────────────────────────────────────┐
     │                         Backend API & Worker                            │
     │                       (Render Node.js Service)                          │
     │                      https://api.onrender.com                           │
     └────────────────────────────┬───────────────────────────────┬────────────┘
                                  │                               │
                                  ▼                               ▼
     ┌────────────────────────────────────────┐     ┌──────────────────────────┐
     │          Supabase PostgreSQL           │     │      Upstash Redis       │
     │  - Pooled (PgBouncer): port 6543       │     │  - Number grids microcache
     │  - Direct (Migrations): port 5432      │     │  - Bot deduplication     │
     │  - Append-only cryptographic audit     │     │  - Hold recovery session │
     └────────────────────────────────────────┘     └──────────────────────────┘
```

---

## 2. Step 1: Provisioning Supabase Database

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings** → **Database** → **Connection String**:
   * **Connection Pooling (`DATABASE_URL`)**:
     * Select **Transaction Mode** (Port `6543`).
     * Copy the string. Append `?pgbouncer=true`:
       ```env
       DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
       ```
   * **Direct Connection (`DIRECT_URL`)**:
     * Select **Session Mode** / Direct Connection (Port `5432`).
     * Copy the string:
       ```env
       DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
       ```
3. Push the Prisma Schema from your local terminal to Supabase:
   ```bash
   # Set your database URLs in your environment or temporary .env
   npm run prisma:push
   ```
4. Seed the initial Superadmin account:
   ```bash
   # Parameters can be customized via environment variables:
   INITIAL_SUPERADMIN_EMAIL="admin@lottery.et" \
   INITIAL_SUPERADMIN_PASSWORD="YourSecurePassword2026!" \
   INITIAL_SUPERADMIN_TG_ID="123456789" \
   npm run prisma:seed
   ```
   *(This initializes your administrative credential with zero mock reservations or dummy tickets).*

---

## 3. Step 2: Deploying Backend API to Render

### Option A: 1-Click Render Blueprint (Recommended)
This repository includes a `render.yaml` specification at the root:
1. Log in to [render.com](https://render.com).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub repository. Render will automatically detect `render.yaml` and configure the Web Service (`hiree-lottery-api`).
4. Supply the secret environment variables in the Render dashboard:
   - `DATABASE_URL`: Your Supabase pooler connection string.
   - `DIRECT_URL`: Your Supabase port 5432 connection string.
   - `CORS_ORIGIN`: Your Vercel frontend URL, e.g. `https://your-mini-app.vercel.app,https://web.telegram.org`
   - `TELEGRAM_BOT_TOKEN`: The API token from `@BotFather`.
   - `TELEGRAM_CHANNEL_ID`: Your public channel ID (e.g. `-1001234567890`) where draws and milestones post.
   - `REDIS_URL` *(Optional)*: Upstash or Render Redis URL (if omitted, falls back to the embedded zero-downtime memory adapter).
5. Click **Apply**. Render will install, compile TypeScript, run the API, and start the outbox/expire worker.

### Option B: Manual Web Service on Render
* **Environment**: Node
* **Build Command**: `npm install && npm run prisma:generate -w @tg-lottery/api && npm run build`
* **Start Command**: `npm run start:api`
* **Health Check Path**: `/health`

### Configure Telegram Webhook:
Once your Render API is deployed (e.g. `https://hiree-lottery-api.onrender.com`), register the webhook with Telegram:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hiree-lottery-api.onrender.com/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

---

## 4. Step 3: Deploying Frontend Mini App to Vercel

1. Log in to [vercel.com](https://vercel.com) and click **Add New...** → **Project**.
2. Select your GitHub repository.
3. In the project settings:
   - **Framework Preset**: Vite
   - **Root Directory**: Select `apps/web` (or keep monorepo root; root `vercel.json` will auto-route to `apps/web/dist`).
   - **Build Command**: `npm run build:web` (or `tsc && vite build`)
   - **Output Directory**: `dist`
4. Set **Environment Variables**:
   ```env
   VITE_API_URL=https://hiree-lottery-api.onrender.com
   VITE_TELEGRAM_BOT_USERNAME=HireeLotteryBot
   ```
5. Click **Deploy**. Vercel will build the frontend with production minification, gzip assets, and SPA rewrite rules.

---

## 5. Step 4: Configuring Telegram Mini App in BotFather

Open Telegram and chat with [@BotFather](https://t.me/BotFather):

1. **Configure Web App URL**:
   * Send `/newapp`
   * Select your bot.
   * Enter App Title: `HIREE National Lottery`
   * Enter App Description: `Official Provably Fair Ethiopian Lottery`
   * Upload an icon (640x360 px)
   * Enter Web App URL: `https://your-mini-app.vercel.app`
   * Enter Short Name: `app` (this enables links like `t.me/YourBot/app`)
2. **Configure Menu Button**:
   * Send `/setmenubutton`
   * Select your bot.
   * Provide the Vercel URL: `https://your-mini-app.vercel.app`
   * Provide Button Title: `🎟 Play Lottery`

---

## 6. Step 5: Initial Production Administration

1. **Access the Admin Portal**:
   * Open: `https://your-mini-app.vercel.app/admin`
   * Log in with:
     * **Email**: `admin@lottery.et` (or your configured `INITIAL_SUPERADMIN_EMAIL`)
     * **Password**: `ChangeMe@Admin2026!` (or your configured `INITIAL_SUPERADMIN_PASSWORD`)
2. **Create Your First Live Campaign**:
   * Navigate to **Campaigns** → **Create Campaign**.
   * Specify:
     - **Title**: (e.g. *Ethiopian Grand Holiday Draw*)
     - **Price**: (e.g. *50 ETB*)
     - **Ticket Pool**: (e.g. *1 to 500*)
     - **Hold Duration**: (e.g. *10 minutes*)
     - **Official Payment Details**: Enter official CBE and Telebirr merchant/account numbers.
   * Click **Publish & Open Campaign**.
3. **Launch in Telegram**:
   * Open your bot in Telegram and click the **Play Lottery** menu button.
   * Live tickets are instantly available for purchase, payment proof verification, and cryptographic draw execution!

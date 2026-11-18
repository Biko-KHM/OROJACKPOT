# HIREE — Telegram Lottery Mini App & Provably Fair Verification Engine

[![CI](https://github.com/Biko-KHM/Mini-Tg-App/actions/workflows/ci.yml/badge.svg)](https://github.com/Biko-KHM/Mini-Tg-App/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-v20%20%7C%20v22-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Proprietary-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel)](https://vercel.com)
[![Backend](https://img.shields.io/badge/Backend-Render-46E3B7?logo=render)](https://render.com)
[![Database](https://img.shields.io/badge/Database-Supabase%20Postgres-3ECF8E?logo=supabase)](https://supabase.com)

A high-performance, enterprise-grade Telegram Lottery Mini App platform built for high concurrency, zero modulo bias, and cryptographic transparency. Features a trilingual user interface (English, Afaan Oromoo, Amharic), bank-transfer payment verification, provably fair draw mechanics, and a multi-tiered administrative portal.

---

## 🏛 Architecture & Monorepo Structure

```
.
├── apps/
│   ├── api/                      # Backend REST API & Telegram Outbox Worker (Express + Node.js)
│   │   ├── prisma/               # Prisma ORM schema, migrations, and clean production seeds
│   │   ├── src/
│   │   │   ├── config/           # Validated environment configurations
│   │   │   ├── modules/
│   │   │   │   ├── admin-review/ # Payment review, 4-eye approval, receipt presigned viewing
│   │   │   │   ├── auth/         # Telegram initData HMAC validation & Admin session auth
│   │   │   │   ├── cache/        # High-speed Redis caching & session continuity service
│   │   │   │   ├── draws/        # Cryptographic commitment publication & draw execution
│   │   │   │   ├── lotteries/    # Campaign lifecycle, virtualized number allocation
│   │   │   │   ├── payments/     # Slip upload, payment submission, confirmation state
│   │   │   │   ├── reservations/ # High-concurrency ticket lock & release engine
│   │   │   │   └── telegram/     # Outbox event worker & Bot notification dispatcher
│   │   │   ├── server.ts         # Server bootstrap & graceful shutdown hooks
│   │   │   └── worker/           # Background daemon for Telegram outbox dispatch
│   │   └── tests/                # Comprehensive backend integration & security tests
│   │
│   └── web/                      # Telegram WebApp Mini App Frontend (React 18 + Vite + Tailwind)
│       ├── public/               # Static assets & brand media
│       ├── src/
│       │   ├── api/              # Cross-origin fetch client with dynamic URL resolution
│       │   ├── components/       # UI Components (NumberGrid, HoldScreen, AdminDashboard, etc.)
│       │   ├── context/          # Auth context, language state, and active reservation stores
│       │   ├── translations/     # Trilingual dictionary (English, Afaan Oromoo, Amharic)
│       │   ├── types/            # TypeScript interfaces and DTOs
│       │   └── App.tsx           # Main application routing and Telegram SDK bridge
│       └── tests/                # Frontend component & user journey tests (Vitest + RTL)
│
├── packages/
│   └── shared/                   # Shared types, Zod schemas, and Provably Fair Verifier
│       └── src/
│           ├── index.ts          # Root package exports
│           ├── schemas/          # Zod validation schemas
│           └── verifier.ts       # Independent client-side cryptographic proof verifier
│
├── docs/                         # Specifications & Deployment Documentation
│   ├── PRODUCTION_DEPLOYMENT_GUIDE.md  # Step-by-step Supabase, Render & Vercel deployment
│   └── PROVABLY_FAIR_SECURITY_SPEC.md   # Mathematical specification of the draw algorithm
│
├── scripts/                      # Operational & Maintenance Utilities
│   ├── clean-database.ts         # Safe purge script for staging/mock data
│   └── verify-draw.ts            # Standalone CLI verifier for published draw proofs
│
├── .github/workflows/ci.yml      # Automated GitHub Actions CI pipeline
├── render.yaml                   # Infrastructure as Code (IaC) Blueprint for Render Web Service
├── vercel.json                   # Vercel SPA routing and Telegram iframe security headers
└── package.json                  # Monorepo workspaces definition
```

---

## 🚀 Deployment Overview

The application is structured to be deployed across three specialized cloud platforms:

| Component | Platform | Configuration File |
| :--- | :--- | :--- |
| **Mini App Frontend** | **Vercel** | [`apps/web/vercel.json`](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/apps/web/vercel.json) |
| **Backend API & Workers** | **Render** | [`render.yaml`](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/render.yaml) |
| **Database** | **Supabase** | [`apps/api/prisma/schema.prisma`](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/apps/api/prisma/schema.prisma) |

> 📖 **Full Instructions**: For step-by-step setup, refer to the [Production Deployment Guide](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/docs/PRODUCTION_DEPLOYMENT_GUIDE.md).

---

## 🛠 Local Development

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **npm**: `v10.x` or higher
- **PostgreSQL**: `v15+`
- **Redis**: `v7+`

### 1. Installation
```bash
git clone https://github.com/Biko-KHM/Mini-Tg-App.git
cd Mini-Tg-App
npm install
```

### 2. Environment Configuration
Copy environment templates and populate secrets:
```bash
cp apps/api/.env.production.example apps/api/.env
cp apps/web/.env.production.example apps/web/.env
```

### 3. Database Initialization
```bash
npm run prisma:push
npm run prisma:seed
```

### 4. Start Development Servers
```bash
# Start backend API (http://localhost:3005)
npm run dev:api

# Start frontend Mini App (http://localhost:5180)
npm run dev:web
```

---

## 🧪 Testing & Verification

The test suites validate end-to-end security, mathematical uniformity, race condition prevention, and full UI state transitions:

```bash
# Run all workspace test suites
npm run test

# Run frontend test suite
npm run test -w @tg-lottery/web

# Run backend test suite
npm run test -w @tg-lottery/api

# Run entire production build
npm run build
```

---

## 🔐 Security & Fair-Play Guarantees

1. **Provably Fair Winner Selection (`HIREE-VRF-v1.0`)**:
   - Rejection sampling over $[0, 2^{32})$ eliminating modulo bias.
   - Server commitment pre-publication with HMAC-SHA256 entropy combination.
   - Publicly verifiable on-chain/client-side via [`packages/shared/src/verifier.ts`](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/packages/shared/src/verifier.ts) or [`scripts/verify-draw.ts`](file:///c:/Documents/_1to%20be%20sent/Tg-Mini-App/scripts/verify-draw.ts).

2. **Tamper-Proof Audit Trail**:
   - PostgreSQL database triggers prevent any `UPDATE` or `DELETE` statements on `draws` and `audit_logs` tables.

3. **Multi-Admin Four-Eyes Principle**:
   - High-value payments require two distinct administrative approvals.
   - Strict race-condition handling prevents double approvals or concurrent double draws.

4. **Session Continuity & High Performance**:
   - Redis-backed session preservation allows users to resume active ticket reservations across connection interruptions.

---

## 📄 License
Proprietary & Confidential. All rights reserved.

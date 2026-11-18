# ------------------------------------------------------------------------------
# Production Dockerfile for @tg-lottery/api & background worker
# ------------------------------------------------------------------------------

# Stage 1: Build & compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy root workspace configurations
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies across workspaces
RUN npm ci

# Copy source trees
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

# Build shared package first
RUN npm --prefix packages/shared run build

# Generate Prisma Client & build API TypeScript
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install runtime utilities
RUN apk add --no-cache curl postgresql-client

# Create non-root system user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/node_modules ./node_modules

# Ensure permissions
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Default command launches API server; override CMD to run background worker
CMD ["node", "apps/api/dist/server.js"]

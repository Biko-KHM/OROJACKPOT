# ------------------------------------------------------------------------------
# Production Dockerfile for @tg-lottery/web (Telegram Mini App & Admin)
# ------------------------------------------------------------------------------

# Stage 1: Build React/Vite assets
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configurations
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

# Install dependencies across workspaces
RUN npm ci

# Copy source trees
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

# Build shared package first
RUN npm --prefix packages/shared run build

# Build Vite application for production
WORKDIR /app/apps/web
RUN npm run build

# Stage 2: Serve static files with lightweight Nginx
FROM nginx:1.27-alpine AS runner

# Remove default configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom Nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

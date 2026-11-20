import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import crypto from 'node:crypto';
import { config } from './config/index.js';
import { logger } from './logger/index.js';
import { healthRouter } from './modules/health/routes.js';
import { getBotUsername, getPlatformTelegramChannelId } from './modules/platform/settings.js';
import { authRouter, adminAuthRouter } from './modules/auth/routes.js';
import { lotteriesRouter, adminLotteriesRouter } from './modules/lotteries/routes.js';
import { reservationsRouter, meRouter } from './modules/reservations/routes.js';
import { uploadsRouter } from './modules/storage/routes.js';
import { adminReviewRouter } from './modules/admin-review/routes.js';
import { telegramRouter } from './modules/telegram/routes.js';
import { adminOutboxRouter } from './modules/outbox/routes.js';
import { adminDrawsRouter, publicDrawsRouter } from './modules/draws/routes.js';
import {
  authRateLimiter,
  reservationsRateLimiter,
  uploadsRateLimiter,
  globalRateLimiter,
} from './modules/security/rateLimiter.js';

// Polyfill BigInt.prototype.toJSON globally
if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

export const app = express();

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.headers['x-request-id'] = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// Helmet security headers (Section 9.7)
app.use(
  helmet({
    contentSecurityPolicy:
      config.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
              connectSrc: ["'self'", 'https://*.supabase.co', ...config.CORS_ORIGIN.split(',').map((o) => o.trim())],
              frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

// Resilient CORS configuration supporting Telegram Web, Mobile LAN testing, and Vercel/Render
app.use(
  cors({
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (e.g. mobile app webviews, curl, server-to-server)
      if (!requestOrigin) return callback(null, true);

      const allowedOrigins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim().toLowerCase());
      const lowerOrigin = requestOrigin.toLowerCase();

      // 1. Explicit configured origins
      if (allowedOrigins.includes(lowerOrigin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      // 2. Telegram Web client origins
      if (
        lowerOrigin === 'https://web.telegram.org' ||
        lowerOrigin.endsWith('.telegram.org') ||
        lowerOrigin.endsWith('.t.me')
      ) {
        return callback(null, true);
      }

      // 3. Localhost & Private Local LAN IPs (e.g. phone connecting to dev machine via 192.168.x.x)
      if (
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(
          lowerOrigin,
        )
      ) {
        return callback(null, true);
      }

      // 4. Common deploy & tunnel environments
      if (
        lowerOrigin.endsWith('.ngrok-free.app') ||
        lowerOrigin.endsWith('.ngrok.io') ||
        lowerOrigin.endsWith('.trycloudflare.com') ||
        lowerOrigin.endsWith('.loca.lt') ||
        lowerOrigin.endsWith('.vercel.app') ||
        lowerOrigin.endsWith('.onrender.com')
      ) {
        return callback(null, true);
      }

      // 5. In development, allow any origin
      if (config.NODE_ENV !== 'production') {
        return callback(null, true);
      }

      callback(new Error(`Not allowed by CORS: ${requestOrigin}`));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['X-Request-Id', 'x-csrf-token'],
  }),
);

// HTTP Response Compression (Gzip / Deflate for payloads > 1KB)
app.use(compression({ threshold: 1024 }));

// Body parsers & cookies
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

// Global Rate Limiter: max 120 req/min per IP
app.use(globalRateLimiter.middleware());

// Health & keep-alive routes (unthrottled)
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'orojackpot-api',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
app.use('/health', healthRouter);

// Public dynamic configuration (Bot username queried live via getMe from token, Channel ID from Superadmin settings)
const handlePublicConfig = async (_req: Request, res: Response) => {
  const botUsername = await getBotUsername();
  res.status(200).json({
    botUsername,
    telegramChannelId: getPlatformTelegramChannelId(),
    appTitle: 'OROJACKPOT',
  });
};
app.get('/public-config', handlePublicConfig);
app.get('/api/v1/public-config', handlePublicConfig);

// Telegram Webhook
app.use('/webhooks/telegram', telegramRouter);
app.use('/api/v1/webhooks/telegram', telegramRouter);

// Customer Authentication (Rate limit: 20/min)
app.use('/auth', authRateLimiter.middleware(), authRouter);
app.use('/api/v1/auth', authRateLimiter.middleware(), authRouter);

// Admin Authentication & Base Admin routes (Rate limit login: 20/min)
app.use('/admin/auth', authRateLimiter.middleware(), adminAuthRouter);
app.use('/admin', adminAuthRouter);
app.use('/admin', adminReviewRouter);
app.use('/admin', adminOutboxRouter);
app.use('/admin', adminDrawsRouter);
app.use('/api/v1/admin/auth', authRateLimiter.middleware(), adminAuthRouter);
app.use('/api/v1/admin', adminAuthRouter);
app.use('/api/v1/admin', adminReviewRouter);
app.use('/api/v1/admin', adminOutboxRouter);
app.use('/api/v1/admin', adminDrawsRouter);

// Lotteries & Inventory
app.use('/lotteries', lotteriesRouter);
app.use('/api/v1/lotteries', lotteriesRouter);
app.use('/admin/lotteries', adminLotteriesRouter);
app.use('/api/v1/admin/lotteries', adminLotteriesRouter);

// Reservations & Customer Profile (Rate limit reservations: 10/min)
app.use('/reservations', reservationsRateLimiter.middleware(), reservationsRouter);
app.use('/api/v1/reservations', reservationsRateLimiter.middleware(), reservationsRouter);
app.use('/me', meRouter);
app.use('/api/v1/me', meRouter);

// File Uploads & Evidence Storage (Rate limit uploads: 5/min)
app.use('/uploads', uploadsRateLimiter.middleware(), uploadsRouter);
app.use('/api/v1/uploads', uploadsRateLimiter.middleware(), uploadsRouter);

// Public Provably Fair Draws & Snapshot Auditing
app.use('/draws', publicDrawsRouter);
app.use('/api/v1/draws', publicDrawsRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
      requestId,
    },
  });
});

// Centralized Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string;
  logger.error({ err, requestId }, 'Unhandled application error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
      requestId,
    },
  });
});

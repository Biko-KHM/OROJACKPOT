import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  timestamps: number[];
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export class InMemoryRateLimiter {
  private hits = new Map<string, RateLimitRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly message: string;
  private readonly keyGenerator: (req: Request) => string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.message = options.message || 'Too many requests. Please wait before retrying.';
    this.keyGenerator =
      options.keyGenerator ||
      ((req: Request) => {
        // Prefer authenticated user/admin ID, fallback to client IP
        if (req.user?.telegramUserId) return `user:${req.user.telegramUserId}`;
        if (req.admin?.id) return `admin:${req.admin.id}`;
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') return `ip:${forwarded.split(',')[0]?.trim()}`;
        return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
      });

    // Prune stale records every 5 minutes
    this.cleanupTimer = setInterval(() => this.pruneStaleRecords(), 5 * 60 * 1000);
    // Don't keep the Node.js event loop alive solely for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // In automated test runs, bypass rate limiter unless explicitly testing rate limiting via x-test-rate-limit header
      if (process.env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'true') {
        next();
        return;
      }

      const now = Date.now();
      const key = this.keyGenerator(req);
      const windowStart = now - this.windowMs;

      let record = this.hits.get(key);
      if (!record) {
        record = { timestamps: [] };
        this.hits.set(key, record);
      }

      // Filter out timestamps outside the active sliding window
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

      const currentCount = record.timestamps.length;
      const remaining = Math.max(0, this.maxRequests - currentCount - 1);
      const oldestTimestamp = record.timestamps[0] || now;
      const resetTimeSeconds = Math.ceil((oldestTimestamp + this.windowMs - now) / 1000);

      res.setHeader('RateLimit-Limit', this.maxRequests);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.max(0, resetTimeSeconds));

      if (currentCount >= this.maxRequests) {
        const retryAfterSeconds = Math.max(1, resetTimeSeconds);
        res.setHeader('Retry-After', retryAfterSeconds);
        const requestId = req.headers['x-request-id'] as string;

        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: this.message,
            retryAfterSeconds,
            requestId,
          },
        });
        return;
      }

      record.timestamps.push(now);
      next();
    };
  }

  public reset(): void {
    this.hits.clear();
  }

  public pruneStaleRecords(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, record] of this.hits.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.hits.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.hits.clear();
  }
}

// 1. Auth Rate Limiter: 20 per minute per IP
export const authRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Too many authentication attempts. Please wait 1 minute before retrying.',
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
    return `auth:${ip || 'unknown'}`;
  },
});

// 2. Reservations Rate Limiter: 10 per minute per Telegram user ID / IP
export const reservationsRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Ticket reservation rate limit reached (max 10 holds per minute). Please wait.',
  keyGenerator: (req) => {
    if (req.user?.telegramUserId) return `reserve:user:${req.user.telegramUserId}`;
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
    return `reserve:ip:${ip || 'unknown'}`;
  },
});

// 3. Uploads Rate Limiter: 5 per minute per Telegram user ID / IP
export const uploadsRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: 'Payment proof upload rate limit reached (max 5 uploads per minute). Please wait.',
  keyGenerator: (req) => {
    if (req.user?.telegramUserId) return `upload:user:${req.user.telegramUserId}`;
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
    return `upload:ip:${ip || 'unknown'}`;
  },
});

// 4. Global API Fallback Rate Limiter: 120 per minute per IP
export const globalRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'General API request threshold exceeded. Please slow down.',
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
    return `global:${ip || 'unknown'}`;
  },
});

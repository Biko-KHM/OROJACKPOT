import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';

interface MemoryCacheEntry {
  value: string;
  expiresAt: number | null;
}

/**
 * Resilient In-Memory Cache Adapter with precise TTL expiration & pattern deletion.
 * Serves as zero-downtime fallback whenever Redis server is offline or restarting.
 */
class MemoryCacheAdapter {
  private readonly store = new Map<string, MemoryCacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value: serialized, expiresAt });
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== null) {
      return false;
    }
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Senior Developer Enterprise Cache Service
 * Seamlessly wraps ioredis with automatic fallback to high-speed MemoryCacheAdapter.
 */
export class CacheService {
  private redis: Redis | null = null;
  private memory = new MemoryCacheAdapter();
  private isConnected = false;
  private hasLoggedFallback = false;

  constructor() {
    this.initRedis();
  }

  private initRedis() {
    const redisUrl = config.REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    try {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy(times) {
          // Exponential backoff up to 10 seconds
          return Math.min(times * 500, 10000);
        },
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        this.hasLoggedFallback = false;
        logger.info({ redisUrl }, '[Cache] Redis connected successfully. Distributed caching active.');
      });

      this.redis.on('ready', () => {
        this.isConnected = true;
      });

      this.redis.on('close', () => {
        this.isConnected = false;
      });

      this.redis.on('error', (err) => {
        this.isConnected = false;
        if (!this.hasLoggedFallback) {
          logger.warn(
            { err: err.message },
            '[Cache] Redis offline or unreachable. Seamlessly fell back to In-Memory cache adapter.',
          );
          this.hasLoggedFallback = true;
        }
      });

      // Non-blocking initial connection attempt
      void this.redis.connect().catch(() => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
    }
  }

  public isRedisReady(): boolean {
    return this.isConnected && Boolean(this.redis);
  }

  /**
   * Retrieves an item from cache.
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.isConnected && this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw === null) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return raw as unknown as T;
        }
      } catch (err) {
        logger.debug({ key, err }, '[Cache] Redis get failed, using memory fallback');
      }
    }
    return this.memory.get<T>(key);
  }

  /**
   * Stores an item in cache with optional TTL in seconds.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    // Keep memory cache warm as fallback
    await this.memory.set(key, serialized, ttlSeconds);

    if (this.isConnected && this.redis) {
      try {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.redis.set(key, serialized, 'EX', ttlSeconds);
        } else {
          await this.redis.set(key, serialized);
        }
      } catch (err) {
        logger.debug({ key, err }, '[Cache] Redis set failed, memory cache updated');
      }
    }
  }

  /**
   * Atomic Set if Not Exists (used for bot update deduplication, locks, and idempotency).
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.isConnected && this.redis) {
      try {
        const res = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return res === 'OK';
      } catch (err) {
        logger.debug({ key, err }, '[Cache] Redis setNx failed, using memory fallback');
      }
    }
    return this.memory.setNx(key, value, ttlSeconds);
  }

  /**
   * Deletes one or more keys from cache.
   */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    await this.memory.del(...keys);

    if (this.isConnected && this.redis) {
      try {
        await this.redis.del(...keys);
      } catch (err) {
        logger.debug({ keys, err }, '[Cache] Redis del failed, memory cache deleted');
      }
    }
  }

  /**
   * Deletes keys matching a wildcard pattern (e.g. "cache:lottery:123:*").
   */
  async delPattern(pattern: string): Promise<void> {
    await this.memory.delPattern(pattern);

    if (this.isConnected && this.redis) {
      try {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch (err) {
        logger.debug({ pattern, err }, '[Cache] Redis delPattern failed');
      }
    }
  }

  /**
   * High-Level Pattern: Read-Through Cache helper with automatic refresh on miss.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  /**
   * Disconnects Redis cleanly during application shutdown.
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // ignore
      }
    }
    this.memory.clear();
  }
}

// Global Singleton Cache Instance
export const cache = new CacheService();

// Domain-Specific Cache Keys
export const CACHE_KEYS = {
  OPEN_LOTTERIES: 'cache:lotteries:open',
  ALL_LOTTERIES: 'cache:lotteries:all',
  LOTTERY: (id: string) => `cache:lottery:${id}`,
  NUMBERS_SUMMARY: (id: string) => `cache:lottery:${id}:numbers-summary`,
  USER_PROFILE: (id: string) => `cache:user:${id}`,
  ACTIVE_HOLD: (userId: string) => `session:user:${userId}:active_hold`,
  BOT_DEDUP: (updateId: number | string) => `bot:dedup:${updateId}`,
  PLATFORM_SETTINGS: 'cache:platform_settings',
} as const;

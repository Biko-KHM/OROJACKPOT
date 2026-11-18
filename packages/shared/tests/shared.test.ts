import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOLD_MINUTES,
  MAX_NUMBERS_PER_PURCHASE,
  CURRENCY_ETB,
  UserRole,
  LotteryStatus,
  HealthCheckResponseSchema,
  ApiErrorResponseSchema,
} from '../src/index.js';

describe('Shared Constants and Enums', () => {
  it('should export expected business constants', () => {
    expect(DEFAULT_HOLD_MINUTES).toBe(10);
    expect(MAX_NUMBERS_PER_PURCHASE).toBe(20);
    expect(CURRENCY_ETB).toBe('ETB');
    expect(UserRole.CUSTOMER).toBe('CUSTOMER');
    expect(LotteryStatus.OPEN).toBe('OPEN');
  });

  it('should validate health check response schema correctly', () => {
    const valid = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: 120,
      database: 'connected',
    };
    const parsed = HealthCheckResponseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('should validate API error response schema', () => {
    const errorPayload = {
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: 'req-123',
      },
    };
    const parsed = ApiErrorResponseSchema.safeParse(errorPayload);
    expect(parsed.success).toBe(true);
  });
});

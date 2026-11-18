import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import {
  UserRole,
  LotteryStatus,
  NumberStatus,
  ReservationStatus,
} from '@prisma/client';
import { signCustomerToken } from '../src/modules/auth/crypto.js';
import { InMemoryRateLimiter } from '../src/modules/security/rateLimiter.js';
import { createReservation } from '../src/modules/reservations/service.js';

describe('Step 12: Security Hardening, Rate Limiting & Anti-Hoarding', () => {
  let customerUser: { id: string; token: string; telegramUserId: string };
  let hoardingUser: { id: string; token: string; telegramUserId: string };
  let testLotteryId: string;
  const createdLotteryIds: string[] = [];

  beforeAll(async () => {
    // 1. Create a normal test customer
    const tgId1 = BigInt(Math.floor(Math.random() * 1000000000) + 8100000);
    const user1 = await prisma.user.create({
      data: {
        telegramUserId: tgId1,
        username: `sec_user_${tgId1}`,
        role: UserRole.CUSTOMER,
      },
    });
    customerUser = {
      id: user1.id,
      telegramUserId: user1.telegramUserId.toString(),
      token: signCustomerToken({
        id: user1.id,
        telegramUserId: user1.telegramUserId.toString(),
        role: user1.role,
      }),
    };

    // 2. Create a customer for hoarding tests
    const tgId2 = BigInt(Math.floor(Math.random() * 1000000000) + 8200000);
    const user2 = await prisma.user.create({
      data: {
        telegramUserId: tgId2,
        username: `hoarder_${tgId2}`,
        role: UserRole.CUSTOMER,
      },
    });
    hoardingUser = {
      id: user2.id,
      telegramUserId: user2.telegramUserId.toString(),
      token: signCustomerToken({
        id: user2.id,
        telegramUserId: user2.telegramUserId.toString(),
        role: user2.role,
      }),
    };

    // 3. Create an OPEN lottery with 50 numbers
    const lottery = await prisma.lottery.create({
      data: {
        slug: `sec-lottery-${crypto.randomUUID()}`,
        title: 'Security Hardening Campaign',
        prizeDescription: 'Tesla Model 3',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: BigInt(2500),
        numberStart: 1,
        numberEnd: 50,
      },
    });
    testLotteryId = lottery.id;
    createdLotteryIds.push(lottery.id);

    for (let i = 1; i <= 50; i++) {
      await prisma.lotteryNumber.create({
        data: {
          lotteryId: lottery.id,
          numberValue: i,
          status: NumberStatus.AVAILABLE,
        },
      });
    }
  });

  afterAll(async () => {
    for (const lotteryId of createdLotteryIds) {
      try { await prisma.numberClaim.deleteMany({ where: { lotteryNumber: { lotteryId } } }); } catch { /* ignore */ }
      try { await prisma.reservationItem.deleteMany({ where: { lotteryId } }); } catch { /* ignore */ }
      try { await prisma.reservation.deleteMany({ where: { lotteryId } }); } catch { /* ignore */ }
      try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId } }); } catch { /* ignore */ }
      try { await prisma.lottery.deleteMany({ where: { id: lotteryId } }); } catch { /* ignore */ }
    }
    await prisma.$disconnect();
  });

  it('1. Verifies Helmet security headers and CORS configuration', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    // Helmet headers
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('2. Verifies in-memory rate limiter throttling and Retry-After headers', async () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60 * 1000,
      maxRequests: 3,
      message: 'Rate limit hit',
    });

    const mockReq = {
      ip: '192.168.1.100',
      headers: { 'x-test-rate-limit': 'true' },
      socket: {},
    } as any;

    let statusCode = 200;
    let headers: Record<string, any> = {};
    const mockRes = {
      setHeader: (k: string, v: any) => { headers[k] = v; },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (body: any) => body,
        };
      },
    } as any;

    const middleware = limiter.middleware();
    let nextCalled = 0;
    const next = () => { nextCalled++; };

    // Request 1: Allowed (remaining 2)
    middleware(mockReq, mockRes, next);
    expect(nextCalled).toBe(1);
    expect(headers['RateLimit-Remaining']).toBe(2);

    // Request 2: Allowed (remaining 1)
    middleware(mockReq, mockRes, next);
    expect(nextCalled).toBe(2);
    expect(headers['RateLimit-Remaining']).toBe(1);

    // Request 3: Allowed (remaining 0)
    middleware(mockReq, mockRes, next);
    expect(nextCalled).toBe(3);
    expect(headers['RateLimit-Remaining']).toBe(0);

    // Request 4: Blocked with HTTP 429
    middleware(mockReq, mockRes, next);
    expect(nextCalled).toBe(3); // Not called
    expect(statusCode).toBe(429);
    expect(headers['Retry-After']).toBeGreaterThanOrEqual(1);

    limiter.destroy();
  });

  it('3. Anti-hoarding protection: auto-blocks users with >= 5 expired holds and records audit log', async () => {
    // 1. Seed 5 expired reservations in the past 30 minutes for hoardingUser
    for (let i = 0; i < 5; i++) {
      await prisma.reservation.create({
        data: {
          publicReference: `HOARD-${i}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          userId: hoardingUser.id,
          lotteryId: testLotteryId,
          status: ReservationStatus.EXPIRED,
          currency: 'ETB',
          unitPriceMinor: BigInt(2500),
          ticketCount: 1,
          totalAmountMinor: BigInt(2500),
          createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
        },
      });
    }

    // 2. Attempting a new reservation must trigger HOARDING_DETECTED error
    await expect(
      createReservation({
        lotteryId: testLotteryId,
        userId: hoardingUser.id,
        numbers: [1],
        idempotencyKey: `hoard-attempt-${Date.now()}`,
      }),
    ).rejects.toThrow(/Excessive abandoned ticket holds detected/i);

    // 3. Verify audit log entry was created
    const audit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: hoardingUser.id,
        action: 'HOARDING_FLAG_TRIGGERED',
      },
    });

    expect(audit).not.toBeNull();
    expect(audit?.action).toBe('HOARDING_FLAG_TRIGGERED');
  });
});

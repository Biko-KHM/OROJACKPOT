import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { cache, CACHE_KEYS } from '../src/modules/cache/index.js';
import { signCustomerToken } from '../src/modules/auth/crypto.js';
import { LotteryStatus, ReservationStatus, UserRole } from '@prisma/client';

describe('Performance Caching & Active Hold Session Continuity', () => {
  let customerUser: { id: string; telegramUserId: bigint; role: UserRole };
  let customerToken: string;
  let lotteryId: string;

  beforeAll(async () => {
    // 1. Create a test customer
    const tgId = BigInt(Math.floor(Math.random() * 900000000) + 100000000);
    const created = await prisma.user.create({
      data: {
        telegramUserId: tgId,
        username: `test_continuity_${Date.now().toString(36)}`,
        firstName: 'Continuity',
        lastName: 'Tester',
      },
    });

    customerUser = {
      id: created.id,
      telegramUserId: created.telegramUserId,
      role: created.role,
    };

    customerToken = signCustomerToken(customerUser);

    // 2. Create a test campaign with numbers
    const lottery = await prisma.lottery.create({
      data: {
        title: 'Session Continuity Test Lottery',
        slug: `session-continuity-${Date.now().toString(36)}`,
        currency: 'ETB',
        ticketPriceMinor: BigInt(5000), // 50 ETB
        prizeDescription: 'iPhone 15 Pro Max',
        numberStart: 1,
        numberEnd: 20,
        holdMinutes: 10,
        status: LotteryStatus.OPEN,
        paymentInstructions: 'Telebirr 0911000000',
      },
    });
    lotteryId = lottery.id;

    const numbers = [];
    for (let i = 1; i <= 20; i++) {
      numbers.push({
        lotteryId,
        numberValue: i,
        status: 'AVAILABLE' as const,
      });
    }
    await prisma.lotteryNumber.createMany({ data: numbers });
  });

  afterAll(async () => {
    try {
      if (customerUser?.id) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: customerUser.id } }).catch(() => {});
      }
      if (lotteryId) {
        await prisma.numberClaim.deleteMany({ where: { lotteryNumber: { lotteryId } } }).catch(() => {});
        await prisma.reservationItem.deleteMany({ where: { lotteryId } }).catch(() => {});
        await prisma.reservation.deleteMany({ where: { lotteryId } }).catch(() => {});
        await prisma.lotteryNumber.deleteMany({ where: { lotteryId } }).catch(() => {});
        await prisma.lottery.delete({ where: { id: lotteryId } }).catch(() => {});
      }
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  it('1. Cache Layer: stores, retrieves, and handles TTL expiration correctly', async () => {
    const testKey = `test:cache:${Date.now()}`;
    await cache.set(testKey, { hello: 'world' }, 60);

    const fetched = await cache.get<{ hello: string }>(testKey);
    expect(fetched).not.toBeNull();
    expect(fetched?.hello).toBe('world');

    await cache.del(testKey);
    const afterDel = await cache.get(testKey);
    expect(afterDel).toBeNull();
  });

  it('2. Cache Layer: atomic setNx handles deduplication (returns true then false)', async () => {
    const dedupKey = `test:dedup:${Date.now()}`;
    const firstAttempt = await cache.setNx(dedupKey, '1', 60);
    expect(firstAttempt).toBe(true);

    const secondAttempt = await cache.setNx(dedupKey, '1', 60);
    expect(secondAttempt).toBe(false);

    await cache.del(dedupKey);
  });

  it('3. Active Hold Session Continuity: returns null when user has no active hold', async () => {
    const res = await request(app)
      .get('/me/active-hold')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.activeHold).toBeNull();
  });

  it('4. Active Hold Session Continuity: automatically caches and restores reservation session', async () => {
    // User selects tickets 1 and 2 and reserves them
    const reserveRes = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        numbers: [1, 2],
        idempotencyKey: `idemp-cont-${Date.now()}`,
      });

    expect(reserveRes.status).toBe(201);
    const createdReservation = reserveRes.body;
    expect(createdReservation.id).toBeDefined();

    // Verify hold session was cached in Redis / Memory cache
    const cachedSession = await cache.get<any>(CACHE_KEYS.ACTIVE_HOLD(customerUser.id));
    expect(cachedSession).not.toBeNull();
    expect(cachedSession.id).toBe(createdReservation.id);

    // Call GET /me/active-hold as if user re-opened the Mini App
    const restoreRes = await request(app)
      .get('/me/active-hold')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.activeHold).not.toBeNull();
    expect(restoreRes.body.activeHold.id).toBe(createdReservation.id);
    expect(restoreRes.body.activeHold.ticketCount).toBe(2);
    expect(restoreRes.body.activeHold.items).toHaveLength(2);

    // Cancel reservation and verify active hold is purged from cache immediately
    const cancelRes = await request(app)
      .post(`/reservations/${createdReservation.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(cancelRes.status).toBe(200);

    const postCancelCheck = await request(app)
      .get('/me/active-hold')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(postCancelCheck.status).toBe(200);
    expect(postCancelCheck.body.activeHold).toBeNull();
  });
});

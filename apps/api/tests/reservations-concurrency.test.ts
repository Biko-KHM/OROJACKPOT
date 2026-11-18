import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { UserRole, LotteryStatus, NumberStatus } from '@prisma/client';
import { signCustomerToken } from '../src/modules/auth/crypto.js';

describe('Step 4: Reservation Service & Concurrency Tests', () => {
  let lotteryId: string;
  const createdLotteryIds: string[] = [];
  const createdUserIds: string[] = [];

  // Helper to create a test customer user and return their Bearer token
  async function createTestCustomer(prefix = 'cust'): Promise<{ id: string; token: string }> {
    const telegramUserId = BigInt(Math.floor(Math.random() * 1000000000) + 7000000);
    const user = await prisma.user.create({
      data: {
        telegramUserId,
        username: `${prefix}_${crypto.randomUUID().slice(0, 6)}`,
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);
    const token = signCustomerToken({
      id: user.id,
      telegramUserId: user.telegramUserId.toString(),
      role: user.role,
    });
    return { id: user.id, token };
  }

  beforeAll(async () => {
    // Create an OPEN campaign with 200 numbers (1 to 200) for concurrency tests
    const lottery = await prisma.lottery.create({
      data: {
        slug: `conc-lottery-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Concurrency Test Lottery',
        prizeDescription: '100,000 ETB Grand Prize',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: 5000n, // 50 ETB
        numberStart: 1,
        numberEnd: 200,
        maxNumbersPerPurchase: 20,
        holdMinutes: 10,
      },
    });
    lotteryId = lottery.id;
    createdLotteryIds.push(lottery.id);

    // Create 200 lottery numbers
    const numbersData = Array.from({ length: 200 }, (_, i) => ({
      lotteryId: lottery.id,
      numberValue: i + 1,
      status: NumberStatus.AVAILABLE,
    }));
    await prisma.lotteryNumber.createMany({ data: numbersData });
  });

  afterAll(async () => {
    for (const id of createdLotteryIds) {
      try { await prisma.reservationItem.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.numberClaim.deleteMany({ where: { reservation: { lotteryId: id } } }); } catch { /* ignore */ }
      try { await prisma.reservation.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.channelPost.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lottery.deleteMany({ where: { id } }); } catch { /* ignore */ }
    }
    await prisma.$disconnect();
  });

  it('1. 50 parallel requests for the same number produce exactly 1 success and 49 conflicts', async () => {
    const targetNumber = 42;
    const concurrency = 50;

    // Create 50 distinct customer tokens
    const customers = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => createTestCustomer(`buyer_${i}`)),
    );

    // Concurrently fire 50 reservation requests for number 42
    const promises = customers.map((c, i) =>
      request(app)
        .post(`/lotteries/${lotteryId}/reservations`)
        .set('Authorization', `Bearer ${c.token}`)
        .send({
          numbers: [targetNumber],
          idempotencyKey: `idemp-race-${i}-${crypto.randomUUID().slice(0, 8)}`,
        }),
    );

    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successful).toHaveLength(1);
    expect(conflicts).toHaveLength(concurrency - 1);

    // The winner received 201 with reservation details
    const winnerData = successful[0]!.body;
    expect(winnerData.status).toBe('AWAITING_PAYMENT');
    expect(winnerData.ticketCount).toBe(1);
    expect(winnerData.totalAmountMinor).toBe('5000');
    expect(winnerData.items).toHaveLength(1);
    expect(winnerData.items[0].numberValue).toBe(targetNumber);

    // All conflicts returned NUMBER_UNAVAILABLE
    for (const conflict of conflicts) {
      expect(conflict.body.error.code).toBe('NUMBER_UNAVAILABLE');
    }

    // Database verification: exactly 1 active claim and status HELD
    const dbNumber = await prisma.lotteryNumber.findUnique({
      where: {
        lotteryId_numberValue: {
          lotteryId,
          numberValue: targetNumber,
        },
      },
      include: {
        claims: { where: { status: 'ACTIVE' } },
      },
    });

    expect(dbNumber).not.toBeNull();
    expect(dbNumber!.status).toBe(NumberStatus.HELD);
    expect(dbNumber!.claims).toHaveLength(1);
  }, 30000);

  it('2. Request with 5 numbers where 1 is held holds none (Atomic rollback)', async () => {
    // Number 42 is already held from previous test.
    // Buyer attempts to reserve [40, 41, 42, 43, 44]
    const buyer = await createTestCustomer('batch_buyer');
    const numbersToRequest = [40, 41, 42, 43, 44];

    const res = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: numbersToRequest,
        idempotencyKey: `idemp-atomic-${crypto.randomUUID().slice(0, 8)}`,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NUMBER_UNAVAILABLE');

    // Verify none of the other numbers (40, 41, 43, 44) were held
    const dbNumbers = await prisma.lotteryNumber.findMany({
      where: {
        lotteryId,
        numberValue: { in: [40, 41, 43, 44] },
      },
    });

    expect(dbNumbers).toHaveLength(4);
    for (const num of dbNumbers) {
      expect(num.status).toBe(NumberStatus.AVAILABLE);
    }

    // Verify no reservation created for buyer
    const buyerReservations = await prisma.reservation.findMany({
      where: { userId: buyer.id },
    });
    expect(buyerReservations).toHaveLength(0);
  });

  it('3. Retried request with the same idempotency key returns the original reservation', async () => {
    const buyer = await createTestCustomer('idemp_buyer');
    const idempotencyKey = `idemp-key-repeat-${crypto.randomUUID().slice(0, 8)}`;
    const numbers = [50, 51];

    // First attempt
    const res1 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ numbers, idempotencyKey });

    expect(res1.status).toBe(201);
    const reservation1 = res1.body;

    // Retry identical request
    const res2 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ numbers, idempotencyKey });

    expect([200, 201]).toContain(res2.status);
    const reservation2 = res2.body;

    expect(reservation2.id).toBe(reservation1.id);
    expect(reservation2.publicReference).toBe(reservation1.publicReference);
    expect(reservation2.totalAmountMinor).toBe(reservation1.totalAmountMinor);

    // Verify only 1 reservation in database
    const dbReservations = await prisma.reservation.findMany({
      where: {
        userId: buyer.id,
        idempotencyKey,
      },
    });
    expect(dbReservations).toHaveLength(1);
  });

  it('4. Same idempotency key with a different payload returns 422 Unprocessable Entity', async () => {
    const buyer = await createTestCustomer('idemp_conflict_buyer');
    const idempotencyKey = `idemp-diff-payload-${crypto.randomUUID().slice(0, 8)}`;

    // First request
    const res1 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ numbers: [60, 61], idempotencyKey });

    expect(res1.status).toBe(201);

    // Second request with SAME idempotency key but DIFFERENT numbers
    const res2 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ numbers: [62, 63], idempotencyKey });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_MISMATCH');

    // Numbers 62 and 63 must still be AVAILABLE
    const numbers62_63 = await prisma.lotteryNumber.findMany({
      where: {
        lotteryId,
        numberValue: { in: [62, 63] },
      },
    });
    expect(numbers62_63).toHaveLength(2);
    for (const num of numbers62_63) {
      expect(num.status).toBe(NumberStatus.AVAILABLE);
    }
  });

  it('5. Overlapping groups of numbers across 20 parallel requests do not deadlock', async () => {
    // 20 concurrent buyers requesting overlapping sliding windows:
    // Buyer 0: [70, 71, 72]
    // Buyer 1: [71, 72, 73]
    // Buyer 2: [72, 73, 74]
    // ...
    // Buyer 19: [89, 90, 91]
    const buyers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createTestCustomer(`overlap_buyer_${i}`)),
    );

    const promises = buyers.map((buyer, i) => {
      const windowStart = 70 + i;
      const numbers = [windowStart, windowStart + 1, windowStart + 2];
      return request(app)
        .post(`/lotteries/${lotteryId}/reservations`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({
          numbers,
          idempotencyKey: `overlap-${i}-${crypto.randomUUID().slice(0, 8)}`,
        });
    });

    const results = await Promise.all(promises);

    // Verify all completed with valid HTTP status (201 or 409), NO 500s, NO deadlocks
    for (const res of results) {
      expect([201, 409]).toContain(res.status);
    }

    const successful = results.filter((r) => r.status === 201);
    expect(successful.length).toBeGreaterThan(0);

    // Verify that among all successful reservations, no number was allocated more than once
    const allHeldNumberValues: number[] = [];
    for (const res of successful) {
      const heldItems = res.body.items as Array<{ numberValue: number }>;
      for (const item of heldItems) {
        allHeldNumberValues.push(item.numberValue);
      }
    }

    const uniqueHeld = new Set(allHeldNumberValues);
    expect(uniqueHeld.size).toBe(allHeldNumberValues.length);
  });

  it('enforces maximum 3 simultaneous AWAITING_PAYMENT reservations per user', async () => {
    const buyer = await createTestCustomer('limit_buyer');

    // Create 3 reservations (numbers 101, 102, 103)
    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post(`/lotteries/${lotteryId}/reservations`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({
          numbers: [100 + i],
          idempotencyKey: `limit-test-${i}`,
        });
      expect(res.status).toBe(201);
    }

    // 4th reservation must be rejected with 409 RESERVATION_LIMIT_EXCEEDED
    const res4 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: [104],
        idempotencyKey: 'limit-test-4',
      });

    expect(res4.status).toBe(409);
    expect(res4.body.error.code).toBe('RESERVATION_LIMIT_EXCEEDED');

    // Number 104 remains AVAILABLE
    const num104 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 104 } },
    });
    expect(num104!.status).toBe(NumberStatus.AVAILABLE);
  });

  it('allows user to cancel an AWAITING_PAYMENT reservation and releases numbers', async () => {
    const buyer = await createTestCustomer('cancel_buyer');

    // Create reservation for number 110
    const createRes = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: [110],
        idempotencyKey: 'cancel-test-key',
      });
    expect(createRes.status).toBe(201);
    const reservationId = createRes.body.id;

    // Verify number is HELD
    let num110 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 110 } },
    });
    expect(num110!.status).toBe(NumberStatus.HELD);

    // Cancel reservation
    const cancelRes = await request(app)
      .post(`/reservations/${reservationId}/cancel`)
      .set('Authorization', `Bearer ${buyer.token}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // Verify number is now back to AVAILABLE
    num110 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 110 } },
    });
    expect(num110!.status).toBe(NumberStatus.AVAILABLE);

    // Verify claim is RELEASED
    const claim = await prisma.numberClaim.findFirst({
      where: { reservationId },
    });
    expect(claim!.status).toBe('RELEASED');
  });

  it('prevents blocked users from creating reservations', async () => {
    const buyer = await createTestCustomer('blocked_buyer');

    // Mark user as blocked
    await prisma.user.update({
      where: { id: buyer.id },
      data: { isBlocked: true },
    });

    const res = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: [120],
        idempotencyKey: 'blocked-test-key',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_BLOCKED');
  });

  it('runs 20 consecutive concurrency races without any double-booking or deadlock (Acceptance Criteria)', async () => {
    // 20 consecutive races for 20 distinct numbers, each contested by 5 parallel buyers
    for (let race = 0; race < 20; race++) {
      const contestNumber = 130 + race; // numbers 130 to 149
      const racers = await Promise.all([
        createTestCustomer(`racer_a_${race}`),
        createTestCustomer(`racer_b_${race}`),
        createTestCustomer(`racer_c_${race}`),
        createTestCustomer(`racer_d_${race}`),
        createTestCustomer(`racer_e_${race}`),
      ]);

      const racePromises = racers.map((racer, idx) =>
        request(app)
          .post(`/lotteries/${lotteryId}/reservations`)
          .set('Authorization', `Bearer ${racer.token}`)
          .send({
            numbers: [contestNumber],
            idempotencyKey: `race-${race}-racer-${idx}`,
          }),
      );

      const results = await Promise.all(racePromises);

      const wins = results.filter((r) => r.status === 201);
      const losses = results.filter((r) => r.status === 409);

      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(4);

      // Verify the number in DB has exactly 1 active claim
      const dbNum = await prisma.lotteryNumber.findUnique({
        where: { lotteryId_numberValue: { lotteryId, numberValue: contestNumber } },
        include: { claims: { where: { status: 'ACTIVE' } } },
      });

      expect(dbNum!.status).toBe(NumberStatus.HELD);
      expect(dbNum!.claims).toHaveLength(1);
    }
  }, 60000);
});

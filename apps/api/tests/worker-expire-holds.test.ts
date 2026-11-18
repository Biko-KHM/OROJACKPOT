import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { prisma } from '../src/db/index.js';
import { UserRole, LotteryStatus, NumberStatus, ReservationStatus, ClaimStatus } from '@prisma/client';
import { expireHolds } from '../src/worker/expireHolds.js';

describe('Step 5: Hold Expiry Worker', () => {
  let lotteryId: string;
  let customerUserA: { id: string; telegramUserId: bigint };
  let customerUserB: { id: string; telegramUserId: bigint };
  const createdLotteryIds: string[] = [];

  beforeAll(async () => {
    // Create an OPEN campaign with 50 numbers (1 to 50)
    const lottery = await prisma.lottery.create({
      data: {
        slug: `worker-lottery-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Worker Test Lottery',
        prizeDescription: '50,000 ETB Cash',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: 2500n,
        numberStart: 1,
        numberEnd: 50,
        maxNumbersPerPurchase: 10,
        holdMinutes: 10,
      },
    });
    lotteryId = lottery.id;
    createdLotteryIds.push(lottery.id);

    // Create 50 numbers
    const numbersData = Array.from({ length: 50 }, (_, i) => ({
      lotteryId: lottery.id,
      numberValue: i + 1,
      status: NumberStatus.AVAILABLE,
    }));
    await prisma.lotteryNumber.createMany({ data: numbersData });

    // Create two test customer users
    customerUserA = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 8000000),
        username: `worker_cust_a_${crypto.randomUUID().slice(0, 6)}`,
        role: UserRole.CUSTOMER,
      },
    });

    customerUserB = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 8500000),
        username: `worker_cust_b_${crypto.randomUUID().slice(0, 6)}`,
        role: UserRole.CUSTOMER,
      },
    });
  });

  afterAll(async () => {
    for (const id of createdLotteryIds) {
      try { await prisma.reservationItem.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.numberClaim.deleteMany({ where: { reservation: { lotteryId: id } } }); } catch { /* ignore */ }
      try { await prisma.reservation.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lottery.deleteMany({ where: { id } }); } catch { /* ignore */ }
    }
    await prisma.$disconnect();
  });

  // Helper to create a reservation directly in DB with custom status and holdExpiresAt
  async function seedReservation(params: {
    userId: string;
    numberValues: number[];
    status: ReservationStatus;
    holdExpiresAt: Date;
  }) {
    const numbers = await prisma.lotteryNumber.findMany({
      where: {
        lotteryId,
        numberValue: { in: params.numberValues },
      },
    });

    const reservation = await prisma.reservation.create({
      data: {
        publicReference: `RES-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
        userId: params.userId,
        lotteryId,
        status: params.status,
        currency: 'ETB',
        unitPriceMinor: 2500n,
        ticketCount: numbers.length,
        totalAmountMinor: BigInt(numbers.length) * 2500n,
        holdExpiresAt: params.holdExpiresAt,
      },
    });

    await prisma.lotteryNumber.updateMany({
      where: { id: { in: numbers.map((n) => n.id) } },
      data: { status: NumberStatus.HELD },
    });

    await prisma.reservationItem.createMany({
      data: numbers.map((n) => ({
        reservationId: reservation.id,
        lotteryId,
        lotteryNumberId: n.id,
        numberValueSnapshot: n.numberValue,
        unitPriceMinor: 2500n,
      })),
    });

    await prisma.numberClaim.createMany({
      data: numbers.map((n) => ({
        lotteryNumberId: n.id,
        reservationId: reservation.id,
        status: ClaimStatus.ACTIVE,
        expiresAt: params.holdExpiresAt,
      })),
    });

    return { reservation, numbers };
  }

  it('1. Expired holds release: marks EXPIRED, releases claims, resets numbers to AVAILABLE', async () => {
    // Create reservation expired 5 minutes ago for numbers [1, 2]
    const { reservation, numbers } = await seedReservation({
      userId: customerUserA.id,
      numberValues: [1, 2],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Run hold expiry
    const result = await expireHolds();

    expect(result.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify reservation status changed to EXPIRED
    const updatedReservation = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(updatedReservation!.status).toBe(ReservationStatus.EXPIRED);

    // Verify claims changed to RELEASED
    const claims = await prisma.numberClaim.findMany({
      where: { reservationId: reservation.id },
    });
    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(claim.status).toBe(ClaimStatus.RELEASED);
      expect(claim.releasedAt).not.toBeNull();
    }

    // Verify lottery numbers reset to AVAILABLE
    const updatedNumbers = await prisma.lotteryNumber.findMany({
      where: { id: { in: numbers.map((n) => n.id) } },
    });
    for (const num of updatedNumbers) {
      expect(num.status).toBe(NumberStatus.AVAILABLE);
    }

    // Verify outbox event written
    const outbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'PROGRESS_UPDATE',
        payload: { path: ['reservationId'], equals: reservation.id },
      },
    });
    expect(outbox).not.toBeNull();
  });

  it('2. PENDING_REVIEW is untouched: never expires reservations under payment review', async () => {
    // Create reservation expired 5 minutes ago but in PENDING_REVIEW status for numbers [3, 4]
    const { reservation, numbers } = await seedReservation({
      userId: customerUserA.id,
      numberValues: [3, 4],
      status: ReservationStatus.PENDING_REVIEW,
      holdExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Run hold expiry
    await expireHolds();

    // Verify reservation is still PENDING_REVIEW
    const checkReservation = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(checkReservation!.status).toBe(ReservationStatus.PENDING_REVIEW);

    // Verify claims are STILL ACTIVE
    const claims = await prisma.numberClaim.findMany({
      where: { reservationId: reservation.id },
    });
    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(claim.status).toBe(ClaimStatus.ACTIVE);
    }

    // Verify numbers are still HELD
    const checkNumbers = await prisma.lotteryNumber.findMany({
      where: { id: { in: numbers.map((n) => n.id) } },
    });
    for (const num of checkNumbers) {
      expect(num.status).toBe(NumberStatus.HELD);
    }
  });

  it('3. Running the job twice in parallel releases once without duplicate work', async () => {
    // Seed 3 expired reservations
    const resA = await seedReservation({
      userId: customerUserA.id,
      numberValues: [5],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 10_000),
    });
    const resB = await seedReservation({
      userId: customerUserA.id,
      numberValues: [6],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 10_000),
    });
    const resC = await seedReservation({
      userId: customerUserA.id,
      numberValues: [7],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 10_000),
    });

    // Run two expireHolds in parallel (simulating two worker pods/processes)
    const [result1, result2] = await Promise.all([
      expireHolds(),
      expireHolds(),
    ]);

    // Total expired reservations across both parallel workers should equal the 3 seeded
    const totalExpired = result1.expiredCount + result2.expiredCount;
    expect(totalExpired).toBe(3);

    // Verify all 3 are EXPIRED in database
    const checkReservations = await prisma.reservation.findMany({
      where: { id: { in: [resA.reservation.id, resB.reservation.id, resC.reservation.id] } },
    });
    for (const res of checkReservations) {
      expect(res.status).toBe(ReservationStatus.EXPIRED);
    }

    // Numbers 5, 6, 7 are AVAILABLE
    const checkNumbers = await prisma.lotteryNumber.findMany({
      where: { lotteryId, numberValue: { in: [5, 6, 7] } },
    });
    for (const num of checkNumbers) {
      expect(num.status).toBe(NumberStatus.AVAILABLE);
    }
  });

  it('4. A number already re-held by another buyer is not touched', async () => {
    // Step A: Reservation 1 for number 15 has expired
    const res1 = await seedReservation({
      userId: customerUserA.id,
      numberValues: [15],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 60_000),
    });

    // Mark res1's claim as released (e.g. manually or through a partial sequence)
    await prisma.numberClaim.updateMany({
      where: { reservationId: res1.reservation.id },
      data: { status: ClaimStatus.RELEASED },
    });

    // Step B: Buyer B now holds number 15 under a fresh active reservation
    const res2 = await seedReservation({
      userId: customerUserB.id,
      numberValues: [15],
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // Valid for 10 minutes
    });

    // Step C: Run hold expiry. Res1 is expired and processed.
    await expireHolds();

    // Verify Res 1 is marked EXPIRED
    const checkRes1 = await prisma.reservation.findUnique({
      where: { id: res1.reservation.id },
    });
    expect(checkRes1!.status).toBe(ReservationStatus.EXPIRED);

    // Verify number 15 is STILL HELD because Buyer B has an active claim on it!
    const num15 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 15 } },
    });
    expect(num15!.status).toBe(NumberStatus.HELD);

    // Verify Buyer B's claim is still ACTIVE
    const claimB = await prisma.numberClaim.findFirst({
      where: { reservationId: res2.reservation.id },
    });
    expect(claimB!.status).toBe(ClaimStatus.ACTIVE);
  });
});

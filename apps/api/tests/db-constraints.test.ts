import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { prisma } from '../src/db/index.js';
import {
  UserRole,
  LotteryStatus,
  NumberStatus,
  ReservationStatus,
  ClaimStatus,
  PaymentStatus,
} from '@prisma/client';

describe('Database Schema Constraints & Append-Only Triggers', () => {
  let testUserId: string;
  let testLotteryId: string;
  let testNumberId: string;
  let testReservationId: string;

  beforeAll(async () => {
    // 1. Create a test customer user
    const randomTgId = BigInt(Math.floor(Math.random() * 1000000000) + 1000000);
    const user = await prisma.user.create({
      data: {
        telegramUserId: randomTgId,
        username: `testuser_${randomTgId}`,
        role: UserRole.CUSTOMER,
      },
    });
    testUserId = user.id;

    // 2. Create a test lottery
    const lottery = await prisma.lottery.create({
      data: {
        slug: `test-lottery-${crypto.randomUUID()}`,
        title: 'Integration Test Lottery',
        prizeDescription: 'Grand Prize 10,000 ETB',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: BigInt(2000), // 20 ETB
        numberStart: 1,
        numberEnd: 50,
      },
    });
    testLotteryId = lottery.id;

    // 3. Create a test lottery number
    const number = await prisma.lotteryNumber.create({
      data: {
        lotteryId: testLotteryId,
        numberValue: 1,
        status: NumberStatus.AVAILABLE,
      },
    });
    testNumberId = number.id;

    // 4. Create a test reservation
    const reservation = await prisma.reservation.create({
      data: {
        publicReference: `REF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: testUserId,
        lotteryId: testLotteryId,
        status: ReservationStatus.AWAITING_PAYMENT,
        currency: 'ETB',
        unitPriceMinor: BigInt(2000),
        ticketCount: 1,
        totalAmountMinor: BigInt(2000), // 2000 * 1 = 2000 (valid)
      },
    });
    testReservationId = reservation.id;
  });

  afterAll(async () => {
    // Clean up test records (audit_logs will remain as append-only)
    try { await prisma.numberClaim.deleteMany({ where: { reservationId: testReservationId } }); } catch { /* ignore */ }
    try { await prisma.paymentSubmission.deleteMany({ where: { reservationId: testReservationId } }); } catch { /* ignore */ }
    try { await prisma.reservation.deleteMany({ where: { id: testReservationId } }); } catch { /* ignore */ }
    try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId: testLotteryId } }); } catch { /* ignore */ }
    try { await prisma.lottery.deleteMany({ where: { id: testLotteryId } }); } catch { /* ignore */ }
    try { await prisma.user.deleteMany({ where: { id: testUserId } }); } catch { /* ignore */ }
    await prisma.$disconnect();
  });

  it('proves two ACTIVE claims on one number fail via one_active_claim_per_number', async () => {
    // First active claim
    await prisma.numberClaim.create({
      data: {
        lotteryNumberId: testNumberId,
        reservationId: testReservationId,
        status: ClaimStatus.ACTIVE,
      },
    });

    // Second active claim on the exact same number must fail
    await expect(
      prisma.numberClaim.create({
        data: {
          lotteryNumberId: testNumberId,
          reservationId: testReservationId,
          status: ClaimStatus.ACTIVE,
        },
      }),
    ).rejects.toThrow();
  });

  it('proves a second SUBMITTED payment for one reservation fails via one_open_submission_per_reservation', async () => {
    // First submitted payment
    await prisma.paymentSubmission.create({
      data: {
        reservationId: testReservationId,
        submittedBy: testUserId,
        storageKey: `proofs/${crypto.randomUUID()}.jpg`,
        originalFilename: 'receipt.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: BigInt(1024),
        fileSha256: crypto.randomBytes(32).toString('hex'),
        status: PaymentStatus.SUBMITTED,
      },
    });

    // Second submitted payment for the same reservation must fail
    await expect(
      prisma.paymentSubmission.create({
        data: {
          reservationId: testReservationId,
          submittedBy: testUserId,
          storageKey: `proofs/${crypto.randomUUID()}_second.jpg`,
          originalFilename: 'receipt2.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: BigInt(2048),
          fileSha256: crypto.randomBytes(32).toString('hex'),
          status: PaymentStatus.SUBMITTED,
        },
      }),
    ).rejects.toThrow();
  });

  it('proves UPDATE on audit_logs fails via append-only trigger', async () => {
    // Insert an audit log entry
    const auditRow = await prisma.auditLog.create({
      data: {
        actorUserId: testUserId,
        action: 'TEST_ACTION',
        entityType: 'RESERVATION',
        entityId: testReservationId,
        details: { note: 'Initial creation' },
      },
    });

    // Attempting to UPDATE the audit row must be rejected by the trigger
    await expect(
      prisma.auditLog.update({
        where: { id: auditRow.id },
        data: { action: 'TAMPERED_ACTION' },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it('proves DELETE on audit_logs fails via append-only trigger', async () => {
    const auditRow = await prisma.auditLog.create({
      data: {
        actorUserId: testUserId,
        action: 'DELETE_TEST',
        entityType: 'RESERVATION',
        entityId: testReservationId,
      },
    });

    // Attempting to DELETE the audit row must be rejected by the trigger
    await expect(
      prisma.auditLog.delete({
        where: { id: auditRow.id },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it('proves reservations total calculation CHECK constraint rejects invalid total_amount_minor', async () => {
    // unit_price = 2000, ticket_count = 3, but total = 5000 (should be 6000)
    await expect(
      prisma.reservation.create({
        data: {
          publicReference: `REF-ERR-${crypto.randomUUID().slice(0, 8)}`,
          userId: testUserId,
          lotteryId: testLotteryId,
          status: ReservationStatus.AWAITING_PAYMENT,
          currency: 'ETB',
          unitPriceMinor: BigInt(2000),
          ticketCount: 3,
          totalAmountMinor: BigInt(5000), // INVALID! Violates check_total_amount_calculation
        },
      }),
    ).rejects.toThrow();
  });
});

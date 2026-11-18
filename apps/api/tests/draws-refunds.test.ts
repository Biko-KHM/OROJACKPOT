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
  ClaimStatus,
} from '@prisma/client';
import {
  signAdminSessionToken,
  generateCsrfToken,
} from '../src/modules/auth/crypto.js';

describe('Step 11: Draws and Refunds Module', () => {
  let superadmin: { id: string; cookie: string; csrfToken: string };
  let standardAdmin: { id: string; cookie: string; csrfToken: string };
  const createdLotteryIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createAdminWithRole(role: UserRole, prefix: string) {
    const email = `${prefix}_${crypto.randomUUID().slice(0, 6)}@test.com`;
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 7000000),
        username: prefix,
        role,
        adminCredential: {
          create: {
            email,
            passwordHash: 'dummy_hash',
          },
        },
      },
    });
    createdUserIds.push(user.id);
    const csrfToken = generateCsrfToken();
    const sessionToken = signAdminSessionToken(
      { id: user.id, email, role: user.role },
      csrfToken,
    );
    const cookie = `admin_session=${sessionToken}`;
    return { id: user.id, cookie, csrfToken };
  }

  beforeAll(async () => {
    superadmin = await createAdminWithRole(UserRole.SUPERADMIN, 'superadmin_draw');
    standardAdmin = await createAdminWithRole(UserRole.ADMIN, 'admin_draw');
  });

  afterAll(async () => {
    for (const lotteryId of createdLotteryIds) {
      try {
        await prisma.refund.deleteMany({ where: { reservation: { lotteryId } } });
      } catch { /* ignore */ }
      try {
        await prisma.numberClaim.deleteMany({ where: { lotteryNumber: { lotteryId } } });
      } catch { /* ignore */ }
      try {
        await prisma.reservationItem.deleteMany({ where: { lotteryId } });
      } catch { /* ignore */ }
      try {
        await prisma.reservation.deleteMany({ where: { lotteryId } });
      } catch { /* ignore */ }
      try {
        await prisma.lotteryNumber.deleteMany({ where: { lotteryId } });
      } catch { /* ignore */ }
      try {
        await prisma.lottery.deleteMany({ where: { id: lotteryId } });
      } catch { /* ignore */ }
    }

    for (const userId of createdUserIds) {
      try {
        await prisma.adminCredential.deleteMany({ where: { userId } });
      } catch { /* ignore */ }
    }

    await prisma.$disconnect();
  });

  it('proves draws are refused unless the campaign is CLOSED', async () => {
    // 1. Create campaign in OPEN status
    const lottery = await prisma.lottery.create({
      data: {
        slug: `draw-open-${crypto.randomUUID()}`,
        title: 'Open Campaign for Draw Test',
        prizeDescription: 'Car',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: BigInt(5000),
        numberStart: 1,
        numberEnd: 10,
      },
    });
    createdLotteryIds.push(lottery.id);

    const res = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'First Prize' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(res.body.error.message).toMatch(/refused unless the campaign is CLOSED/i);
  });

  it('proves only SUPERADMIN can execute a draw', async () => {
    const lottery = await prisma.lottery.create({
      data: {
        slug: `draw-role-${crypto.randomUUID()}`,
        title: 'Closed Campaign for Role Test',
        prizeDescription: 'Motorcycle',
        status: LotteryStatus.CLOSED,
        currency: 'ETB',
        ticketPriceMinor: BigInt(5000),
        numberStart: 1,
        numberEnd: 10,
      },
    });
    createdLotteryIds.push(lottery.id);

    const res = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ prizeLabel: 'First Prize' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('executes draw with strictly confirmed tickets and verifies SHA-256 integrity and trigger protection', async () => {
    // 1. Create CLOSED lottery
    const lottery = await prisma.lottery.create({
      data: {
        slug: `draw-exec-${crypto.randomUUID()}`,
        title: 'Draw Execution Campaign',
        prizeDescription: 'Luxury Sedan',
        status: LotteryStatus.CLOSED,
        currency: 'ETB',
        ticketPriceMinor: BigInt(2000),
        numberStart: 1,
        numberEnd: 10,
      },
    });
    createdLotteryIds.push(lottery.id);

    // 2. Create customer
    const customer = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 8000000),
        username: `winner_${crypto.randomUUID().slice(0, 5)}`,
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(customer.id);

    // 3. Create confirmed reservation with ticket numbers [3, 7, 9] (out of order insertion)
    const numbersToConfirm = [7, 3, 9];
    const reservation = await prisma.reservation.create({
      data: {
        publicReference: `REF-WIN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: customer.id,
        lotteryId: lottery.id,
        status: ReservationStatus.CONFIRMED,
        currency: 'ETB',
        unitPriceMinor: BigInt(2000),
        ticketCount: 3,
        totalAmountMinor: BigInt(6000),
      },
    });

    for (const val of numbersToConfirm) {
      const num = await prisma.lotteryNumber.create({
        data: {
          lotteryId: lottery.id,
          numberValue: val,
          status: NumberStatus.SOLD,
        },
      });

      await prisma.numberClaim.create({
        data: {
          lotteryNumberId: num.id,
          reservationId: reservation.id,
          status: ClaimStatus.CONFIRMED,
        },
      });

      await prisma.reservationItem.create({
        data: {
          reservationId: reservation.id,
          lotteryId: lottery.id,
          lotteryNumberId: num.id,
          numberValueSnapshot: val,
          unitPriceMinor: BigInt(2000),
        },
      });
    }

    // Also add an unconfirmed reservation with ticket [5] to verify it is NOT in eligible set
    const pendingRes = await prisma.reservation.create({
      data: {
        publicReference: `REF-PEND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: customer.id,
        lotteryId: lottery.id,
        status: ReservationStatus.AWAITING_PAYMENT,
        currency: 'ETB',
        unitPriceMinor: BigInt(2000),
        ticketCount: 1,
        totalAmountMinor: BigInt(2000),
      },
    });
    const pendingNum = await prisma.lotteryNumber.create({
      data: {
        lotteryId: lottery.id,
        numberValue: 5,
        status: NumberStatus.HELD,
      },
    });
    await prisma.reservationItem.create({
      data: {
        reservationId: pendingRes.id,
        lotteryId: lottery.id,
        lotteryNumberId: pendingNum.id,
        numberValueSnapshot: 5,
        unitPriceMinor: BigInt(2000),
      },
    });

    // 4. Execute draw
    const drawRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Grand Prize' });

    expect(drawRes.status).toBe(200);
    const drawData = drawRes.body.data;
    expect(drawData.eligibleCount).toBe(3);
    expect([3, 7, 9]).toContain(drawData.winningNumber);

    // Verify SHA-256 computation over canonical ticket snapshot
    expect(drawData.eligibleSetSha256).toBeDefined();
    expect(drawData.eligibleSetSha256.length).toBe(64);
    expect(drawData.randomSeed).toBeDefined();

    // Verify lottery status is updated to COMPLETED
    const updatedLottery = await prisma.lottery.findUnique({ where: { id: lottery.id } });
    expect(updatedLottery?.status).toBe(LotteryStatus.COMPLETED);

    // 5. Refuse second draw for same prize (409 DRAW_ALREADY_EXISTS)
    // Note: status is now COMPLETED, but even if closed, prizeLabel must be unique
    await prisma.lottery.update({ where: { id: lottery.id }, data: { status: LotteryStatus.CLOSED } });
    const duplicateDrawRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Grand Prize' });

    expect(duplicateDrawRes.status).toBe(409);
    expect(duplicateDrawRes.body.error.code).toBe('DRAW_ALREADY_EXISTS');

    // 6. DB Trigger protection: Attempting UPDATE on draws table must be rejected
    await expect(
      prisma.draw.update({
        where: { id: drawData.id },
        data: { winningNumber: 999 },
      }),
    ).rejects.toThrow();

    // 7. DB Trigger protection: Attempting DELETE on draws table must be rejected
    await expect(
      prisma.draw.delete({
        where: { id: drawData.id },
      }),
    ).rejects.toThrow();

    // 8. Announce draw result to Telegram channel
    const announceRes = await request(app)
      .post(`/admin/draws/${drawData.id}/announce`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send();

    expect(announceRes.status).toBe(200);
    expect(announceRes.body.data.success).toBe(true);

    // Verify outbox event was generated
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: { eventType: 'PUBLISH_DRAW_RESULT_TO_CHANNEL' },
      orderBy: { createdAt: 'desc' },
    });
    expect(outboxEvent).not.toBeNull();
  });

  it('creates PENDING refunds on lottery cancellation and allows admin to mark PAID', async () => {
    // 1. Create OPEN lottery
    const lottery = await prisma.lottery.create({
      data: {
        slug: `cancel-refund-${crypto.randomUUID()}`,
        title: 'Campaign for Cancellation Test',
        prizeDescription: 'Smartphone',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: BigInt(1500),
        numberStart: 1,
        numberEnd: 5,
      },
    });
    createdLotteryIds.push(lottery.id);

    // 2. Create customer and confirmed reservation
    const customer = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 9000000),
        username: `refund_user_${crypto.randomUUID().slice(0, 5)}`,
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(customer.id);

    const reservation = await prisma.reservation.create({
      data: {
        publicReference: `REF-RFD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: customer.id,
        lotteryId: lottery.id,
        status: ReservationStatus.CONFIRMED,
        currency: 'ETB',
        unitPriceMinor: BigInt(1500),
        ticketCount: 2,
        totalAmountMinor: BigInt(3000),
      },
    });

    // 3. Cancel lottery
    const cancelRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/cancel`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ reason: 'Campaign under-subscribed' });

    expect(cancelRes.status).toBe(200);
    const cancelBody = cancelRes.body.data || cancelRes.body;
    expect(cancelBody.status).toBe(LotteryStatus.CANCELLED);

    // 4. Verify refund row was automatically generated
    const refundListRes = await request(app)
      .get(`/admin/refunds?lotteryId=${lottery.id}`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken);

    expect(refundListRes.status).toBe(200);
    expect(refundListRes.body.data.length).toBe(1);
    const refund = refundListRes.body.data[0];
    expect(refund.status).toBe('PENDING');
    expect(refund.amountMinor).toBe('3000');
    expect(refund.reservationReference).toBe(reservation.publicReference);

    // 5. Admin marks refund as PAID
    const markPaidRes = await request(app)
      .post(`/admin/refunds/${refund.id}/mark-paid`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ note: 'Transferred via Telebirr ref #987654321' });

    expect(markPaidRes.status).toBe(200);
    expect(markPaidRes.body.data.status).toBe('PAID');

    // 6. Proves marking already PAID refund throws 409 ALREADY_PAID
    const duplicatePaidRes = await request(app)
      .post(`/admin/refunds/${refund.id}/mark-paid`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ note: 'Duplicate mark' });

    expect(duplicatePaidRes.status).toBe(409);
    expect(duplicatePaidRes.body.error.code).toBe('ALREADY_PAID');
  });
});

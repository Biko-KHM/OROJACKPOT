import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { UserRole, LotteryStatus, NumberStatus, ReservationStatus } from '@prisma/client';
import { signAdminSessionToken, generateCsrfToken } from '../src/modules/auth/crypto.js';

describe('Step 3: Campaigns and Inventory Module', () => {
  let adminUserId: string;
  let adminSessionCookie: string;
  const adminCsrfToken = generateCsrfToken();
  const createdLotteryIds: string[] = [];

  beforeAll(async () => {
    // Create an Admin user with adminCredential
    const adminUser = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 4000000),
        username: 'campaign_admin',
        role: UserRole.ADMIN,
        adminCredential: {
          create: {
            email: `campaign_admin_${crypto.randomUUID().slice(0, 6)}@test.com`,
            passwordHash: 'dummy_hash',
          },
        },
      },
      include: { adminCredential: true },
    });
    adminUserId = adminUser.id;

    // Create session token and cookie
    const sessionToken = signAdminSessionToken(
      { id: adminUser.id, email: adminUser.adminCredential!.email, role: adminUser.role },
      adminCsrfToken,
    );
    adminSessionCookie = `admin_session=${sessionToken}`;
  });

  afterAll(async () => {
    for (const id of createdLotteryIds) {
      try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.reservation.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lottery.deleteMany({ where: { id } }); } catch { /* ignore */ }
    }
    try { await prisma.adminCredential.deleteMany({ where: { userId: adminUserId } }); } catch { /* ignore */ }
    try { await prisma.user.deleteMany({ where: { id: adminUserId } }); } catch { /* ignore */ }
    await prisma.$disconnect();
  });

  it('creates a new campaign in DRAFT status and writes an audit row', async () => {
    const slug = `test-camp-${crypto.randomUUID().slice(0, 8)}`;
    const payload = {
      slug,
      title: 'Mega Launch Draw',
      description: 'Exclusive 500 ticket lottery',
      prizeDescription: '50,000 ETB Cash',
      ticketPriceMinor: 2500, // 25 ETB
      numberStart: 1,
      numberEnd: 50,
      maxNumbersPerPurchase: 5,
      holdMinutes: 10,
    };

    const res = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe(slug);
    expect(res.body.status).toBe(LotteryStatus.DRAFT);
    expect(res.body.ticketPriceMinor).toBe('2500');

    createdLotteryIds.push(res.body.id);

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: res.body.id, action: 'LOTTERY_CREATED' },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorUserId).toBe(adminUserId);
  });

  it('publishes a 2,000-number campaign in under 2 seconds (acceptance check)', async () => {
    // 1. Create a 2,000-number campaign in DRAFT
    const slug = `perf-2000-${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        slug,
        title: 'Performance 2000 Campaign',
        prizeDescription: 'Car or 1,000,000 ETB',
        ticketPriceMinor: 10000, // 100 ETB
        numberStart: 1,
        numberEnd: 2000, // 2,000 numbers
        maxNumbersPerPurchase: 20,
        holdMinutes: 10,
      });

    expect(createRes.status).toBe(201);
    const lotteryId = createRes.body.id;
    createdLotteryIds.push(lotteryId);

    // 2. Measure publish duration
    const startTime = Date.now();

    const publishRes = await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);

    const duration = Date.now() - startTime;

    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe(LotteryStatus.OPEN);

    // Acceptance criteria check: duration < 2000ms
    expect(duration).toBeLessThan(2000);

    // Verify exactly 2,000 numbers were generated with AVAILABLE status
    const count = await prisma.lotteryNumber.count({
      where: { lotteryId, status: NumberStatus.AVAILABLE },
    });
    expect(count).toBe(2000);
  });

  it('rejects invalid state transitions with 409 Conflict (acceptance check)', async () => {
    const slug = `state-test-${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        slug,
        title: 'State Transition Test',
        prizeDescription: 'Prize',
        ticketPriceMinor: 1000,
        numberStart: 1,
        numberEnd: 10,
      });

    const lotteryId = createRes.body.id;
    createdLotteryIds.push(lotteryId);

    // Cannot pause a DRAFT campaign
    const pauseRes = await request(app)
      .post(`/admin/lotteries/${lotteryId}/pause`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(pauseRes.status).toBe(409);
    expect(pauseRes.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // Cannot resume a DRAFT campaign
    const resumeRes = await request(app)
      .post(`/admin/lotteries/${lotteryId}/resume`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(resumeRes.status).toBe(409);

    // Publish to OPEN
    await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);

    // Cannot publish an already OPEN campaign
    const doublePublish = await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(doublePublish.status).toBe(409);

    // Pause to PAUSED
    const pauseOk = await request(app)
      .post(`/admin/lotteries/${lotteryId}/pause`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(pauseOk.status).toBe(200);
    expect(pauseOk.body.status).toBe(LotteryStatus.PAUSED);

    // Resume to OPEN
    const resumeOk = await request(app)
      .post(`/admin/lotteries/${lotteryId}/resume`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(resumeOk.status).toBe(200);
    expect(resumeOk.body.status).toBe(LotteryStatus.OPEN);

    // Close to CLOSED
    const closeOk = await request(app)
      .post(`/admin/lotteries/${lotteryId}/close`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(closeOk.status).toBe(200);
    expect(closeOk.body.status).toBe(LotteryStatus.CLOSED);

    // Cancel to CANCELLED
    const cancelOk = await request(app)
      .post(`/admin/lotteries/${lotteryId}/cancel`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({ reason: 'Emergency cancellation' });
    expect(cancelOk.status).toBe(200);
    expect(cancelOk.body.status).toBe(LotteryStatus.CANCELLED);

    // Archive to ARCHIVED
    const archiveOk = await request(app)
      .post(`/admin/lotteries/${lotteryId}/archive`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);
    expect(archiveOk.status).toBe(200);
    expect(archiveOk.body.status).toBe(LotteryStatus.ARCHIVED);
  });

  it('proves changing the price does not alter existing reservations (acceptance check)', async () => {
    // 1. Create and publish campaign with price = 1000
    const slug = `price-immut-${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        slug,
        title: 'Price Mutation Test',
        prizeDescription: 'Prize',
        ticketPriceMinor: 1000, // 10 ETB
        numberStart: 1,
        numberEnd: 20,
      });

    const lotteryId = createRes.body.id;
    createdLotteryIds.push(lotteryId);

    await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);

    // 2. Insert an existing reservation at price = 1000
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 5000000),
        role: UserRole.CUSTOMER,
      },
    });

    const reservation = await prisma.reservation.create({
      data: {
        publicReference: `REF-P-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId: user.id,
        lotteryId,
        status: ReservationStatus.AWAITING_PAYMENT,
        currency: 'ETB',
        unitPriceMinor: BigInt(1000), // snapshotted at 1000
        ticketCount: 2,
        totalAmountMinor: BigInt(2000),
      },
    });

    // 3. Admin updates campaign price to 5000 (50 ETB)
    const updateRes = await request(app)
      .patch(`/admin/lotteries/${lotteryId}`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({ ticketPriceMinor: 5000 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ticketPriceMinor).toBe('5000');

    // 4. Verify existing reservation is completely untouched
    const verifiedReservation = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(verifiedReservation?.unitPriceMinor).toBe(BigInt(1000));
    expect(verifiedReservation?.totalAmountMinor).toBe(BigInt(2000));

    // Cleanup user
    try { await prisma.reservation.delete({ where: { id: reservation.id } }); } catch { /* ignore */ }
    try { await prisma.user.delete({ where: { id: user.id } }); } catch { /* ignore */ }
  });

  it('enforces range mutation rules on published campaigns (FR-14)', async () => {
    // 1. Create and publish campaign with numbers 1 to 10
    const slug = `range-test-${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        slug,
        title: 'Range Adjustment Test',
        prizeDescription: 'Prize',
        ticketPriceMinor: 2000,
        numberStart: 1,
        numberEnd: 10,
      });

    const lotteryId = createRes.body.id;
    createdLotteryIds.push(lotteryId);

    await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);

    // 2. Expand range from 10 to 15 -> should automatically generate numbers 11..15
    const expandRes = await request(app)
      .patch(`/admin/lotteries/${lotteryId}`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({ numberEnd: 15 });

    expect(expandRes.status).toBe(200);
    expect(expandRes.body.numberEnd).toBe(15);

    const countAfterExpand = await prisma.lotteryNumber.count({ where: { lotteryId } });
    expect(countAfterExpand).toBe(15);

    // 3. Mark number 15 as HELD (simulating a hold in progress)
    await prisma.lotteryNumber.update({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 15 } },
      data: { status: NumberStatus.HELD },
    });

    // 4. Shrink range to 12 -> number 15 is HELD, so shrink MUST fail with 409
    const shrinkFailRes = await request(app)
      .patch(`/admin/lotteries/${lotteryId}`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({ numberEnd: 12 });

    expect(shrinkFailRes.status).toBe(409);
    expect(shrinkFailRes.body.error.code).toBe('CANNOT_SHRINK_HELD_NUMBERS');

    // Reset number 15 to AVAILABLE
    await prisma.lotteryNumber.update({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 15 } },
      data: { status: NumberStatus.AVAILABLE },
    });

    // 5. Shrink range to 12 when all removed numbers are AVAILABLE -> must succeed and remove 13, 14, 15
    const shrinkOkRes = await request(app)
      .patch(`/admin/lotteries/${lotteryId}`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({ numberEnd: 12 });

    expect(shrinkOkRes.status).toBe(200);
    expect(shrinkOkRes.body.numberEnd).toBe(12);

    const countAfterShrink = await prisma.lotteryNumber.count({ where: { lotteryId } });
    expect(countAfterShrink).toBe(12);
  });

  it('customer numbers summary endpoint returns compact ranges and 2s cache header', async () => {
    // Create a self-contained campaign with numbers 1..100
    const slug = `summary-test-${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post('/admin/lotteries')
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        slug,
        title: 'Summary Test Campaign',
        prizeDescription: '10,000 ETB Prize',
        ticketPriceMinor: 1000,
        numberStart: 1,
        numberEnd: 100,
      });

    const lotteryId = createRes.body.id;
    createdLotteryIds.push(lotteryId);

    await request(app)
      .post(`/admin/lotteries/${lotteryId}/publish`)
      .set('Cookie', adminSessionCookie)
      .set('x-csrf-token', adminCsrfToken);

    const res = await request(app)
      .get(`/lotteries/${lotteryId}/numbers/summary`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=2, s-maxage=2');
    expect(res.body.lotteryId).toBe(lotteryId);
    expect(res.body.totalNumbers).toBe(100);
    expect(res.body.counts.AVAILABLE).toBe(100);
    // 100 contiguous available numbers compress into 1 range: [1..100]
    expect(res.body.ranges).toHaveLength(1);
    expect(res.body.ranges[0]).toEqual({
      start: 1,
      end: 100,
      status: NumberStatus.AVAILABLE,
    });
  });
});

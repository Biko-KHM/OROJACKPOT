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
  signCustomerToken,
  generateCsrfToken,
} from '../src/modules/auth/crypto.js';
import {
  selectWinningIndexRejectionSampling,
  verifyDrawProof,
  serializeSnapshotEntries,
  sha256,
  HIREE_ALGORITHM_VERSION,
} from '@tg-lottery/shared';

describe('Provably Fair Winner Selection & Security Hardening (Section 10)', () => {
  let superadmin: { id: string; cookie: string; csrfToken: string };
  let standardAdmin: { id: string; cookie: string; csrfToken: string };
  let ordinaryCustomer: { id: string; token: string; telegramUserId: bigint };
  let otherCustomer: { id: string; token: string; telegramUserId: bigint };

  const createdLotteryIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createAdminWithRole(role: UserRole, prefix: string) {
    const email = `${prefix}_${crypto.randomUUID().slice(0, 6)}@hiree-audit.com`;
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 8000000),
        username: prefix,
        role,
        adminCredential: {
          create: {
            email,
            passwordHash: 'argon2id_dummy_hash_for_test',
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

  async function createCustomer(username: string) {
    const telegramUserId = BigInt(Math.floor(Math.random() * 1000000000) + 9000000);
    const user = await prisma.user.create({
      data: {
        telegramUserId,
        username,
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);

    const token = signCustomerToken({
      id: user.id,
      telegramUserId,
      role: UserRole.CUSTOMER,
    });
    return { id: user.id, token, telegramUserId };
  }

  beforeAll(async () => {
    superadmin = await createAdminWithRole(UserRole.SUPERADMIN, 'superadmin_sec');
    standardAdmin = await createAdminWithRole(UserRole.ADMIN, 'admin_sec');
    ordinaryCustomer = await createCustomer('player_alice');
    otherCustomer = await createCustomer('player_bob');
  });

  afterAll(async () => {
    for (const lotteryId of createdLotteryIds) {
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
        await prisma.drawCommitment.deleteMany({ where: { lotteryId } });
      } catch { /* ignore */ }
    }

    for (const userId of createdUserIds) {
      try {
        await prisma.adminCredential.deleteMany({ where: { userId } });
      } catch { /* ignore */ }
    }

    await prisma.$disconnect();
  });

  // Helper to construct a closed lottery with confirmed tickets
  async function setupClosedLotteryWithTickets() {
    const lottery = await prisma.lottery.create({
      data: {
        slug: `sec-lottery-${crypto.randomUUID()}`,
        title: 'Security Audit Campaign',
        prizeDescription: 'Grand Prize 250,000 ETB',
        status: LotteryStatus.CLOSED,
        currency: 'ETB',
        ticketPriceMinor: BigInt(10000),
        numberStart: 1,
        numberEnd: 50,
      },
    });
    createdLotteryIds.push(lottery.id);

    // Create tickets 1..5
    for (let i = 1; i <= 5; i++) {
      await prisma.lotteryNumber.create({
        data: {
          lotteryId: lottery.id,
          numberValue: i,
          status: i <= 3 ? NumberStatus.RESERVED : NumberStatus.AVAILABLE,
        },
      });
    }

    // Confirmed reservation for Alice (tickets 1, 2, 3)
    const resConfirmed = await prisma.reservation.create({
      data: {
        publicReference: `CONF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        lotteryId: lottery.id,
        userId: ordinaryCustomer.id,
        status: ReservationStatus.CONFIRMED,
        unitPriceMinor: BigInt(10000),
        ticketCount: 3,
        totalAmountMinor: BigInt(30000),
        currency: 'ETB',
      },
    });

    for (const num of [1, 2, 3]) {
      const numRecord = await prisma.lotteryNumber.findUnique({
        where: { lotteryId_numberValue: { lotteryId: lottery.id, numberValue: num } },
      });
      if (numRecord) {
        await prisma.numberClaim.create({
          data: {
            lotteryNumberId: numRecord.id,
            reservationId: resConfirmed.id,
            status: ClaimStatus.CONFIRMED,
          },
        });
        await prisma.reservationItem.create({
          data: {
            reservationId: resConfirmed.id,
            lotteryId: lottery.id,
            lotteryNumberId: numRecord.id,
            numberValueSnapshot: num,
            unitPriceMinor: BigInt(10000),
          },
        });
      }
    }

    // Pending unconfirmed reservation for Bob (ticket 4)
    const numRecord4 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId: lottery.id, numberValue: 4 } },
    });
    const resPending = await prisma.reservation.create({
      data: {
        publicReference: `PEND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        lotteryId: lottery.id,
        userId: otherCustomer.id,
        status: ReservationStatus.PAYMENT_SUBMITTED,
        unitPriceMinor: BigInt(10000),
        ticketCount: 1,
        totalAmountMinor: BigInt(10000),
        currency: 'ETB',
      },
    });
    if (numRecord4) {
      await prisma.reservationItem.create({
        data: {
          reservationId: resPending.id,
          lotteryId: lottery.id,
          lotteryNumberId: numRecord4.id,
          numberValueSnapshot: 4,
          unitPriceMinor: BigInt(10000),
        },
      });
    }

    return { lottery, resConfirmed, resPending };
  }

  // --------------------------------------------------------------------------
  // TEST 1: Unauthorized user attempting to initiate a draw
  // --------------------------------------------------------------------------
  it('Scenario 1: Rejects unauthorized user attempting to initiate draw (401)', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const res = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .send({ prizeLabel: 'Grand Prize' });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Campaign administrator attempting draw without superadmin role
  // --------------------------------------------------------------------------
  it('Scenario 2: Rejects standard ADMIN attempting draw operations (403 FORBIDDEN)', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    // Standard admin attempting draw commit
    const commitRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw-commit`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ prizeLabel: 'Grand Prize' });

    expect(commitRes.status).toBe(403);
    expect(commitRes.body.error?.code).toBe('FORBIDDEN');

    // Standard admin attempting direct draw
    const drawRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', standardAdmin.cookie)
      .set('x-csrf-token', standardAdmin.csrfToken)
      .send({ prizeLabel: 'Grand Prize' });

    expect(drawRes.status).toBe(403);
    expect(drawRes.body.error?.code).toBe('FORBIDDEN');
  });

  // --------------------------------------------------------------------------
  // TEST 3: User attempting to inject an ineligible ticket
  // --------------------------------------------------------------------------
  it('Scenario 3: Only strictly confirmed tickets participate in draw pool', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    // Prepare commitment
    const commitRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw-commit`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Grand Prize' });

    expect(commitRes.status).toBe(201);
    const commitment = commitRes.body.data;

    // Tickets 1, 2, 3 are confirmed. Ticket 4 is unconfirmed pending. Ticket 5 is available.
    // Eligible count MUST strictly equal 3!
    expect(commitment.eligibleCount).toBe(3);

    // Execute draw
    const execRes = await request(app)
      .post(`/admin/commitments/${commitment.id}/execute`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({});

    expect(execRes.status).toBe(200);
    const winningNumber = execRes.body.data.winningNumber;
    expect([1, 2, 3]).toContain(winningNumber);
    expect(winningNumber).not.toBe(4);
    expect(winningNumber).not.toBe(5);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Two simultaneous requests attempting to execute the same draw
  // --------------------------------------------------------------------------
  it('Scenario 4: Handles concurrent draw requests safely (race condition prevention)', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    // Prepare a commitment first
    const commitRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw-commit`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Concurrent Test Prize' });

    expect(commitRes.status).toBe(201);
    const commitmentId = commitRes.body.data.id;

    // Fire two simultaneous requests
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/admin/commitments/${commitmentId}/execute`)
        .set('Cookie', superadmin.cookie)
        .set('x-csrf-token', superadmin.csrfToken)
        .send({}),
      request(app)
        .post(`/admin/commitments/${commitmentId}/execute`)
        .set('Cookie', superadmin.cookie)
        .set('x-csrf-token', superadmin.csrfToken)
        .send({}),
    ]);

    const statuses = [res1.status, res2.status];
    // Exactly one must succeed (200) and the other must be rejected (409 conflict)
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Attempts to execute the draw twice
  // --------------------------------------------------------------------------
  it('Scenario 5: Rejects attempting to execute the draw twice for same prize (409 conflict)', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const draw1 = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Duplicate Draw Prize' });

    expect(draw1.status).toBe(200);

    const draw2 = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Duplicate Draw Prize' });

    expect(draw2.status).toBe(409);
    expect(draw2.body.error?.code).toBe('DRAW_ALREADY_EXISTS');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Attempts to modify a completed draw result (PostgreSQL trigger)
  // --------------------------------------------------------------------------
  it('Scenario 6: PostgreSQL trigger rejects UPDATE and DELETE on draws table', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const drawRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Immutability Guard Prize' });

    expect(drawRes.status).toBe(200);
    const drawId = drawRes.body.data.id;

    // Direct database UPDATE attempt must fail via DB trigger
    await expect(
      prisma.draw.update({
        where: { id: drawId },
        data: { winningNumber: 999 },
      }),
    ).rejects.toThrow();

    // Direct database DELETE attempt must fail via DB trigger
    await expect(
      prisma.draw.delete({
        where: { id: drawId },
      }),
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST 7: Attempts to manipulate a commitment
  // --------------------------------------------------------------------------
  it('Scenario 7: Catch commitment manipulation or revealed seed mismatch', async () => {
    const validSeed = crypto.randomBytes(32).toString('hex');
    const lotteryId = crypto.randomUUID();
    const snapshotHash = crypto.randomBytes(32).toString('hex');
    const validCommitment = crypto
      .createHash('sha256')
      .update(`${validSeed}:${lotteryId}:${snapshotHash}`)
      .digest('hex');

    // Tampered seed
    const tamperedSeed = crypto.randomBytes(32).toString('hex');

    const result = await verifyDrawProof({
      lotteryId,
      serverSecretSeed: tamperedSeed,
      serverSeedCommitment: validCommitment,
      snapshotHash,
      publicEntropy: 'entropy_123',
      eligibleCount: 100,
      winningIndex: 42,
    });

    expect(result.isValid).toBe(false);
    expect(result.commitmentMatches).toBe(false);
    expect(result.errorMessage).toContain('Commitment mismatch');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Attempts to modify the eligible-ticket snapshot
  // --------------------------------------------------------------------------
  it('Scenario 8: Catches attempts to tamper with the eligible-ticket snapshot', async () => {
    const validEntries = [
      { numberValue: 1, reservationRef: 'REF1', userIdHash: 'U1' },
      { numberValue: 2, reservationRef: 'REF2', userIdHash: 'U2' },
    ];
    const canonical = serializeSnapshotEntries(validEntries);
    const snapshotHash = await sha256(canonical);

    // Tampered ticket entries (added unauthorized ticket #3)
    const tamperedEntries = [
      ...validEntries,
      { numberValue: 3, reservationRef: 'REF_INJECTED', userIdHash: 'HACKER' },
    ];

    const result = await verifyDrawProof({
      lotteryId: 'lottery-test',
      serverSecretSeed: '00'.repeat(32),
      serverSeedCommitment: await sha256('00'.repeat(32)),
      snapshotHash,
      eligibleTickets: tamperedEntries,
      publicEntropy: 'pub',
      winningIndex: 0,
    });

    expect(result.isValid).toBe(false);
    expect(result.snapshotHashValid).toBe(false);
    expect(result.errorMessage).toContain('Snapshot integrity error');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Replaying an old draw request or using an already executed commitment
  // --------------------------------------------------------------------------
  it('Scenario 9: Rejects replaying already executed draw commitment', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const commitRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw-commit`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Replay Test Prize' });

    const commitmentId = commitRes.body.data.id;

    // First execution succeeds
    const exec1 = await request(app)
      .post(`/admin/commitments/${commitmentId}/execute`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({});
    expect(exec1.status).toBe(200);

    // Second replay attempt must be rejected
    const exec2 = await request(app)
      .post(`/admin/commitments/${commitmentId}/execute`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({});
    expect(exec2.status).toBe(409);
    expect(exec2.body.error?.code).toBe('INVALID_STATE');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Invalid or expired Telegram authentication payload
  // --------------------------------------------------------------------------
  it('Scenario 10: Rejects invalid or expired Telegram authentication payload', async () => {
    // Completely invalid HMAC signature
    const invalidAuth = await request(app)
      .post('/auth/telegram')
      .send({ initData: 'query_id=test&user=%7B%22id%22%3A12345%7D&auth_date=100000&hash=invalid_signature' });

    expect(invalidAuth.status).toBe(401);
    expect(invalidAuth.body.error?.code).toBe('INVALID_SIGNATURE');

    // Missing initData
    const emptyAuth = await request(app).post('/auth/telegram').send({});
    expect(emptyAuth.status).toBe(400);
  });

  // --------------------------------------------------------------------------
  // TEST 11: Attempts to access another user's ticket records (IDOR protection)
  // --------------------------------------------------------------------------
  it('Scenario 11: Prevents IDOR access to another user tickets', async () => {
    const { resConfirmed } = await setupClosedLotteryWithTickets();

    // Bob attempts to query Alice's reservation details
    const idorRes = await request(app)
      .get(`/reservations/${resConfirmed.id}`)
      .set('Authorization', `Bearer ${otherCustomer.token}`);

    expect([403, 404]).toContain(idorRes.status);
    if (idorRes.status === 403) {
      expect(idorRes.body.error?.code).toBe('FORBIDDEN');
    }
  });

  // --------------------------------------------------------------------------
  // TEST 12: Attempts to exploit XSS in user-controlled text
  // --------------------------------------------------------------------------
  it('Scenario 12: Neutralizes XSS in prize labels and inputs', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const xssPayload = '<script>alert("XSS")</script>';
    const res = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: xssPayload });

    // Zod schema sanitization or acceptance as plain string (never executed as HTML)
    if (res.status === 200) {
      expect(res.body.data.prizeLabel).toBe(xssPayload);
    } else {
      expect(res.status).toBe(400);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 13: SQL injection attempts against draw-related APIs
  // --------------------------------------------------------------------------
  it('Scenario 13: Rejects SQL injection payloads via UUID validation', async () => {
    const sqliPayload = "'; DROP TABLE draws; --";

    const res = await request(app)
      .get(`/draws/${encodeURIComponent(sqliPayload)}/verify`);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ID');
  });

  // --------------------------------------------------------------------------
  // TEST 14: Verification of published draw proofs
  // --------------------------------------------------------------------------
  it('Scenario 14: Published draw proof is 100% independently verifiable by public', async () => {
    const { lottery } = await setupClosedLotteryWithTickets();

    const drawRes = await request(app)
      .post(`/admin/lotteries/${lottery.id}/draw`)
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({ prizeLabel: 'Public Verification Prize' });

    expect(drawRes.status).toBe(200);
    const draw = drawRes.body.data;

    // Fetch public verification data without any authentication
    const publicVerifyRes = await request(app).get(`/draws/${draw.id}/verify`);
    expect(publicVerifyRes.status).toBe(200);
    const vData = publicVerifyRes.body.data;

    expect(vData.isVerified).toBe(true);
    expect(vData.algorithmVersion).toBe(HIREE_ALGORITHM_VERSION);
    expect(vData.winningNumber).toBe(draw.winningNumber);

    // Run client-side verifier
    const independentResult = await verifyDrawProof({
      algorithmVersion: vData.algorithmVersion,
      lotteryId: vData.lotteryId,
      drawOrder: vData.drawOrder,
      serverSeedCommitment: vData.serverSeedCommitment,
      serverSeedRevealed: vData.serverSeedRevealed,
      publicEntropy: vData.publicEntropy,
      snapshotHash: vData.snapshotHash,
      eligibleCount: vData.eligibleCount,
      winningIndex: vData.winningIndex,
    });

    expect(independentResult.isValid).toBe(true);
    expect(independentResult.calculatedWinningIndex).toBe(vData.winningIndex);
  });

  // --------------------------------------------------------------------------
  // TEST 15: Statistical and boundary testing of rejection sampling algorithm
  // --------------------------------------------------------------------------
  it('Scenario 15: Statistical uniformity & zero modulo bias across candidate pool', async () => {
    const poolSize = 7;
    const iterations = 7000;
    const counts = new Array(poolSize).fill(0);
    const secretSeed = crypto.randomBytes(32).toString('hex');

    for (let i = 0; i < iterations; i++) {
      const { index } = await selectWinningIndexRejectionSampling(
        secretSeed,
        `statistical-test-context:${i}`,
        poolSize,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(poolSize);
      counts[index]++;
    }

    // Expected count per bucket is 1000.
    // In uniform distribution with N=7000, each bucket should fall comfortably within 850..1150 (Chi-square acceptable)
    for (let i = 0; i < poolSize; i++) {
      expect(counts[i]).toBeGreaterThan(800);
      expect(counts[i]).toBeLessThan(1200);
    }

    // Boundary test: pool size = 1 returns index 0
    const single = await selectWinningIndexRejectionSampling(secretSeed, 'single', 1);
    expect(single.index).toBe(0);

    // Boundary test: pool size = 2000 (HIREE max campaign size)
    const maxPool = await selectWinningIndexRejectionSampling(secretSeed, 'max', 2000);
    expect(maxPool.index).toBeGreaterThanOrEqual(0);
    expect(maxPool.index).toBeLessThan(2000);
  });
});

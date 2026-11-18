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
  PaymentStatus,
  ClaimStatus,
} from '@prisma/client';
import {
  signAdminSessionToken,
  signCustomerToken,
  generateCsrfToken,
} from '../src/modules/auth/crypto.js';
import { writeStorageFile } from '../src/modules/storage/service.js';

describe('Step 7: Admin Review Module', () => {
  let lotteryId: string;
  let adminA: { id: string; cookie: string; csrfToken: string };
  let adminB: { id: string; cookie: string; csrfToken: string };
  const createdLotteryIds: string[] = [];
  const createdUserIds: string[] = [];

  // Minimal valid 1x1 JPEG buffer
  const validJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9,
  ]);

  // Helper to create an admin
  async function createAdminUser(prefix: string) {
    const email = `${prefix}_${crypto.randomUUID().slice(0, 6)}@test.com`;
    const adminUser = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 5000000),
        username: prefix,
        role: UserRole.ADMIN,
        adminCredential: {
          create: {
            email,
            passwordHash: 'dummy_hash',
          },
        },
      },
    });
    createdUserIds.push(adminUser.id);
    const csrfToken = generateCsrfToken();
    const sessionToken = signAdminSessionToken(
      { id: adminUser.id, email, role: adminUser.role },
      csrfToken,
    );
    const cookie = `admin_session=${sessionToken}`;
    return { id: adminUser.id, cookie, csrfToken };
  }

  // Helper to create a superadmin
  async function createSuperAdminUser(prefix: string) {
    const email = `${prefix}_${crypto.randomUUID().slice(0, 6)}@test.com`;
    const superUser = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 5000000),
        username: prefix,
        role: UserRole.SUPERADMIN,
        adminCredential: {
          create: {
            email,
            passwordHash: 'dummy_hash',
          },
        },
      },
    });
    createdUserIds.push(superUser.id);
    const csrfToken = generateCsrfToken();
    const sessionToken = signAdminSessionToken(
      { id: superUser.id, email, role: superUser.role },
      csrfToken,
    );
    const cookie = `admin_session=${sessionToken}`;
    return { id: superUser.id, cookie, csrfToken, email };
  }

  // Helper to create a customer
  async function createCustomer(prefix: string) {
    const user = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 6000000),
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

  // Helper to set up a reservation in PENDING_REVIEW with a SUBMITTED payment submission
  async function setupPendingSubmission(params: {
    customerPrefix: string;
    numberValues: number[];
    unitPriceMinor?: bigint;
  }) {
    const customer = await createCustomer(params.customerPrefix);
    const unitPrice = params.unitPriceMinor || 2500n;

    // 1. Create reservation
    const res = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        numbers: params.numberValues,
        idempotencyKey: `setup-${crypto.randomUUID()}`,
      });
    expect(res.status).toBe(201);
    const reservation = res.body;

    // 2. Put file in storage
    const storageKey = `proofs/${customer.id}/receipt-${crypto.randomUUID().slice(0, 8)}.jpg`;
    await writeStorageFile(storageKey, validJpeg);

    // 3. Submit payment proof
    const submitRes = await request(app)
      .post(`/reservations/${reservation.id}/payment-submissions`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        storageKey,
        originalFilename: 'receipt.jpg',
        claimedAmountMinor: Number(unitPrice) * params.numberValues.length,
        paymentReference: `REF-${crypto.randomUUID().slice(0, 8)}`,
      });
    expect(submitRes.status).toBe(201);

    return {
      customer,
      reservation,
      submission: submitRes.body,
    };
  }

  beforeAll(async () => {
    // Create an OPEN campaign with 50 numbers (1 to 50)
    const lottery = await prisma.lottery.create({
      data: {
        slug: `admin-review-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Admin Review Campaign',
        prizeDescription: '60,000 ETB Prize',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: 2500n, // 25 ETB
        numberStart: 1,
        numberEnd: 50,
        maxNumbersPerPurchase: 10,
        holdMinutes: 10,
      },
    });
    lotteryId = lottery.id;
    createdLotteryIds.push(lottery.id);

    const numbersData = Array.from({ length: 50 }, (_, i) => ({
      lotteryId: lottery.id,
      numberValue: i + 1,
      status: NumberStatus.AVAILABLE,
    }));
    await prisma.lotteryNumber.createMany({ data: numbersData });

    adminA = await createAdminUser('admin_reviewer_a');
    adminB = await createAdminUser('admin_reviewer_b');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Happy Path: Generates 5-minute evidence URL, logs audit row, and approves submission', async () => {
    const { submission, reservation } = await setupPendingSubmission({
      customerPrefix: 'cust_approve',
      numberValues: [1],
    });

    // Step A: Admin requests evidence URL
    const urlRes = await request(app)
      .get(`/admin/payment-submissions/${submission.id}/evidence-url`)
      .set('Cookie', adminA.cookie);

    expect(urlRes.status).toBe(200);
    expect(urlRes.body.downloadUrl).toBeDefined();
    expect(urlRes.body.expiresInSeconds).toBe(300);

    // Verify audit log has EVIDENCE_VIEWED
    const auditView = await prisma.auditLog.findFirst({
      where: {
        entityId: submission.id,
        action: 'EVIDENCE_VIEWED',
      },
    });
    expect(auditView).not.toBeNull();
    expect(auditView!.actorUserId).toBe(adminA.id);

    // Step B: Admin approves submission
    const approveRes = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({
        comparedWithBankRecord: true,
        note: 'Verified against bank statement #1234',
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.decision).toBe('APPROVED');
    expect(approveRes.body.status).toBe('CONFIRMED');

    // Verify database state: reservation CONFIRMED, number RESERVED, submission APPROVED
    const dbReservation = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(dbReservation!.status).toBe(ReservationStatus.CONFIRMED);
    expect(dbReservation!.reviewedBy).toBe(adminA.id);

    const dbNumber = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 1 } },
    });
    expect(dbNumber!.status).toBe(NumberStatus.RESERVED);

    const dbSubmission = await prisma.paymentSubmission.findUnique({
      where: { id: submission.id },
      include: { reviews: true },
    });
    expect(dbSubmission!.status).toBe(PaymentStatus.APPROVED);
    expect(dbSubmission!.reviews).toHaveLength(1);
    expect(dbSubmission!.reviews[0].decision).toBe('APPROVED');
    expect(dbSubmission!.reviews[0].comparedWithBankRecord).toBe(true);

    // Verify audit log and outbox events
    const auditApprove = await prisma.auditLog.findFirst({
      where: { entityId: submission.id, action: 'PAYMENT_APPROVED' },
    });
    expect(auditApprove).not.toBeNull();

    const outboxTickets = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'CUSTOMER_NOTIFICATION',
        payload: { path: ['reservationId'], equals: reservation.id },
      },
    });
    expect(outboxTickets).not.toBeNull();
  });

  it('2. Mandatory bank-record confirmation flag: returns 400 when comparedWithBankRecord is false or missing', async () => {
    const { submission } = await setupPendingSubmission({
      customerPrefix: 'cust_bank_flag',
      numberValues: [2],
    });

    const res = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({
        comparedWithBankRecord: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('3. Dual approval: amounts requiring dual approval require two distinct admins', async () => {
    // Update lottery ticket price to 60,000 minor (above 50,000 threshold)
    const { submission } = await setupPendingSubmission({
      customerPrefix: 'cust_dual_approval',
      numberValues: [3],
    });

    // Manually increase reservation amount above threshold for dual approval test
    await prisma.reservation.update({
      where: { id: submission.reservationId },
      data: { unitPriceMinor: 60_000n, totalAmountMinor: 60_000n },
    });

    // Step A: Admin A approves (records FIRST_APPROVAL)
    const firstRes = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({ comparedWithBankRecord: true, note: 'Admin A initial review' });

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.decision).toBe('FIRST_APPROVAL');
    expect(firstRes.body.status).toBe('PENDING_SECOND_APPROVAL');

    // Step B: Admin A attempts second approval (MUST FAIL with 409 DUAL_APPROVAL_SAME_ADMIN)
    const sameAdminRes = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({ comparedWithBankRecord: true });

    expect(sameAdminRes.status).toBe(409);
    expect(sameAdminRes.body.error.code).toBe('DUAL_APPROVAL_SAME_ADMIN');

    // Step C: Admin B (different admin) approves -> confirmed
    const secondRes = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminB.cookie)
      .set('x-csrf-token', adminB.csrfToken)
      .send({ comparedWithBankRecord: true, note: 'Admin B second approval' });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.decision).toBe('APPROVED');
    expect(secondRes.body.status).toBe('CONFIRMED');

    // Verify 2 immutable review rows exist in DB
    const reviews = await prisma.paymentReview.findMany({
      where: { paymentSubmissionId: submission.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(reviews).toHaveLength(2);
    expect(reviews[0].decision).toBe('FIRST_APPROVAL');
    expect(reviews[1].decision).toBe('APPROVED');
  });

  it('4. Double-click approve: only one approval commits, second returns 409 Conflict', async () => {
    const { submission } = await setupPendingSubmission({
      customerPrefix: 'cust_double_click',
      numberValues: [4],
    });

    // Concurrently fire two approve requests from the same admin
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/admin/payment-submissions/${submission.id}/approve`)
        .set('Cookie', adminA.cookie)
        .set('x-csrf-token', adminA.csrfToken)
        .send({ comparedWithBankRecord: true }),
      request(app)
        .post(`/admin/payment-submissions/${submission.id}/approve`)
        .set('Cookie', adminA.cookie)
        .set('x-csrf-token', adminA.csrfToken)
        .send({ comparedWithBankRecord: true }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Exactly one APPROVED row in database
    const dbSubmission = await prisma.paymentSubmission.findUnique({
      where: { id: submission.id },
      include: { reviews: { where: { decision: 'APPROVED' } } },
    });
    expect(dbSubmission!.reviews).toHaveLength(1);
  });

  it('5. Two admins at once: concurrent approve requests result in exactly one winner and one 409', async () => {
    const { submission } = await setupPendingSubmission({
      customerPrefix: 'cust_two_admins',
      numberValues: [5],
    });

    // Concurrently fire approve requests from Admin A and Admin B
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/admin/payment-submissions/${submission.id}/approve`)
        .set('Cookie', adminA.cookie)
        .set('x-csrf-token', adminA.csrfToken)
        .send({ comparedWithBankRecord: true }),
      request(app)
        .post(`/admin/payment-submissions/${submission.id}/approve`)
        .set('Cookie', adminB.cookie)
        .set('x-csrf-token', adminB.csrfToken)
        .send({ comparedWithBankRecord: true }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Verify submission is APPROVED
    const dbSub = await prisma.paymentSubmission.findUnique({
      where: { id: submission.id },
      include: { reviews: true },
    });
    expect(dbSub!.status).toBe(PaymentStatus.APPROVED);
    expect(dbSub!.reviews).toHaveLength(1);
  });

  it('6. Reject on a stale page after numbers were re-sold: never touches another buyer active claims', async () => {
    // Buyer 1 submits payment for number 10
    const { submission: sub1, reservation: res1 } = await setupPendingSubmission({
      customerPrefix: 'cust_stale_1',
      numberValues: [10],
    });

    // Suppose claims for res1 were released (e.g. through administrative action)
    await prisma.numberClaim.updateMany({
      where: { reservationId: res1.id },
      data: { status: ClaimStatus.RELEASED },
    });
    await prisma.lotteryNumber.update({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 10 } },
      data: { status: NumberStatus.AVAILABLE },
    });

    // Buyer 2 now holds number 10 under a fresh active reservation
    const buyer2 = await createCustomer('buyer2_fresh');
    const res2 = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer2.token}`)
      .send({
        numbers: [10],
        idempotencyKey: `fresh-buy-${crypto.randomUUID()}`,
      });
    expect(res2.status).toBe(201);

    // Number 10 is HELD by Buyer 2 with an ACTIVE claim
    let num10 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 10 } },
    });
    expect(num10!.status).toBe(NumberStatus.HELD);

    // Admin rejects Buyer 1's stale submission
    const rejectRes = await request(app)
      .post(`/admin/payment-submissions/${sub1.id}/reject`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({
        reason: 'Payment reference could not be verified on bank portal',
      });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('REJECTED');

    // CRITICAL: Number 10 MUST REMAIN HELD and Buyer 2's claim must remain ACTIVE!
    num10 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 10 } },
    });
    expect(num10!.status).toBe(NumberStatus.HELD);

    const buyer2Claim = await prisma.numberClaim.findFirst({
      where: { reservationId: res2.body.id },
    });
    expect(buyer2Claim!.status).toBe(ClaimStatus.ACTIVE);
  });

  it('7. Approving a reservation whose claims are no longer active is rejected (returns 409 CLAIMS_INACTIVE)', async () => {
    const { submission, reservation } = await setupPendingSubmission({
      customerPrefix: 'cust_inactive_claims',
      numberValues: [11],
    });

    // Manually release the claims (e.g. simulated race with hold expiry)
    await prisma.numberClaim.updateMany({
      where: { reservationId: reservation.id },
      data: { status: ClaimStatus.RELEASED },
    });

    // Admin attempts to approve
    const approveRes = await request(app)
      .post(`/admin/payment-submissions/${submission.id}/approve`)
      .set('Cookie', adminA.cookie)
      .set('x-csrf-token', adminA.csrfToken)
      .send({ comparedWithBankRecord: true });

    expect(approveRes.status).toBe(409);
    expect(approveRes.body.error.code).toBe('CLAIMS_INACTIVE');

    // Number 11 must NOT be marked RESERVED
    const num11 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 11 } },
    });
    expect(num11!.status).not.toBe(NumberStatus.RESERVED);
  });

  it('8. Superadmin creation is supported via POST /admin/users, while invalid roles are rejected', async () => {
    const superadmin = await createSuperAdminUser('super_tester');

    // 1. Invalid role is rejected
    const invalidRes = await request(app)
      .post('/admin/users')
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({
        email: `illegal_role_${crypto.randomUUID().slice(0, 6)}@test.com`,
        password: 'TemporaryPass123!',
        role: 'CUSTOMER',
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe('INVALID_ROLE');

    // 2. Superadmin creation succeeds
    const superEmail = `new_super_${crypto.randomUUID().slice(0, 6)}@test.com`;
    const superRes = await request(app)
      .post('/admin/users')
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({
        email: superEmail,
        password: 'SuperPassword123!',
        role: 'SUPERADMIN',
        firstName: 'Executive',
        lastName: 'Leader',
      });

    expect(superRes.status).toBe(201);
    expect(superRes.body.role).toBe('SUPERADMIN');
    expect(superRes.body.email).toBe(superEmail);
  });

  it('9. Creating an ADMIN operator sets mustChangePassword: true and generates 2FA secret', async () => {
    const superadmin = await createSuperAdminUser('super_creator');
    const operatorEmail = `new_operator_${crypto.randomUUID().slice(0, 6)}@test.com`;

    const res = await request(app)
      .post('/admin/users')
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({
        email: operatorEmail,
        password: 'InitialTempPassword123!',
        role: 'ADMIN',
        firstName: 'Dawit',
        lastName: 'Bekele',
      });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('ADMIN');
    expect(res.body.totpSecret).toBeDefined();
    expect(res.body.mustChangePassword).toBe(true);

    createdUserIds.push(res.body.id);

    // Verify GET /admin/users also reflects mustChangePassword: true
    const listRes = await request(app)
      .get('/admin/users')
      .set('Cookie', superadmin.cookie);

    expect(listRes.status).toBe(200);
    const createdInList = listRes.body.find((u: { id: string }) => u.id === res.body.id);
    expect(createdInList).toBeDefined();
    expect(createdInList.mustChangePassword).toBe(true);
  });

  it('10. Newly created admin can change password via POST /admin/auth/change-password, clearing mustChangePassword', async () => {
    const superadmin = await createSuperAdminUser('super_flow');
    const operatorEmail = `flow_op_${crypto.randomUUID().slice(0, 6)}@test.com`;
    const initialTempPassword = 'InitialTempPassword123!';

    const createRes = await request(app)
      .post('/admin/users')
      .set('Cookie', superadmin.cookie)
      .set('x-csrf-token', superadmin.csrfToken)
      .send({
        email: operatorEmail,
        password: initialTempPassword,
        role: 'ADMIN',
      });

    expect(createRes.status).toBe(201);
    createdUserIds.push(createRes.body.id);

    // Create session token for this new operator
    const csrfToken = generateCsrfToken();
    const sessionToken = signAdminSessionToken(
      { id: createRes.body.id, email: operatorEmail, role: UserRole.ADMIN },
      csrfToken,
    );
    const operatorCookie = `admin_session=${sessionToken}`;

    // Verify /admin/me indicates mustChangePassword: true
    const meRes = await request(app)
      .get('/admin/me')
      .set('Cookie', operatorCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.admin.mustChangePassword).toBe(true);

    // Update password
    const changePassRes = await request(app)
      .post('/admin/auth/change-password')
      .set('Cookie', operatorCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        currentPassword: initialTempPassword,
        newPassword: 'BrandNewSecurePassword456!',
      });

    expect(changePassRes.status).toBe(200);
    expect(changePassRes.body.success).toBe(true);

    // Verify /admin/me now shows mustChangePassword: false
    const meUpdatedRes = await request(app)
      .get('/admin/me')
      .set('Cookie', operatorCookie);

    expect(meUpdatedRes.status).toBe(200);
    expect(meUpdatedRes.body.admin.mustChangePassword).toBe(false);
  });
});

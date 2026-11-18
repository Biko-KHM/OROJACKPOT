import '../src/config/index.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { UserRole, LotteryStatus, NumberStatus, ReservationStatus, PaymentStatus } from '@prisma/client';
import { signCustomerToken } from '../src/modules/auth/crypto.js';
import { writeStorageFile } from '../src/modules/storage/service.js';

describe('Step 6: Payment Upload & Submission Module', () => {
  let lotteryId: string;
  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  const createdLotteryIds: string[] = [];

  // Minimal valid 1x1 JPEG buffer with SOI, APP0, and EOI
  const validJpegBuffer = Buffer.from([
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

  // Helper to create a customer
  async function createCustomer(prefix: string) {
    const telegramUserId = BigInt(Math.floor(Math.random() * 1000000000) + 9000000);
    const user = await prisma.user.create({
      data: {
        telegramUserId,
        username: `${prefix}_${crypto.randomUUID().slice(0, 6)}`,
        role: UserRole.CUSTOMER,
      },
    });
    const token = signCustomerToken({
      id: user.id,
      telegramUserId: user.telegramUserId.toString(),
      role: user.role,
    });
    return { id: user.id, token };
  }

  // Helper to create a reservation for tests
  async function makeReservation(user: { id: string; token: string }, numbers: number[]) {
    const res = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        numbers,
        idempotencyKey: `pay-test-${crypto.randomUUID()}`,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    // Create an OPEN campaign with 50 numbers (1 to 50)
    const lottery = await prisma.lottery.create({
      data: {
        slug: `payment-camp-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Payment Test Campaign',
        prizeDescription: '75,000 ETB Cash',
        status: LotteryStatus.OPEN,
        currency: 'ETB',
        ticketPriceMinor: 10000n, // 100 ETB
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

    userA = await createCustomer('pay_user_a');
    userB = await createCustomer('pay_user_b');
  });

  afterAll(async () => {
    for (const id of createdLotteryIds) {
      try { await prisma.paymentSubmission.deleteMany({ where: { reservation: { lotteryId: id } } }); } catch { /* ignore */ }
      try { await prisma.reservationItem.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.numberClaim.deleteMany({ where: { reservation: { lotteryId: id } } }); } catch { /* ignore */ }
      try { await prisma.reservation.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lotteryNumber.deleteMany({ where: { lotteryId: id } }); } catch { /* ignore */ }
      try { await prisma.lottery.deleteMany({ where: { id } }); } catch { /* ignore */ }
    }
    await prisma.$disconnect();
  });

  it('1. Happy Path: Obtains upload URL, uploads valid JPEG, and submits payment proof', async () => {
    // Step A: Create reservation for number 1
    const reservation = await makeReservation(userA, [1]);
    expect(reservation.status).toBe('AWAITING_PAYMENT');

    // Step B: Request upload URL
    const uploadInitRes = await request(app)
      .post('/uploads/payment-proof')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ mimeType: 'image/jpeg', originalFilename: 'receipt.jpg' });

    expect(uploadInitRes.status).toBe(200);
    expect(uploadInitRes.body.uploadUrl).toBeDefined();
    expect(uploadInitRes.body.storageKey).toBeDefined();
    expect(uploadInitRes.body.expiresInSeconds).toBe(300);

    const { uploadUrl, storageKey } = uploadInitRes.body;

    // Step C: Upload binary buffer directly via signed URL
    const uploadRes = await request(app)
      .put(uploadUrl)
      .set('Content-Type', 'image/jpeg')
      .send(validJpegBuffer);

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.success).toBe(true);

    // Step D: Submit payment proof
    const submitRes = await request(app)
      .post(`/reservations/${reservation.id}/payment-submissions`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        storageKey,
        originalFilename: 'receipt.jpg',
        claimedAmountMinor: 10000,
        paymentReference: 'CBE-FT-123456789',
      });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.status).toBe(PaymentStatus.SUBMITTED);
    expect(submitRes.body.mimeType).toBe('image/jpeg');
    expect(submitRes.body.paymentReference).toContain('CBE-FT-123456789');
    expect(submitRes.body.fileSha256).toBeDefined();

    // Verify reservation status changed to PENDING_REVIEW
    const updatedReservation = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(updatedReservation!.status).toBe(ReservationStatus.PENDING_REVIEW);
    expect(updatedReservation!.submittedAt).not.toBeNull();

    // Verify lottery number status changed to PENDING_REVIEW
    const num1 = await prisma.lotteryNumber.findUnique({
      where: { lotteryId_numberValue: { lotteryId, numberValue: 1 } },
    });
    expect(num1!.status).toBe(NumberStatus.PENDING_REVIEW);

    // Verify outbox notification written
    const outbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'ADMIN_NOTIFICATION',
        payload: { path: ['reservationId'], equals: reservation.id },
      },
    });
    expect(outbox).not.toBeNull();
  });

  it('2. Acceptance: Evidence is never publicly reachable without a valid unexpired signature', async () => {
    // Attempt to access storage endpoint with no token
    const resNoToken = await request(app).get('/uploads/storage');
    expect(resNoToken.status).toBe(404);

    // Attempt to access storage endpoint with malformed/forged token
    const resForged = await request(app).get('/uploads/storage/forged.signature');
    expect(resForged.status).toBe(403);

    // Attempt to access with an upload-action token as a download request
    const uploadInitRes = await request(app)
      .post('/uploads/payment-proof')
      .set('Authorization', `Bearer ${userA.token}`);
    const uploadUrl = uploadInitRes.body.uploadUrl;

    const resWrongAction = await request(app).get(uploadUrl);
    expect(resWrongAction.status).toBe(403);
  });

  it('3. Negative Test: Wrong owner cannot submit payment evidence for another user reservation (returns 403)', async () => {
    // User A creates reservation for number 2
    const resA = await makeReservation(userA, [2]);

    // Store a valid file
    const fakeKey = `proofs/${userB.id}/test-key-wrong-owner.jpg`;
    await writeStorageFile(fakeKey, validJpegBuffer);

    // User B attempts to submit payment evidence for User A's reservation
    const submitRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({
        storageKey: fakeKey,
        originalFilename: 'test.jpg',
      });

    expect(submitRes.status).toBe(403);
    expect(submitRes.body.error.code).toBe('FORBIDDEN');
  });

  it('4. Negative Test: Submitting for an expired hold is rejected (returns 409 HOLD_EXPIRED)', async () => {
    // User A creates reservation for number 3
    const resA = await makeReservation(userA, [3]);

    // Fast-forward hold expiry to 5 minutes in the past
    await prisma.reservation.update({
      where: { id: resA.id },
      data: { holdExpiresAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    const key = `proofs/${userA.id}/expired-proof.jpg`;
    await writeStorageFile(key, validJpegBuffer);

    const submitRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        storageKey: key,
        originalFilename: 'proof.jpg',
      });

    expect(submitRes.status).toBe(409);
    expect(submitRes.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('5. Negative Test: Wrong file type (SVG/HTML pretending to be image) rejected by magic bytes (returns 400)', async () => {
    const buyer5 = await createCustomer('buyer5');
    const resA = await makeReservation(buyer5, [4]);

    // Create an SVG file pretending to be image/jpeg
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const key = `proofs/${buyer5.id}/fake-svg.jpg`;
    await writeStorageFile(key, svgBuffer);

    const submitRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer5.token}`)
      .send({
        storageKey: key,
        originalFilename: 'fake-svg.jpg',
      });

    expect(submitRes.status).toBe(400);
    expect(submitRes.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('6. Negative Test: Oversized file exceeding 5 MB is rejected (returns 413 FILE_TOO_LARGE)', async () => {
    const buyer6 = await createCustomer('buyer6');
    const resA = await makeReservation(buyer6, [5]);

    // Create a 5.2 MB buffer starting with valid JPEG magic bytes
    const largeBuffer = Buffer.alloc(5.2 * 1024 * 1024);
    largeBuffer[0] = 0xff;
    largeBuffer[1] = 0xd8;
    largeBuffer[2] = 0xff;

    const key = `proofs/${buyer6.id}/oversized.jpg`;
    await writeStorageFile(key, largeBuffer);

    const submitRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer6.token}`)
      .send({
        storageKey: key,
        originalFilename: 'oversized.jpg',
      });

    expect(submitRes.status).toBe(413);
    expect(submitRes.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('7. Negative Test: Duplicate payment submission on the same reservation is rejected (returns 409)', async () => {
    const buyer7 = await createCustomer('buyer7');
    const resA = await makeReservation(buyer7, [6]);

    const key = `proofs/${buyer7.id}/valid-for-dup.jpg`;
    await writeStorageFile(key, validJpegBuffer);

    // First submission succeeds
    const firstRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer7.token}`)
      .send({
        storageKey: key,
        originalFilename: 'proof.jpg',
      });
    expect(firstRes.status).toBe(201);

    // Second submission on the same reservation must be rejected
    const secondRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer7.token}`)
      .send({
        storageKey: key,
        originalFilename: 'proof-retry.jpg',
      });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe('INVALID_STATUS'); // Reservation is now PENDING_REVIEW
  });

  it('8. EXIF stripping: APP1 metadata segments are stripped and SHA-256 computed on sanitized bytes', async () => {
    const buyer8 = await createCustomer('buyer8');
    const resA = await makeReservation(buyer8, [7]);

    // Construct a JPEG containing an APP1 EXIF segment (0xFFE1) with GPS coordinates metadata
    const exifPayload = Buffer.from('Exif\0\0GPS_LAT_LONG_SECRET_METADATA');
    const segmentLength = exifPayload.length + 2;
    const app1Segment = Buffer.alloc(2 + segmentLength);
    app1Segment[0] = 0xff;
    app1Segment[1] = 0xe1;
    app1Segment.writeUInt16BE(segmentLength, 2);
    exifPayload.copy(app1Segment, 4);

    // Insert APP1 segment right after SOI (FF D8)
    const jpegWithExif = Buffer.concat([
      validJpegBuffer.subarray(0, 2), // SOI
      app1Segment,
      validJpegBuffer.subarray(2), // rest of jpeg
    ]);

    const key = `proofs/${buyer8.id}/with-exif.jpg`;
    await writeStorageFile(key, jpegWithExif);

    const submitRes = await request(app)
      .post(`/reservations/${resA.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer8.token}`)
      .send({
        storageKey: key,
        originalFilename: 'photo-with-exif.jpg',
      });

    expect(submitRes.status).toBe(201);

    // Verify stored file size is smaller (EXIF removed)
    const storedBuffer = await prisma.paymentSubmission.findUnique({
      where: { id: submitRes.body.id },
    });

    expect(Number(storedBuffer!.fileSizeBytes)).toBeLessThan(jpegWithExif.length);
    expect(submitRes.body.fileSha256).toBeDefined();
  });

  it('9. Web Mini App presign endpoint: handles POST /uploads/presign with contentType payload', async () => {
    const res = await request(app)
      .post('/uploads/presign')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toBeDefined();
    expect(res.body.storageKey).toBeDefined();
    expect(res.body.maxSizeBytes).toBe(5 * 1024 * 1024);
  });
});

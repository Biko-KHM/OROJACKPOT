import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/index.js';
import { config } from '../src/config/index.js';
import {
  setTelegramClient,
  resetTelegramClient,
  ITelegramClient,
  TelegramNetworkError,
  TelegramRateLimitError,
} from '../src/modules/telegram/client.js';
import { updateDeduplicator } from '../src/modules/telegram/service.js';
import { updatePlatformSettingsState } from '../src/modules/platform/settings.js';
import { processOutboxBatch } from '../src/worker/outboxProcessor.js';
import { reconcileChannelPosts } from '../src/worker/reconcileChannel.js';
import {
  signAdminSessionToken,
  signCustomerToken,
  generateCsrfToken,
} from '../src/modules/auth/crypto.js';
import {
  LotteryStatus,
  NumberStatus,
  UserRole,
  PaymentStatus,
  ReservationStatus,
} from '@prisma/client';

interface MockCallbackOptions {
  text?: string;
  show_alert?: boolean;
  [key: string]: unknown;
}

class MockTelegramClient implements ITelegramClient {
  public sentMessages: Array<{ chatId: string; text: string; options?: unknown }> = [];
  public editedMessages: Array<{ chatId: string; messageId: number; text: string; options?: unknown }> = [];
  public answeredCallbacks: Array<{ id: string; options?: MockCallbackOptions }> = [];

  public shouldFailNetwork = false;
  public rateLimitRetryAfter: number | null = null;
  private messageCounter = 1000;

  async sendMessage(chatId: string | number | bigint, text: string, options?: unknown) {
    if (this.shouldFailNetwork) {
      throw new TelegramNetworkError('Connection refused to api.telegram.org');
    }
    if (this.rateLimitRetryAfter !== null) {
      const delay = this.rateLimitRetryAfter;
      this.rateLimitRetryAfter = null;
      throw new TelegramRateLimitError(delay, 'Too Many Requests');
    }
    this.messageCounter++;
    this.sentMessages.push({ chatId: chatId.toString(), text, options });
    return {
      message_id: this.messageCounter,
      chat: { id: chatId.toString() },
      text,
    };
  }

  async editMessageText(
    chatId: string | number | bigint,
    messageId: number | bigint,
    text: string,
    options?: unknown,
  ) {
    if (this.shouldFailNetwork) {
      throw new TelegramNetworkError('Connection refused to api.telegram.org');
    }
    if (this.rateLimitRetryAfter !== null) {
      const delay = this.rateLimitRetryAfter;
      this.rateLimitRetryAfter = null;
      throw new TelegramRateLimitError(delay, 'Too Many Requests');
    }
    this.editedMessages.push({
      chatId: chatId.toString(),
      messageId: Number(messageId),
      text,
      options,
    });
    return {
      message_id: Number(messageId),
      chat: { id: chatId.toString() },
      text,
    };
  }

  async answerCallbackQuery(callbackQueryId: string, options?: MockCallbackOptions) {
    if (this.shouldFailNetwork) {
      throw new TelegramNetworkError('Connection refused to api.telegram.org');
    }
    this.answeredCallbacks.push({ id: callbackQueryId, options });
    return true;
  }

  async sendPhoto(chatId: string | number | bigint, _photo: Buffer, _filename: string, caption?: string) {
    this.messageCounter++;
    this.sentMessages.push({ chatId: chatId.toString(), text: caption || '[photo]' });
    return {
      file_id: `mock_tg_file_${this.messageCounter}`,
      message_id: this.messageCounter,
    };
  }

  async sendVideo(chatId: string | number | bigint, _video: Buffer, _filename: string, caption?: string) {
    this.messageCounter++;
    this.sentMessages.push({ chatId: chatId.toString(), text: caption || '[video]' });
    return {
      file_id: `mock_tg_file_${this.messageCounter}`,
      message_id: this.messageCounter,
    };
  }

  async sendDocument(chatId: string | number | bigint, _document: Buffer, _filename: string, caption?: string) {
    this.messageCounter++;
    this.sentMessages.push({ chatId: chatId.toString(), text: caption || '[document]' });
    return {
      file_id: `mock_tg_file_${this.messageCounter}`,
      message_id: this.messageCounter,
    };
  }

  async getFile(fileId: string) {
    return {
      file_id: fileId,
      file_path: `photos/${fileId}.jpg`,
      file_size: 1024,
    };
  }

  async downloadFile(_filePath: string) {
    return Buffer.from('mock-file-content');
  }

  async getMe() {
    return {
      id: 999888777,
      is_bot: true,
      first_name: 'MockBot',
      username: 'mock_hiree_bot',
    };
  }

  async getChat(chatId: string | number | bigint) {
    return {
      id: chatId,
      type: 'channel',
      title: 'Mock Lottery Channel',
      username: typeof chatId === 'string' && chatId.startsWith('@') ? chatId.slice(1) : 'mock_lottery_channel',
    };
  }

  async getChatMember(_chatId: string | number | bigint, _userId: number | bigint) {
    return {
      status: 'administrator',
      can_post_messages: true,
      can_edit_messages: true,
    };
  }

  async deleteMessage(_chatId: string | number | bigint, _messageId: number | bigint): Promise<boolean> {
    return true;
  }

  reset() {
    this.sentMessages = [];
    this.editedMessages = [];
    this.answeredCallbacks = [];
    this.shouldFailNetwork = false;
    this.rateLimitRetryAfter = null;
  }
}

describe('Step 8: Outbox, Bot, and Channel Integration Tests', () => {
  const mockTelegram = new MockTelegramClient();
  let admin: { id: string; telegramId: bigint; cookie: string; csrfToken: string };
  let lotteryId: string;
  const createdUserIds: string[] = [];

  async function createAdminFixture(prefix: string) {
    const email = `${prefix}_${crypto.randomUUID().slice(0, 6)}@lottery.et`;
    const adminUser = await prisma.user.create({
      data: {
        telegramUserId: BigInt(Math.floor(Math.random() * 1000000000) + 7000000),
        username: `${prefix}_${crypto.randomUUID().slice(0, 6)}`,
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
    return { id: adminUser.id, telegramId: adminUser.telegramUserId, cookie, csrfToken };
  }

  async function createCustomer(prefix: string) {
    const telegramId = BigInt(Math.floor(Math.random() * 1000000000) + 8000000);
    const user = await prisma.user.create({
      data: {
        telegramUserId: telegramId,
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
    return { id: user.id, telegramId, token };
  }

  beforeAll(async () => {
    updatePlatformSettingsState({ telegramChannelId: '-1001234567890' });
    (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = '-1001234567890';
    setTelegramClient(mockTelegram);

    // Setup Admin
    admin = await createAdminFixture('outbox_admin');

    // Create an OPEN Lottery Campaign
    const lottery = await prisma.lottery.create({
      data: {
        slug: `outbox-test-${Date.now()}`,
        title: 'Outbox Test Lottery',
        description: 'Testing bot and channel updates',
        prizeDescription: 'Toyota Land Cruiser',
        ticketPriceMinor: 200_00n, // 200.00 ETB
        numberStart: 0,
        numberEnd: 49,
        status: LotteryStatus.OPEN,
        paymentInstructions: 'Transfer via CBE account 100012345678',
      },
    });
    lotteryId = lottery.id;

    // Generate inventory numbers 0..49
    const numbers = [];
    for (let i = 0; i <= 49; i++) {
      numbers.push({
        lotteryId,
        numberValue: i,
        status: NumberStatus.AVAILABLE,
      });
    }
    await prisma.lotteryNumber.createMany({ data: numbers });
  });

  beforeEach(async () => {
    mockTelegram.reset();
    updateDeduplicator.clear();
    await prisma.outboxEvent.deleteMany({});
  });

  afterAll(async () => {
    resetTelegramClient();
    await prisma.$disconnect();
  });

  it('1. Webhook Secret Token: rejects invalid or missing secret token with 401', async () => {
    const resNoToken = await request(app)
      .post('/webhooks/telegram')
      .send({ update_id: 10001, message: { chat: { id: 123 }, text: '/start' } });
    expect(resNoToken.status).toBe(401);
    expect(resNoToken.body.error.code).toBe('UNAUTHORIZED');

    const resBadToken = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', 'wrong_secret')
      .send({ update_id: 10002, message: { chat: { id: 123 }, text: '/start' } });
    expect(resBadToken.status).toBe(401);

    const resValid = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({ update_id: 10003, message: { chat: { id: 123 }, text: '/start' } });
    expect(resValid.status).toBe(200);
    expect(resValid.body.ok).toBe(true);
  });

  it('2. Update Deduplication: ignores identical update_id', async () => {
    const update = {
      update_id: 55555,
      message: {
        message_id: 1,
        chat: { id: 999 },
        text: '/start',
      },
    };

    const first = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send(update);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('START_COMMAND_HANDLED');
    expect(mockTelegram.sentMessages.length).toBe(1);

    // Duplicate call with exact same update_id
    const duplicate = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send(update);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.status).toBe('DUPLICATE_SKIPPED');

    // No extra message should have been sent
    expect(mockTelegram.sentMessages.length).toBe(1);
  });

  it('3. Commands: handles /start, /mytickets, /status, and /help', async () => {
    const customer = await createCustomer('cmd_user');

    // Test /start
    await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 60001,
        message: {
          message_id: 10,
          chat: { id: Number(customer.telegramId) },
          from: { id: Number(customer.telegramId) },
          text: '/start',
        },
      });
    expect(mockTelegram.sentMessages.length).toBe(1);
    expect(mockTelegram.sentMessages[0]?.text).toContain('Welcome to OROJACKPOT');

    // Test /help
    mockTelegram.reset();
    await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 60002,
        message: {
          message_id: 11,
          chat: { id: Number(customer.telegramId) },
          from: { id: Number(customer.telegramId) },
          text: '/help',
        },
      });
    expect(mockTelegram.sentMessages.length).toBe(1);
    expect(mockTelegram.sentMessages[0]?.text).toContain('How to Play');

    // Test /mytickets (empty initial state)
    mockTelegram.reset();
    await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 60003,
        message: {
          message_id: 12,
          chat: { id: Number(customer.telegramId) },
          from: { id: Number(customer.telegramId) },
          text: '/mytickets',
        },
      });
    expect(mockTelegram.sentMessages.length).toBe(1);
    expect(mockTelegram.sentMessages[0]?.text).toContain('no confirmed tickets');

    // Test /status
    mockTelegram.reset();
    await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 60004,
        message: {
          message_id: 13,
          chat: { id: Number(customer.telegramId) },
          from: { id: Number(customer.telegramId) },
          text: '/status',
        },
      });
    expect(mockTelegram.sentMessages.length).toBe(1);
    expect(mockTelegram.sentMessages[0]?.text).toContain('no active reservations');
  });

  it('4. Acceptance Criteria: a non-admin pressing an admin button is rejected', async () => {
    const customer = await createCustomer('non_admin_clicker');

    // Customer attempts to press approve button on arbitrary review
    const res = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 70001,
        callback_query: {
          id: 'cb_test_1',
          from: { id: Number(customer.telegramId), username: 'clicker' },
          data: 'rev:app:00000000-0000-0000-0000-000000000001',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UNAUTHORIZED_ADMIN_BUTTON');

    // Must have sent unauthorized alert callback answer
    expect(mockTelegram.answeredCallbacks.length).toBe(1);
    expect(mockTelegram.answeredCallbacks[0]?.options.text).toContain('Unauthorized');
    expect(mockTelegram.answeredCallbacks[0]?.options.show_alert).toBe(true);
  });

  it('5. Acceptance Criteria: with Telegram mocked as down, reservations succeed and events are retried later', async () => {
    // Simulate Telegram Bot API is completely down (offline / network error)
    mockTelegram.shouldFailNetwork = true;

    const buyer = await createCustomer('resilience_buyer');

    // Reservation MUST succeed transactionally despite Telegram being down!
    const res = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: [20, 21],
        idempotencyKey: `outbox-offline-${Date.now()}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.ticketCount).toBe(2);

    // Verify outbox event was created and remains PENDING
    const outboxEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'PROGRESS_UPDATE',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(outboxEvent).not.toBeNull();
    expect(outboxEvent!.attempts).toBe(0);

    // Run outbox processor while Telegram is down
    const batchResult = await processOutboxBatch();
    expect(batchResult.retried).toBeGreaterThan(0);

    // Event attempts incremented, status remains PENDING with future next_attempt_at
    const retriedEvent = await prisma.outboxEvent.findUnique({
      where: { id: outboxEvent!.id },
    });
    expect(retriedEvent!.attempts).toBe(1);
    expect(retriedEvent!.status).toBe('PENDING');
    expect(retriedEvent!.lastError).toContain('Connection refused');
    expect(retriedEvent!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);

    // Now Telegram comes back online!
    mockTelegram.shouldFailNetwork = false;

    // Reset nextAttemptAt to now to simulate timer firing
    await prisma.outboxEvent.update({
      where: { id: outboxEvent!.id },
      data: { nextAttemptAt: new Date(Date.now() - 5000) },
    });

    // Run outbox processor again
    const recoveryBatch = await processOutboxBatch();
    expect(recoveryBatch.processed).toBeGreaterThan(0);

    // Event is now PROCESSED!
    const processedEvent = await prisma.outboxEvent.findUnique({
      where: { id: outboxEvent!.id },
    });
    expect(processedEvent!.status).toBe('PROCESSED');
    expect(processedEvent!.lastError).toBeNull();
  });

  it('6. Exponential backoff and maximum 8 attempts transition to FAILED', async () => {
    // Create a standalone outbox event
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: { lotteryId, action: 'TEST_BACKOFF' },
        status: 'PENDING',
        attempts: 7, // Already tried 7 times
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    // Keep Telegram down
    mockTelegram.shouldFailNetwork = true;

    // Run batch - this 8th failure should transition status to FAILED
    const result = await processOutboxBatch();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const failedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(failedEvent!.status).toBe('FAILED');
    expect(failedEvent!.attempts).toBe(8);

    // Admin queries failed outbox events endpoint
    const failedList = await request(app)
      .get('/admin/outbox/failed')
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken);

    expect(failedList.status).toBe(200);
    expect(failedList.body.items.some((e: { id: string }) => e.id === event.id)).toBe(true);

    // Admin retries the failed event
    const retryRes = await request(app)
      .post(`/admin/outbox/${event.id}/retry`)
      .set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken);

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);

    const rePendingEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(rePendingEvent!.status).toBe('PENDING');
    expect(rePendingEvent!.attempts).toBe(0);
  });

  it('7. Handles Telegram 429 response by honoring retry_after', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: { lotteryId, action: 'RATE_LIMIT_TEST' },
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    // Telegram returns 429 with retry_after: 25
    mockTelegram.rateLimitRetryAfter = 25;

    const result = await processOutboxBatch();
    expect(result.retried).toBeGreaterThanOrEqual(1);

    const updatedEvent = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updatedEvent!.attempts).toBe(1);
    expect(updatedEvent!.status).toBe('PENDING');

    // nextAttemptAt must be ~25 seconds in the future
    const expectedMinTime = Date.now() + 20 * 1000;
    expect(updatedEvent!.nextAttemptAt.getTime()).toBeGreaterThan(expectedMinTime);
  });

  it('8. Reconcile job: verifies active campaigns and updates channel progress posts', async () => {
    const reconcileRes = await reconcileChannelPosts();
    expect(reconcileRes.checkedCount).toBeGreaterThanOrEqual(1);
  });

  it('9. Admin pressing an admin button in Telegram: approves payment, confirms reservation, and edits bot message', async () => {
    const validJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
      0x00, 0xbf, 0x00, 0xff, 0xd9,
    ]);

    const buyer = await createCustomer('admin_btn_buyer');

    // 1. Buyer reserves numbers 35, 36
    const resRes = await request(app)
      .post(`/lotteries/${lotteryId}/reservations`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        numbers: [35, 36],
        idempotencyKey: `admin-btn-${Date.now()}`,
      });
    expect(resRes.status).toBe(201);
    const reservation = resRes.body;

    // 2. Put file in storage and submit payment
    const storageKey = `proofs/${buyer.id}/btn-proof-${Date.now()}.jpg`;
    const { writeStorageFile } = await import('../src/modules/storage/service.js');
    await writeStorageFile(storageKey, validJpeg);

    const subRes = await request(app)
      .post(`/reservations/${reservation.id}/payment-submissions`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        storageKey,
        originalFilename: 'btn-proof.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: validJpeg.length,
        fileSha256: crypto.createHash('sha256').update(validJpeg).digest('hex'),
        claimedAmountMinor: 400_00,
        paymentReference: 'CBE-TELEGRAM-BOT-TEST',
      });
    expect(subRes.status).toBe(201);
    const submission = subRes.body;

    // 3. Admin clicks approve button via Telegram Webhook
    const webhookRes = await request(app)
      .post('/webhooks/telegram')
      .set('x-telegram-bot-api-secret-token', config.TELEGRAM_WEBHOOK_SECRET)
      .send({
        update_id: 80001,
        callback_query: {
          id: 'cb_admin_1',
          from: {
            id: Number(admin.telegramId),
            username: 'super_lottery_admin',
            first_name: 'AdminA',
          },
          message: {
            message_id: 555,
            chat: { id: -1001234567890 },
            text: `Payment Submission for Review: ${reservation.publicReference}`,
          },
          data: `rev:app:${submission.id}`,
        },
      });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.status).toBe('REVIEW_PROCESSED');

    // Callback query answered with success
    expect(mockTelegram.answeredCallbacks.length).toBe(1);
    expect(mockTelegram.answeredCallbacks[0]?.options.text).toContain('Payment approved');

    // Bot message edited to reflect approval
    expect(mockTelegram.editedMessages.length).toBe(1);
    expect(mockTelegram.editedMessages[0]?.text).toContain('<b>APPROVED</b> by @super_lottery_admin');

    // Verify DB state: Submission is APPROVED, Reservation is CONFIRMED, Numbers are RESERVED
    const dbSub = await prisma.paymentSubmission.findUnique({
      where: { id: submission.id },
    });
    expect(dbSub!.status).toBe(PaymentStatus.APPROVED);

    const dbRes = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(dbRes!.status).toBe(ReservationStatus.CONFIRMED);

    const dbNums = await prisma.lotteryNumber.findMany({
      where: {
        lotteryId,
        numberValue: { in: [35, 36] },
      },
    });
    expect(dbNums.every((n) => n.status === NumberStatus.RESERVED)).toBe(true);
  });
});

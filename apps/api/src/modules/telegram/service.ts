import crypto from 'node:crypto';
import { prisma } from '../../db/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';
import { getTelegramClient } from './client.js';
import {
  approvePaymentSubmission,
  rejectPaymentSubmission,
} from '../admin-review/service.js';
import { NumberStatus, ReservationStatus, PaymentStatus } from '@prisma/client';
import { clearSummaryCache } from '../lotteries/service.js';
import { cache, CACHE_KEYS } from '../cache/index.js';

export interface TelegramUser {
  id: number | bigint;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | bigint;
  type: string;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
  document?: {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ItemSnapshot {
  numberValueSnapshot: number;
}

/**
 * Enterprise Distributed Deduplicator for incoming Telegram updates.
 * Leverages Redis atomic setNx with 24-hour TTL, seamlessly backed by MemoryCacheAdapter.
 */
class TelegramUpdateDeduplicator {
  async isDuplicate(updateId: number): Promise<boolean> {
    const key = CACHE_KEYS.BOT_DEDUP(updateId);
    const wasSet = await cache.setNx(key, '1', 86400); // 24-hour TTL
    return !wasSet;
  }

  clear(): void {
    void cache.delPattern('bot:dedup:*');
  }
}

export const updateDeduplicator = new TelegramUpdateDeduplicator();

/**
 * Helper to build an ASCII visual progress bar.
 */
export function buildProgressBar(percentage: number, length = 10): string {
  const filledCount = Math.min(length, Math.max(0, Math.round((percentage / 100) * length)));
  const emptyCount = length - filledCount;
  return '🟩'.repeat(filledCount) + '⬜'.repeat(emptyCount);
}

/**
 * Safely resolves the single clean HTTPS URL for the Telegram Mini App.
 * Handles comma-separated CORS_ORIGIN values and trims trailing slashes.
 */
export function getCleanMiniAppUrl(path = ''): string {
  const customUrl = process.env.MINI_APP_URL || process.env.TELEGRAM_MINI_APP_URL;
  let base = 'https://mini-tg-app.vercel.app';
  if (customUrl && customUrl.startsWith('http')) {
    base = customUrl.trim();
  } else if (config.CORS_ORIGIN) {
    const list = config.CORS_ORIGIN.split(',').map((s) => s.trim());
    const httpsOrigin = list.find((s) => s.startsWith('https://'));
    if (httpsOrigin) {
      base = httpsOrigin;
    } else if (list[0] && list[0].startsWith('http')) {
      base = list[0];
    }
  }
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = path ? path.replace(/^\/+/, '') : '';
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

export async function handleStartCommand(chatId: number | string | bigint): Promise<void> {
  const client = getTelegramClient();
  const miniAppUrl = getCleanMiniAppUrl();

  const welcomeText =
    `👋 <b>Welcome to OROJACKPOT!</b>\n` +
    `<i>Your chance. Your destiny.</i>\n\n` +
    `Baga nagaan dhuftan! Official verifiable digital lottery platform.\n\n` +
    `• Select your lucky numbers (up to 20 per purchase)\n` +
    `• Complete payment safely via Telebirr or CBE\n` +
    `• Upload receipt and receive instant confirmation\n` +
    `• Transparent, verifiable cryptographic prize draws\n\n` +
    `Tap <b>Open Lottery App</b> below to begin!`;

  await client.sendMessage(chatId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🎟 Open OROJACKPOT App',
            web_app: { url: miniAppUrl },
          },
        ],
        [
          { text: '🎫 My Tickets', callback_data: 'cmd:mytickets' },
          { text: '📊 Active Holds', callback_data: 'cmd:status' },
        ],
        [
          { text: 'ℹ️ How to Play & Help', callback_data: 'cmd:help' },
        ],
      ],
    },
  });
}

export async function handleMyTicketsCommand(chatId: number | string | bigint, fromId: bigint | null): Promise<void> {
  const client = getTelegramClient();
  const miniAppUrl = getCleanMiniAppUrl();

  if (!fromId) {
    await client.sendMessage(chatId, 'Unable to identify Telegram user account.');
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramUserId: fromId },
    include: {
      reservations: {
        where: { status: ReservationStatus.CONFIRMED },
        include: {
          lottery: true,
          items: {
            orderBy: { numberValueSnapshot: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!user || user.reservations.length === 0) {
    await client.sendMessage(
      chatId,
      `🎟 <b>You have no confirmed tickets yet.</b>\n\nOpen the Mini App to choose your lucky numbers and join the next draw!`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎟 Pick Lucky Numbers',
                web_app: { url: miniAppUrl },
              },
            ],
            [
              { text: 'ℹ️ How to Play', callback_data: 'cmd:help' },
            ],
          ],
        },
      },
    );
    return;
  }

  let responseText = `🎟 <b>Your Confirmed Lucky Tickets:</b>\n\n`;
  for (const res of user.reservations) {
    const numbers = (res.items as ItemSnapshot[]).map((i) => i.numberValueSnapshot).join(', ');
    responseText +=
      `🏆 <b>${res.lottery.title}</b>\n` +
      `Numbers: <b>[ ${numbers} ]</b> (${res.ticketCount} ticket${res.ticketCount > 1 ? 's' : ''})\n` +
      `Confirmed on: ${res.createdAt.toLocaleDateString()}\n\n`;
  }

  await client.sendMessage(chatId, responseText, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🎟 Open Lottery App',
            web_app: { url: miniAppUrl },
          },
        ],
      ],
    },
  });
}

export async function handleStatusCommand(chatId: number | string | bigint, fromId: bigint | null): Promise<void> {
  const client = getTelegramClient();
  const miniAppUrl = getCleanMiniAppUrl();

  if (!fromId) {
    await client.sendMessage(chatId, 'Unable to identify Telegram user account.');
    return;
  }

  const activeReservations = await prisma.reservation.findMany({
    where: {
      user: { telegramUserId: fromId },
      status: {
        in: [
          ReservationStatus.AWAITING_PAYMENT,
          ReservationStatus.PENDING_REVIEW,
          ReservationStatus.CONFIRMED,
        ],
      },
    },
    include: {
      lottery: true,
      items: { orderBy: { numberValueSnapshot: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (activeReservations.length === 0) {
    await client.sendMessage(
      chatId,
      `📊 <b>No Active Reservations</b>\n\nYou currently have no active reservations or ticket holds.\n\nOpen the Mini App to explore open campaigns!`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎟 Browse Open Draws',
                web_app: { url: miniAppUrl },
              },
            ],
          ],
        },
      },
    );
    return;
  }

  let statusText = `📊 <b>Your Active Ticket Status:</b>\n\n`;
  for (const r of activeReservations) {
    const numbers = (r.items as ItemSnapshot[]).map((i) => i.numberValueSnapshot).join(', ');
    let statusEmoji = '⏳';
    let statusDesc = 'Awaiting Transfer & Receipt';
    if (r.status === ReservationStatus.CONFIRMED) {
      statusEmoji = '✅';
      statusDesc = 'Confirmed (In Draw)';
    }
    if (r.status === ReservationStatus.PENDING_REVIEW) {
      statusEmoji = '🔍';
      statusDesc = 'Under Review by Admin';
    }

    const amountEtb = Number(r.totalAmountMinor) / 100;
    statusText +=
      `${statusEmoji} <b>${r.lottery.title}</b>\n` +
      `Status: <b>${statusDesc}</b>\n` +
      `Numbers: [ ${numbers} ]\n` +
      `Amount: ${amountEtb.toFixed(2)} ETB\n`;

    if (r.status === ReservationStatus.AWAITING_PAYMENT && r.holdExpiresAt) {
      const remainingSec = Math.max(0, Math.floor((r.holdExpiresAt.getTime() - Date.now()) / 1000));
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;
      statusText += `⏳ Hold expires in: <b>${min}m ${sec}s</b>\n`;
    }
    statusText += `\n`;
  }

  await client.sendMessage(chatId, statusText, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🎟 View in Mini App',
            web_app: { url: miniAppUrl },
          },
        ],
      ],
    },
  });
}

export async function handleHelpCommand(chatId: number | string | bigint): Promise<void> {
  const client = getTelegramClient();
  const miniAppUrl = getCleanMiniAppUrl();

  const helpText =
    `ℹ️ <b>How to Play OROJACKPOT:</b>\n\n` +
    `1️⃣ <b>Select Numbers:</b> Open the Mini App and pick up to 20 numbers from the transparent grid.\n` +
    `2️⃣ <b>Hold & Transfer:</b> Once held, you have 10 minutes to transfer the exact amount via Telebirr or Commercial Bank of Ethiopia (CBE).\n` +
    `3️⃣ <b>Upload Evidence:</b> Submit your transfer screenshot directly in the app or send the receipt here in chat.\n` +
    `4️⃣ <b>Admin Verification:</b> Our team verifies your transaction against official bank records.\n` +
    `5️⃣ <b>Cryptographic Draw:</b> Winning numbers are generated with transparent SHA-256 commit-reveal entropy.\n\n` +
    `💬 <i>Need assistance?</i> Contact official support: @orojackpotsupport`;

  await client.sendMessage(chatId, helpText, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🎟 Open OROJACKPOT App',
            web_app: { url: miniAppUrl },
          },
        ],
        [
          { text: '🎫 My Tickets', callback_data: 'cmd:mytickets' },
          { text: '📊 Active Holds', callback_data: 'cmd:status' },
        ],
      ],
    },
  });
}

/**
 * Handles incoming Telegram updates from the webhook.
 */
export async function processTelegramUpdate(update: TelegramUpdate): Promise<{ ok: boolean; status: string }> {
  if (await updateDeduplicator.isDuplicate(update.update_id)) {
    logger.debug({ updateId: update.update_id }, 'Duplicate Telegram update received; skipping');
    return { ok: true, status: 'DUPLICATE_SKIPPED' };
  }

  const client = getTelegramClient();

  // 1. Handle Callback Query (e.g. Admin Review buttons & user command buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const fromId = BigInt(cb.from.id);
    const data = cb.data || '';
    const chatId = cb.message ? cb.message.chat.id : cb.from.id;

    // Check if it's a customer command button callback: cmd:start, cmd:mytickets, cmd:status, cmd:help
    if (data === 'cmd:start') {
      await client.answerCallbackQuery(cb.id);
      await handleStartCommand(chatId);
      return { ok: true, status: 'START_CALLBACK_HANDLED' };
    }

    if (data === 'cmd:mytickets') {
      await client.answerCallbackQuery(cb.id);
      await handleMyTicketsCommand(chatId, fromId);
      return { ok: true, status: 'MYTICKETS_CALLBACK_HANDLED' };
    }

    if (data === 'cmd:status') {
      await client.answerCallbackQuery(cb.id);
      await handleStatusCommand(chatId, fromId);
      return { ok: true, status: 'STATUS_CALLBACK_HANDLED' };
    }

    if (data === 'cmd:help') {
      await client.answerCallbackQuery(cb.id);
      await handleHelpCommand(chatId);
      return { ok: true, status: 'HELP_CALLBACK_HANDLED' };
    }

    // Check if it's an admin review action: rev:app:<submissionId> or rev:rej:<submissionId>
    if (data.startsWith('rev:app:') || data.startsWith('rev:rej:')) {
      const isApprove = data.startsWith('rev:app:');
      const submissionId = data.split(':')[2];

      // Security check: Must be an ADMIN or SUPERADMIN in the database
      const user = await prisma.user.findUnique({
        where: { telegramUserId: fromId },
      });

      if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN')) {
        logger.warn(
          { fromId: fromId.toString(), submissionId },
          'Non-admin user attempted to press admin review button in Telegram',
        );
        await client.answerCallbackQuery(cb.id, {
          text: 'Unauthorized: you are not an administrator',
          show_alert: true,
        });
        return { ok: true, status: 'UNAUTHORIZED_ADMIN_BUTTON' };
      }

      if (!submissionId) {
        await client.answerCallbackQuery(cb.id, {
          text: 'Invalid review payload',
          show_alert: true,
        });
        return { ok: true, status: 'INVALID_PAYLOAD' };
      }

      try {
        const adminName = cb.from.username ? `@${cb.from.username}` : cb.from.first_name || 'Admin';

        if (isApprove) {
          const result = await approvePaymentSubmission({
            submissionId,
            adminUserId: user.id,
            comparedWithBankRecord: true,
            note: 'Approved via Telegram Bot',
          });

          if (result.status === 'NEEDS_SECOND_APPROVAL') {
            await client.answerCallbackQuery(cb.id, {
              text: 'First approval recorded. Second admin approval required.',
              show_alert: false,
            });

            if (cb.message) {
              const currentText = cb.message.text || '';
              await client.editMessageText(
                cb.message.chat.id,
                cb.message.message_id,
                `${currentText}\n\n⚠️ <i>First approval recorded by ${adminName}. Awaiting second admin approval.</i>`,
              );
            }
          } else {
            await client.answerCallbackQuery(cb.id, {
              text: 'Payment approved and tickets confirmed!',
              show_alert: false,
            });

            if (cb.message) {
              const currentText = cb.message.text || '';
              await client.editMessageText(
                cb.message.chat.id,
                cb.message.message_id,
                `${currentText}\n\n✅ <b>APPROVED</b> by ${adminName} on ${new Date().toLocaleString()}`,
              );
            }
          }
        } else {
          await rejectPaymentSubmission({
            submissionId,
            adminUserId: user.id,
            reason: 'Payment could not be verified on bank records (rejected via Telegram Bot)',
          });

          await client.answerCallbackQuery(cb.id, {
            text: 'Payment submission rejected and numbers released.',
            show_alert: false,
          });

          if (cb.message) {
            const currentText = cb.message.text || '';
            await client.editMessageText(
              cb.message.chat.id,
              cb.message.message_id,
              `${currentText}\n\n❌ <b>REJECTED</b> by ${adminName} on ${new Date().toLocaleString()}`,
            );
          }
        }

        return { ok: true, status: 'REVIEW_PROCESSED' };
      } catch (err: unknown) {
        logger.error({ err, submissionId }, 'Error handling admin review callback query');
        const message = err instanceof Error ? err.message : 'Operation failed';
        await client.answerCallbackQuery(cb.id, {
          text: `Action failed: ${message}`,
          show_alert: true,
        });
        return { ok: true, status: 'REVIEW_FAILED' };
      }
    }

    // Default response for unhandled callbacks
    await client.answerCallbackQuery(cb.id);
    return { ok: true, status: 'CALLBACK_HANDLED' };
  }

  // 2. Handle Text Messages / Commands
  if (update.message && update.message.text) {
    const msg = update.message;
    const text = (msg.text || '').trim();
    const chatId = msg.chat.id;
    const fromId = msg.from ? BigInt(msg.from.id) : null;

    if (text === '/start' || text.startsWith('/start')) {
      await handleStartCommand(chatId);
      return { ok: true, status: 'START_COMMAND_HANDLED' };
    }

    if (text === '/mytickets' || text.startsWith('/mytickets')) {
      await handleMyTicketsCommand(chatId, fromId);
      return { ok: true, status: 'MYTICKETS_SHOWN' };
    }

    if (text === '/status' || text.startsWith('/status')) {
      await handleStatusCommand(chatId, fromId);
      return { ok: true, status: 'STATUS_SHOWN' };
    }

    if (text === '/help' || text.startsWith('/help')) {
      await handleHelpCommand(chatId);
      return { ok: true, status: 'HELP_SHOWN' };
    }
  }

  // 3. Handle Direct Receipt Media (Photo or Document) Uploaded in Bot Chat
  if (update.message && (update.message.photo || update.message.document)) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const fromId = msg.from ? BigInt(msg.from.id) : null;

    if (!fromId) {
      await client.sendMessage(chatId, 'Unable to identify Telegram user.');
      return { ok: true, status: 'NO_USER' };
    }

    const user = await prisma.user.findUnique({
      where: { telegramUserId: fromId },
    });

    if (!user) {
      await client.sendMessage(
        chatId,
        'Please start the bot using /start before sending receipts.',
      );
      return { ok: true, status: 'USER_NOT_REGISTERED' };
    }

    // Find user's active reservation awaiting payment
    const pendingReservation = await prisma.reservation.findFirst({
      where: {
        userId: user.id,
        status: ReservationStatus.AWAITING_PAYMENT,
        holdExpiresAt: { gt: new Date() },
      },
      include: {
        items: true,
        lottery: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pendingReservation) {
      await client.sendMessage(
        chatId,
        `ℹ️ <b>Receipt received</b>, but you do not have an active lottery reservation awaiting payment.\n\nOpen the Mini App to select your lucky numbers first!`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🎟 Open Lottery App',
                  web_app: { url: getCleanMiniAppUrl() },
                },
              ],
            ],
          },
        },
      );
      return { ok: true, status: 'NO_PENDING_RESERVATION' };
    }

    // Extract photo or document file_id
    let fileId = '';
    let originalFilename = 'telegram_receipt.jpg';
    let mimeType = 'image/jpeg';
    let fileSizeBytes = 0;

    if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1]!;
      fileId = largestPhoto.file_id;
      fileSizeBytes = largestPhoto.file_size || 0;
    } else if (msg.document) {
      fileId = msg.document.file_id;
      originalFilename = msg.document.file_name || 'receipt.pdf';
      mimeType = msg.document.mime_type || 'application/pdf';
      fileSizeBytes = msg.document.file_size || 0;
    }

    // Download buffer to compute SHA-256 for audit & duplicate checks
    let fileSha256 = crypto.randomBytes(16).toString('hex');
    try {
      const fileInfo = await client.getFile(fileId);
      if (fileInfo?.file_path) {
        const buf = await client.downloadFile(fileInfo.file_path);
        fileSha256 = crypto.createHash('sha256').update(buf).digest('hex');
        fileSizeBytes = buf.length;
      }
    } catch (err) {
      logger.warn({ err, fileId }, 'Could not download photo to compute sha256; generated fallback hash');
    }

    const storageKey = `tg:${fileId}`;
    const paymentReference = (msg.caption || '').trim() || null;

    // Transition reservation and create payment submission
    await prisma.$transaction(async (tx) => {
      await tx.paymentSubmission.create({
        data: {
          reservationId: pendingReservation.id,
          submittedBy: user.id,
          storageKey,
          originalFilename,
          mimeType,
          fileSizeBytes: BigInt(fileSizeBytes),
          fileSha256,
          paymentReference,
          status: PaymentStatus.SUBMITTED,
        },
      });

      await tx.reservation.update({
        where: { id: pendingReservation.id },
        data: {
          status: ReservationStatus.PENDING_REVIEW,
          submittedAt: new Date(),
        },
      });

      const numberIds = pendingReservation.items.map((i) => i.lotteryNumberId);
      await tx.lotteryNumber.updateMany({
        where: { id: { in: numberIds } },
        data: { status: NumberStatus.PENDING_REVIEW },
      });
    });

    clearSummaryCache(pendingReservation.lotteryId);

    const numbersList = pendingReservation.items
      .map((i) => i.numberValueSnapshot)
      .sort((a, b) => a - b)
      .join(', ');
    const amountFormatted = (Number(pendingReservation.totalAmountMinor) / 100).toFixed(2);

    await client.sendMessage(
      chatId,
      `✅ <b>Payment Receipt Registered!</b>\n\n` +
        `🏆 <b>Campaign:</b> ${pendingReservation.lottery.title}\n` +
        `🔢 <b>Selected Numbers (${pendingReservation.ticketCount}):</b> [ ${numbersList} ]\n` +
        `💰 <b>Amount:</b> ${amountFormatted} ETB\n` +
        `⏳ <b>Status:</b> <i>Pending Verification</i>\n\n` +
        `<i>Your payment proof has been attached and will be verified by our team. You'll receive a confirmation notification here once approved!</i>`,
    );

    return { ok: true, status: 'PAYMENT_RECEIPT_ATTACHED' };
  }

  return { ok: true, status: 'NO_ACTION' };
}

/**
 * Updates or publishes the progress post in the Telegram Channel.
 * Throttled to max 1 edit per 60 seconds per lottery.
 */
export async function updateChannelProgressPost(
  lotteryId: string,
  options?: { force?: boolean },
): Promise<{ success: boolean; throttled?: boolean; nextAllowedAt?: Date; channelConfigured?: boolean }> {
  const channelId = config.TELEGRAM_CHANNEL_ID;
  if (!channelId) {
    logger.debug('No TELEGRAM_CHANNEL_ID configured; skipping channel progress update');
    return { success: true, channelConfigured: false };
  }

  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
  });
  if (!lottery) {
    return { success: false };
  }

  const existingPost = await prisma.channelPost.findFirst({
    where: { lotteryId, postType: 'PROGRESS' },
  });

  const now = new Date();

  // 60-second throttle enforcement
  if (existingPost && existingPost.lastPublishedAt && !options?.force) {
    const elapsedMs = now.getTime() - existingPost.lastPublishedAt.getTime();
    if (elapsedMs < 60_000) {
      const nextAllowedAt = new Date(existingPost.lastPublishedAt.getTime() + 60_000);
      logger.debug(
        { lotteryId, elapsedMs, nextAllowedAt },
        'Channel progress edit throttled (max 1 edit per 60s)',
      );
      return { success: false, throttled: true, nextAllowedAt };
    }
  }

  const totalNumbers = lottery.numberEnd - lottery.numberStart + 1;
  const reservedCount = await prisma.lotteryNumber.count({
    where: { lotteryId, status: NumberStatus.RESERVED },
  });
  const heldCount = await prisma.lotteryNumber.count({
    where: { lotteryId, status: NumberStatus.HELD },
  });
  const remainingNumbers = Math.max(0, totalNumbers - reservedCount);
  const percentage = Math.min(100, Math.round((reservedCount / totalNumbers) * 100));
  const progressBar = buildProgressBar(percentage, 10);
  const priceEtb = (Number(lottery.ticketPriceMinor) / 100).toFixed(2);

  let statusLabel = `🟢 Active & Open for Sales`;
  if (lottery.status === 'PAUSED') {
    statusLabel = `⏸ Paused`;
  } else if (lottery.status === 'CLOSED') {
    statusLabel = `🏁 Closed (Draw Upcoming)`;
  } else if (lottery.status === 'DRAFT') {
    statusLabel = `📝 Draft`;
  } else if (lottery.status === 'ARCHIVED') {
    statusLabel = `📁 Archived`;
  }

  const postText =
    `🎟 <b>${lottery.title}</b>\n\n` +
    `🏆 <b>Grand Prize:</b> ${lottery.prizeDescription}\n` +
    `💵 <b>Ticket Price:</b> ${priceEtb} ETB\n\n` +
    `⚡ <b>Status:</b> ${statusLabel}\n` +
    `🔢 <b>Remaining Numbers:</b> <b>${remainingNumbers}</b> / ${totalNumbers} available` +
    (heldCount > 0 ? ` (<i>${heldCount} currently held</i>)` : '') + `\n` +
    `📊 <b>Progress:</b> ${reservedCount} / ${totalNumbers} Tickets Confirmed (${percentage}%)\n` +
    `${progressBar}\n\n` +
    `⚡ Tap below to pick your lucky numbers in the Mini App before they sell out!`;

  const client = getTelegramClient();
  const miniAppUrl = getCleanMiniAppUrl(`?lottery=${lottery.slug}`);
  // In Telegram channels, inline keyboard buttons must use "url", not "web_app"
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: '🎟 Pick Lucky Numbers',
          url: miniAppUrl,
        },
      ],
    ],
  };

  if (existingPost) {
    try {
      const targetChat = existingPost.chatId !== 0n ? existingPost.chatId.toString() : channelId;
      await client.editMessageText(
        targetChat,
        existingPost.messageId,
        postText,
        { reply_markup: replyMarkup },
      );

      await prisma.channelPost.update({
        where: { id: existingPost.id },
        data: { lastPublishedAt: now },
      });
      return { success: true };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '';
      if (
        errMsg.includes('403') ||
        errMsg.includes('not a member of the channel') ||
        errMsg.includes('bot was kicked') ||
        errMsg.includes('chat not found')
      ) {
        logger.warn(
          { lotteryId, channelId },
          'Telegram bot is not a member/admin of the channel; skipping channel post edit',
        );
        return { success: false, channelConfigured: false };
      }
      logger.warn({ err, lotteryId }, 'Existing channel post could not be edited; recreating fresh message');
      await prisma.channelPost.delete({ where: { id: existingPost.id } }).catch(() => {});
      // Fall through to initial post
    }
  }

  // Initial post (or fallback if previous message was deleted)
  try {
    const result = await client.sendMessage(channelId, postText, {
      reply_markup: replyMarkup,
    });

    if (result && typeof result.message_id === 'number') {
      const chatObj = result.chat as { id?: number | string } | undefined;
      let numericChatId = 0n;
      if (chatObj?.id) {
        numericChatId = BigInt(chatObj.id);
      } else if (/^-?\d+$/.test(channelId)) {
        numericChatId = BigInt(channelId);
      }

      await prisma.channelPost.create({
        data: {
          lotteryId,
          chatId: numericChatId,
          messageId: BigInt(result.message_id),
          postType: 'PROGRESS',
          lastPublishedAt: now,
        },
      });
    }
    return { success: true };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : '';
    if (
      errMsg.includes('403') ||
      errMsg.includes('not a member of the channel') ||
      errMsg.includes('bot was kicked') ||
      errMsg.includes('chat not found')
    ) {
      logger.warn(
        { lotteryId, channelId },
        'Telegram bot is not a member/admin of the channel. Please add your bot to the Telegram channel as an Administrator with message posting permissions.',
      );
      return { success: false, channelConfigured: false };
    }
    logger.error({ err, lotteryId }, 'Failed to create channel progress message');
    throw err;
  }
}

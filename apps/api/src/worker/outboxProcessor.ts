import { prisma } from '../db/index.js';
import { logger } from '../logger/index.js';
import {
  getTelegramClient,
  TelegramRateLimitError,
} from '../modules/telegram/client.js';
import { updateChannelProgressPost } from '../modules/telegram/service.js';
import { getPlatformTelegramChannelId } from '../modules/platform/settings.js';

export interface OutboxProcessResult {
  processed: number;
  failed: number;
  retried: number;
}

export interface OutboxPayload {
  type?: string;
  lotteryId?: string;
  reservationId?: string;
  ticketCount?: number;
  totalAmountMinor?: string;
  isDuplicateHash?: boolean;
  submissionId?: string;
  userId?: string;
  reason?: string;
  lotteryTitle?: string;
  winningNumber?: number;
  prizeDescription?: string;
  eligibleSetSha256?: string;
  [key: string]: unknown;
}

interface ItemSnapshot {
  numberValueSnapshot: number;
}

const MAX_ATTEMPTS = 8;

/**
 * Processes a single outbox event.
 */
export async function processOutboxEvent(event: {
  id: string;
  eventType: string;
  payload: OutboxPayload;
}): Promise<void> {
  const client = getTelegramClient();
  const { eventType, payload } = event;

  switch (eventType) {
    case 'ADMIN_NOTIFICATION': {
      const channelId = getPlatformTelegramChannelId();
      if (!channelId) {
        logger.debug('No channel configured in Superadmin Settings for ADMIN_NOTIFICATION; skipping message');
        return;
      }

      if (payload.type === 'PAYMENT_SUBMISSION_RECEIVED') {
        const lottery = await prisma.lottery.findUnique({
          where: { id: payload.lotteryId },
        });

        const amountEtb = payload.totalAmountMinor
          ? (Number(payload.totalAmountMinor) / 100).toFixed(2)
          : '0.00';

        const duplicateWarning = payload.isDuplicateHash
          ? '\n\n⚠️ <b>ALERT: Potential duplicate receipt detected!</b>'
          : '';

        const msgText =
          `📋 <b>New Payment Submission for Review</b>\n\n` +
          `<b>Campaign:</b> ${lottery?.title || 'Unknown'}\n` +
          `<b>Tickets:</b> ${payload.ticketCount}\n` +
          `<b>Amount:</b> ${amountEtb} ETB` +
          duplicateWarning +
          `\n\nReview ID: <code>${payload.submissionId}</code>`;

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `rev:app:${payload.submissionId}` },
              { text: '❌ Reject', callback_data: `rev:rej:${payload.submissionId}` },
            ],
          ],
        };

        await client.sendMessage(channelId, msgText, { reply_markup: replyMarkup });
      }
      break;
    }

    case 'CUSTOMER_NOTIFICATION': {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        logger.warn({ userId: payload.userId }, 'Target user not found for CUSTOMER_NOTIFICATION');
        return;
      }

      const telegramUserId = user.telegramUserId.toString();

      if (payload.type === 'TICKETS_CONFIRMED') {
        const lottery = await prisma.lottery.findUnique({
          where: { id: payload.lotteryId },
        });
        const reservation = await prisma.reservation.findUnique({
          where: { id: payload.reservationId },
          include: { items: { orderBy: { numberValueSnapshot: 'asc' } } },
        });

        const numbersStr =
          ((reservation?.items as ItemSnapshot[]) ?? [])
            .map((i) => i.numberValueSnapshot)
            .join(', ') || '';

        const confirmMsg =
          `🎉 <b>Payment Confirmed!</b>\n\n` +
          `Your tickets for <b>${lottery?.title || 'Lottery'}</b> have been confirmed!\n\n` +
          `Your lucky numbers: <b>[ ${numbersStr} ]</b> (${reservation?.ticketCount} tickets)\n\n` +
          `Good luck in the upcoming prize draw!`;

        await client.sendMessage(telegramUserId, confirmMsg);
      } else if (payload.type === 'PAYMENT_REJECTED') {
        const lottery = await prisma.lottery.findUnique({
          where: { id: payload.lotteryId },
        });

        const rejectMsg =
          `❌ <b>Payment Rejected</b>\n\n` +
          `Your payment submission for <b>${lottery?.title || 'Lottery'}</b> was rejected.\n\n` +
          `<b>Reason:</b> ${payload.reason || 'Verification failed.'}\n\n` +
          `Your held numbers have been released back to inventory. If you have questions, please reach out to support.`;

        await client.sendMessage(telegramUserId, rejectMsg);
      }
      break;
    }

    case 'PROGRESS_UPDATE': {
      if (payload.lotteryId) {
        const result = await updateChannelProgressPost(payload.lotteryId);
        if (result.throttled && result.nextAllowedAt) {
          // Re-schedule this progress update for when throttle window opens
          throw new TelegramRateLimitError(
            Math.max(1, Math.ceil((result.nextAllowedAt.getTime() - Date.now()) / 1000)),
            'Throttled progress post edit',
          );
        }
      }
      break;
    }

    case 'CAMPAIGN_ANNOUNCEMENT': {
      if (payload.lotteryId) {
        await updateChannelProgressPost(payload.lotteryId, { force: true });
      }
      break;
    }

    case 'DRAW_ANNOUNCEMENT': {
      const channelId = getPlatformTelegramChannelId();
      if (channelId && payload.lotteryTitle && payload.winningNumber !== undefined) {
        try {
          const drawMsg =
            `🏆 <b>PRIZE DRAW WINNER ANNOUNCEMENT!</b>\n\n` +
            `Campaign: <b>${payload.lotteryTitle}</b>\n` +
            `Prize: <b>${payload.prizeDescription || 'Grand Prize'}</b>\n\n` +
            `🎯 <b>Winning Number:</b> <code>${payload.winningNumber}</code>\n\n` +
            `Verification Hash (SHA-256): <code>${payload.eligibleSetSha256 || 'N/A'}</code>\n\n` +
            `Congratulations to the winner!`;

          await client.sendMessage(channelId, drawMsg);
        } catch (err) {
          logger.warn({ err, channelId }, 'Could not post draw announcement to channel (bot may not be an admin)');
        }
      }
      break;
    }

    default:
      logger.info({ eventType }, 'Unhandled outbox event type; marking processed');
      break;
  }
}

/**
 * Scans and executes a batch of pending outbox events using FOR UPDATE SKIP LOCKED.
 */
export async function processOutboxBatch(batchSize = 50): Promise<OutboxProcessResult> {
  const result: OutboxProcessResult = {
    processed: 0,
    failed: 0,
    retried: 0,
  };

  // 1. Fetch batch using row locking to prevent concurrent workers from contending
  const pendingEvents = await prisma.$queryRaw<
    Array<{
      id: string;
      event_type: string;
      payload: OutboxPayload;
      status: string;
      attempts: number;
      next_attempt_at: Date;
      last_error: string | null;
    }>
  >`
    SELECT id, event_type, payload, status, attempts, next_attempt_at, last_error
    FROM outbox_events
    WHERE status = 'PENDING' AND next_attempt_at <= NOW()
    ORDER BY created_at ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  `;

  if (pendingEvents.length === 0) {
    return result;
  }

  for (const event of pendingEvents) {
    try {
      await processOutboxEvent({
        id: event.id,
        eventType: event.event_type,
        payload: event.payload,
      });

      // Success: mark PROCESSED
      await prisma.$executeRaw`
        UPDATE outbox_events
        SET status = 'PROCESSED', last_error = NULL
        WHERE id = ${event.id}::uuid
      `;
      result.processed++;
    } catch (err: unknown) {
      const newAttempts = event.attempts + 1;
      const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);

      if (newAttempts >= MAX_ATTEMPTS) {
        // Exceeded max 8 attempts: mark FAILED
        logger.error(
          { eventId: event.id, eventType: event.event_type, attempts: newAttempts, err: errorMessage },
          'Outbox event reached maximum attempts (8) and marked FAILED',
        );
        await prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'FAILED', attempts = ${newAttempts}, last_error = ${errorMessage}
          WHERE id = ${event.id}::uuid
        `;
        result.failed++;
      } else {
        // Compute backoff: check if error specified retryAfter (Telegram 429) or exponential backoff
        let delaySeconds: number;
        if (err instanceof TelegramRateLimitError && err.retryAfter) {
          delaySeconds = err.retryAfter;
          logger.warn(
            { eventId: event.id, retryAfter: delaySeconds },
            'Outbox event honoring Telegram 429 retry_after',
          );
        } else {
          // Exponential backoff: 5 * 2^attempts seconds (e.g. 10s, 20s, 40s, 80s...)
          delaySeconds = Math.min(3600, Math.pow(2, newAttempts) * 5);
        }

        logger.warn(
          {
            eventId: event.id,
            eventType: event.event_type,
            attempts: newAttempts,
            delaySeconds,
            err: errorMessage,
          },
          'Outbox event failed; scheduling retry with backoff',
        );

        await prisma.$executeRaw`
          UPDATE outbox_events
          SET attempts = ${newAttempts},
              next_attempt_at = NOW() + (${delaySeconds} || ' seconds')::interval,
              last_error = ${errorMessage}
          WHERE id = ${event.id}::uuid
        `;
        result.retried++;
      }
    }
  }

  return result;
}

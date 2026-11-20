import crypto from 'node:crypto';
import { prisma } from '../../db/index.js';
import {
  ReservationStatus,
  ClaimStatus,
  NumberStatus,
  PaymentStatus,
} from '@prisma/client';
import {
  readStorageFile,
  writeStorageFile,
  deleteStorageFile,
  detectMagicBytes,
  stripExifMetadata,
} from '../storage/service.js';
import { clearSummaryCache } from '../lotteries/service.js';
import { cache, CACHE_KEYS } from '../cache/index.js';
import { getTelegramClient } from '../telegram/client.js';
import { logger } from '../../logger/index.js';

export class PaymentSubmissionError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INVALID_STATUS'
      | 'HOLD_EXPIRED'
      | 'CLAIMS_INACTIVE'
      | 'FILE_NOT_FOUND'
      | 'FILE_TOO_LARGE'
      | 'INVALID_FILE_TYPE'
      | 'SUBMISSION_ALREADY_EXISTS',
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'PaymentSubmissionError';
  }
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface SubmitPaymentInput {
  reservationId: string;
  userId: string;
  storageKey: string;
  originalFilename: string;
  claimedAmountMinor?: bigint | number | string;
  paymentReference?: string;
  requestId?: string;
}

export interface SerializedPaymentSubmission {
  id: string;
  reservationId: string;
  submittedBy: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: string;
  fileSha256: string;
  claimedAmountMinor: string | null;
  paymentReference: string | null;
  status: PaymentStatus;
  createdAt: string;
}

/**
 * Section 7.2: Submits payment proof for a reservation.
 */
export async function submitPaymentEvidence(
  input: SubmitPaymentInput,
): Promise<SerializedPaymentSubmission> {
  const {
    reservationId,
    userId,
    storageKey,
    originalFilename,
    claimedAmountMinor,
    paymentReference,
    requestId,
  } = input;

  // 1. Retrieve stored file and validate size & magic bytes
  let rawBuffer: Buffer;
  try {
    rawBuffer = await readStorageFile(storageKey);
  } catch {
    throw new PaymentSubmissionError(
      'FILE_NOT_FOUND',
      `Payment proof file does not exist at storage key: ${storageKey}`,
      400,
    );
  }

  if (rawBuffer.length > MAX_FILE_SIZE) {
    throw new PaymentSubmissionError(
      'FILE_TOO_LARGE',
      `Uploaded file size (${rawBuffer.length} bytes) exceeds maximum limit of 5 MB.`,
      413,
    );
  }

  const { isValid, mimeType } = detectMagicBytes(rawBuffer);
  if (!isValid || !mimeType) {
    throw new PaymentSubmissionError(
      'INVALID_FILE_TYPE',
      'Invalid file content. Only JPEG, PNG, WebP, and PDF files are accepted.',
      400,
    );
  }

  // 2. Strip EXIF metadata and compute SHA-256
  const sanitizedBuffer = stripExifMetadata(rawBuffer, mimeType);
  if (sanitizedBuffer.length !== rawBuffer.length) {
    await writeStorageFile(storageKey, sanitizedBuffer);
  }

  const fileSha256 = crypto.createHash('sha256').update(sanitizedBuffer).digest('hex');

  // 3. Database transaction: lock reservation and claims
  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        claims: true,
        items: true,
        user: true,
        lottery: { select: { title: true } },
      },
    });

    if (!reservation) {
      throw new PaymentSubmissionError('NOT_FOUND', 'Reservation not found.', 404);
    }

    // Owner match check
    if (reservation.userId !== userId) {
      throw new PaymentSubmissionError(
        'FORBIDDEN',
        'You do not have permission to submit payment for this reservation.',
        403,
      );
    }

    // Status check
    if (reservation.status !== ReservationStatus.AWAITING_PAYMENT) {
      throw new PaymentSubmissionError(
        'INVALID_STATUS',
        `Cannot submit payment for reservation with status ${reservation.status}. Must be AWAITING_PAYMENT.`,
        409,
      );
    }

    // Hold expiry check (using database clock)
    const dbNowResult = await tx.$queryRaw<Array<{ db_now: Date }>>`
      SELECT NOW() AS db_now
    `;
    const dbNow = dbNowResult[0]!.db_now;

    if (reservation.holdExpiresAt && reservation.holdExpiresAt < dbNow) {
      throw new PaymentSubmissionError(
        'HOLD_EXPIRED',
        'The reservation hold has expired. Please select new numbers.',
        409,
      );
    }

    // All claims must be ACTIVE and belong to this reservation
    if (
      reservation.claims.length === 0 ||
      reservation.claims.some((c) => c.status !== ClaimStatus.ACTIVE)
    ) {
      throw new PaymentSubmissionError(
        'CLAIMS_INACTIVE',
        'Reservation claims are no longer active.',
        409,
      );
    }

    // Check no open submission already exists
    const openSubmission = await tx.paymentSubmission.findFirst({
      where: {
        reservationId,
        status: PaymentStatus.SUBMITTED,
      },
    });

    if (openSubmission) {
      throw new PaymentSubmissionError(
        'SUBMISSION_ALREADY_EXISTS',
        'A payment submission is already pending review for this reservation.',
        409,
      );
    }

    // Check for duplicate SHA-256 or reference across other non-rejected submissions
    const duplicateSubmission = await tx.paymentSubmission.findFirst({
      where: {
        fileSha256,
        reservationId: { not: reservationId },
        status: { not: PaymentStatus.REJECTED },
      },
    });

    // Forward receipt photo to customer's personal Telegram chat with bot
    let finalStorageKey = storageKey;
    if (reservation.user?.telegramUserId) {
      const numbersList = reservation.items
        .map((i) => i.numberValueSnapshot)
        .sort((a, b) => a - b)
        .join(', ');
      const amountFormatted = (Number(reservation.totalAmountMinor) / 100).toFixed(2);
      const campaignTitle = reservation.lottery?.title || 'OROJACKPOT';

      const caption =
        `🧾 <b>${campaignTitle} • Payment Receipt Received!</b>\n\n` +
        `🔢 <b>Selected Numbers (${reservation.ticketCount}):</b> [ ${numbersList} ]\n` +
        `💰 <b>Amount:</b> ${amountFormatted} ETB\n` +
        `⏳ <b>Status:</b> <i>Pending Verification</i>\n\n` +
        `<i>Your payment screenshot is registered! Our verification team will review it against the official bank statement. You'll receive an instant notification here once approved!</i>`;

      try {
        const tgClient = getTelegramClient();
        if (mimeType === 'application/pdf') {
          const docRes = await tgClient.sendDocument(
            reservation.user.telegramUserId,
            sanitizedBuffer,
            originalFilename || 'receipt.pdf',
            caption,
          );
          if (docRes?.file_id) {
            finalStorageKey = `tg:${docRes.file_id}`;
          }
        } else {
          const photoRes = await tgClient.sendPhoto(
            reservation.user.telegramUserId,
            sanitizedBuffer,
            originalFilename || 'receipt.jpg',
            caption,
          );
          if (photoRes?.file_id) {
            finalStorageKey = `tg:${photoRes.file_id}`;
          }
        }
      } catch (err) {
        logger.warn(
          { err, userId, reservationId },
          'Failed to send receipt to customer chat; retaining local storage key fallback',
        );
      }
    }

    if (finalStorageKey.startsWith('tg:')) {
      await deleteStorageFile(storageKey).catch(() => {});
    }

    // Automatically lock and bind verified Telegram identity to ensure integrity and prevent manipulation
    const tgId = reservation.user?.telegramUserId ? reservation.user.telegramUserId.toString() : '';
    const tgUsername = reservation.user?.username ? `@${reservation.user.username}` : '';
    const autoTelegramIdentity = tgUsername ? `${tgUsername} (TG: ${tgId})` : (tgId ? `TG: ${tgId}` : '');

    let finalPaymentReference: string | null = null;
    if (paymentReference && paymentReference.trim()) {
      if (tgId && !paymentReference.includes(tgId)) {
        finalPaymentReference = `${autoTelegramIdentity} • ${paymentReference.trim()}`;
      } else {
        finalPaymentReference = paymentReference.trim();
      }
    } else {
      finalPaymentReference = autoTelegramIdentity || null;
    }

    // Insert payment_submission
    const submission = await tx.paymentSubmission.create({
      data: {
        reservationId,
        submittedBy: userId,
        storageKey: finalStorageKey,
        originalFilename,
        mimeType,
        fileSizeBytes: BigInt(sanitizedBuffer.length),
        fileSha256,
        claimedAmountMinor: claimedAmountMinor ? BigInt(claimedAmountMinor) : null,
        paymentReference: finalPaymentReference,
        status: PaymentStatus.SUBMITTED,
      },
    });

    // Set reservation to PENDING_REVIEW
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.PENDING_REVIEW,
        submittedAt: dbNow,
      },
    });

    // Set numbers to PENDING_REVIEW
    const numberIds = reservation.items.map((i) => i.lotteryNumberId);
    await tx.lotteryNumber.updateMany({
      where: { id: { in: numberIds } },
      data: { status: NumberStatus.PENDING_REVIEW },
    });

    // Write audit log with authentic customer Telegram identity
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'PAYMENT_SUBMITTED',
        entityType: 'PaymentSubmission',
        entityId: submission.id,
        requestId: requestId || null,
        details: {
          reservationId,
          storageKey: finalStorageKey,
          fileSha256,
          fileSizeBytes: sanitizedBuffer.length,
          isDuplicateHash: Boolean(duplicateSubmission),
          paymentReference: finalPaymentReference,
          customerTelegramId: tgId,
          customerUsername: reservation.user?.username || null,
        },
      },
    });

    // Write outbox event for admin notification
    await tx.outboxEvent.create({
      data: {
        eventType: 'ADMIN_NOTIFICATION',
        payload: {
          type: 'PAYMENT_SUBMISSION_RECEIVED',
          reservationId,
          submissionId: submission.id,
          lotteryId: reservation.lotteryId,
          ticketCount: reservation.ticketCount,
          totalAmountMinor: reservation.totalAmountMinor.toString(),
          isDuplicateHash: Boolean(duplicateSubmission),
          timestamp: new Date().toISOString(),
        },
      },
    });

    return {
      submission,
      lotteryId: reservation.lotteryId,
    };
  });

  clearSummaryCache(result.lotteryId);
  void cache.del(CACHE_KEYS.ACTIVE_HOLD(userId));

  const sub = result.submission;
  return {
    id: sub.id,
    reservationId: sub.reservationId,
    submittedBy: sub.submittedBy,
    storageKey: sub.storageKey,
    originalFilename: sub.originalFilename,
    mimeType: sub.mimeType,
    fileSizeBytes: sub.fileSizeBytes.toString(),
    fileSha256: sub.fileSha256,
    claimedAmountMinor: sub.claimedAmountMinor ? sub.claimedAmountMinor.toString() : null,
    paymentReference: sub.paymentReference,
    status: sub.status,
    createdAt: sub.createdAt.toISOString(),
  };
}

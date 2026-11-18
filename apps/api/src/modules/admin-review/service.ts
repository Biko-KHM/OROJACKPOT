import { prisma } from '../../db/index.js';
import {
  ReservationStatus,
  ClaimStatus,
  NumberStatus,
  PaymentStatus,
} from '@prisma/client';
import { generateSignedDownloadUrl } from '../storage/service.js';
import { clearSummaryCache } from '../lotteries/service.js';

export class AdminReviewError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_STATUS'
      | 'CLAIMS_INACTIVE'
      | 'BANK_RECORD_NOT_CONFIRMED'
      | 'DUAL_APPROVAL_SAME_ADMIN'
      | 'INVALID_REASON',
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AdminReviewError';
  }
}

// Configurable threshold for dual approval: amounts >= 50,000 minor (500 ETB) require 2 distinct admin approvals
export const DUAL_APPROVAL_THRESHOLD_MINOR = 50_000n;

export interface ApprovePaymentParams {
  submissionId: string;
  adminUserId: string;
  adminRole?: string;
  comparedWithBankRecord: boolean;
  note?: string;
  requestId?: string;
  dualApprovalThreshold?: bigint;
}

export interface RejectPaymentParams {
  submissionId: string;
  adminUserId: string;
  reason: string;
  comparedWithBankRecord?: boolean;
  requestId?: string;
}

export interface ApproveResult {
  decision: 'APPROVED' | 'FIRST_APPROVAL';
  submissionId: string;
  reservationId: string;
  status: string;
  reviewId: string;
}

/**
 * Section 7.3: Approves a payment submission.
 * Locks submission, reservation and claims in that order.
 * Requires: submission SUBMITTED, reservation PENDING_REVIEW, claims ACTIVE, and compared_with_bank_record = true.
 * Handles dual approval threshold if applicable.
 * Marks submission APPROVED, reservation CONFIRMED, numbers RESERVED.
 * Never approves a subset. Writes immutable payment_reviews row, audit log, and outbox event.
 */
export async function approvePaymentSubmission(
  params: ApprovePaymentParams,
): Promise<ApproveResult> {
  const {
    submissionId,
    adminUserId,
    adminRole,
    comparedWithBankRecord,
    note,
    requestId,
    dualApprovalThreshold = DUAL_APPROVAL_THRESHOLD_MINOR,
  } = params;

  if (!comparedWithBankRecord) {
    throw new AdminReviewError(
      'BANK_RECORD_NOT_CONFIRMED',
      'You must confirm comparing against the official bank record before approval.',
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock submission with FOR UPDATE
    const lockedSubmissions = await tx.$queryRaw<Array<{ id: string; reservation_id: string; status: PaymentStatus }>>`
      SELECT id, reservation_id, status
      FROM payment_submissions
      WHERE id = ${submissionId}::uuid
      FOR UPDATE
    `;

    if (lockedSubmissions.length === 0 || !lockedSubmissions[0]) {
      throw new AdminReviewError('NOT_FOUND', 'Payment submission not found.', 404);
    }
    const lockedSub = lockedSubmissions[0];

    if (lockedSub.status !== PaymentStatus.SUBMITTED) {
      throw new AdminReviewError(
        'INVALID_STATUS',
        `Payment submission is already in ${lockedSub.status} status.`,
        409,
      );
    }

    // Load submission reviews
    const reviews = await tx.paymentReview.findMany({
      where: { paymentSubmissionId: lockedSub.id },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Lock reservation with FOR UPDATE
    const lockedReservations = await tx.$queryRaw<Array<{
      id: string;
      status: ReservationStatus;
      total_amount_minor: bigint;
      user_id: string;
      lottery_id: string;
      ticket_count: number;
    }>>`
      SELECT id, status, total_amount_minor, user_id, lottery_id, ticket_count
      FROM reservations
      WHERE id = ${lockedSub.reservation_id}::uuid
      FOR UPDATE
    `;

    if (lockedReservations.length === 0 || !lockedReservations[0]) {
      throw new AdminReviewError('NOT_FOUND', 'Reservation not found.', 404);
    }
    const lockedRes = lockedReservations[0];

    if (lockedRes.status !== ReservationStatus.PENDING_REVIEW) {
      throw new AdminReviewError(
        'INVALID_STATUS',
        `Reservation is in ${lockedRes.status} status. Expected PENDING_REVIEW.`,
        409,
      );
    }

    // 3. Lock and verify all claims are ACTIVE and belong to this reservation
    const lockedClaims = await tx.$queryRaw<Array<{ id: string; status: ClaimStatus }>>`
      SELECT id, status
      FROM number_claims
      WHERE reservation_id = ${lockedRes.id}::uuid
      FOR UPDATE
    `;

    if (lockedClaims.length === 0 || lockedClaims.some((c) => c.status !== ClaimStatus.ACTIVE)) {
      throw new AdminReviewError(
        'CLAIMS_INACTIVE',
        'One or more reservation claims are no longer active.',
        409,
      );
    }

    const items = await tx.reservationItem.findMany({
      where: { reservationId: lockedRes.id },
    });

    // 4. Check Dual Approval requirement
    // Superadmins hold executive authority and can approve/finalize payments in a single step.
    // For non-superadmin reviewers, amounts exceeding threshold require two distinct administrators.
    const isSuperadmin = adminRole === 'SUPERADMIN';
    const firstApproval = reviews.find((r) => r.decision === 'FIRST_APPROVAL');

    if (!isSuperadmin && lockedRes.total_amount_minor >= dualApprovalThreshold) {
      if (!firstApproval) {
        // Record First Approval
        const review = await tx.paymentReview.create({
          data: {
            paymentSubmissionId: lockedSub.id,
            reviewerId: adminUserId,
            decision: 'FIRST_APPROVAL',
            reason: note || 'First approval recorded. Awaiting second admin confirmation.',
            comparedWithBankRecord: true,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'PAYMENT_FIRST_APPROVAL',
            entityType: 'PaymentSubmission',
            entityId: lockedSub.id,
            requestId: requestId || null,
            details: {
              reservationId: lockedRes.id,
              note,
            },
          },
        });

        return {
          decision: 'FIRST_APPROVAL' as const,
          submissionId: lockedSub.id,
          reservationId: lockedRes.id,
          status: 'PENDING_SECOND_APPROVAL',
          reviewId: review.id,
          lotteryId: lockedRes.lottery_id,
        };
      }

      // If second approval by non-superadmin, verify it is by a different admin
      if (firstApproval.reviewerId === adminUserId) {
        throw new AdminReviewError(
          'DUAL_APPROVAL_SAME_ADMIN',
          'Second approval must be performed by a different administrator.',
          409,
        );
      }
    }

    // 5. Final Approval Confirmation
    const now = new Date();

    // Mark submission APPROVED
    await tx.paymentSubmission.update({
      where: { id: lockedSub.id },
      data: { status: PaymentStatus.APPROVED },
    });

    // Mark reservation CONFIRMED
    await tx.reservation.update({
      where: { id: lockedRes.id },
      data: {
        status: ReservationStatus.CONFIRMED,
        reviewedAt: now,
        reviewedBy: adminUserId,
      },
    });

    // Mark numbers RESERVED (Never a subset)
    const numberIds = items.map((i) => i.lotteryNumberId);
    await tx.lotteryNumber.updateMany({
      where: { id: { in: numberIds } },
      data: { status: NumberStatus.RESERVED },
    });

    // Insert immutable payment_reviews row
    const review = await tx.paymentReview.create({
      data: {
        paymentSubmissionId: lockedSub.id,
        reviewerId: adminUserId,
        decision: 'APPROVED',
        reason: note || null,
        comparedWithBankRecord: true,
      },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'PAYMENT_APPROVED',
        entityType: 'PaymentSubmission',
        entityId: lockedSub.id,
        requestId: requestId || null,
        details: {
          reservationId: lockedRes.id,
          totalAmountMinor: lockedRes.total_amount_minor.toString(),
          ticketCount: lockedRes.ticket_count,
          numbers: items.map((i) => i.numberValueSnapshot),
          note,
        },
      },
    });

    // Write outbox event for customer notification
    await tx.outboxEvent.create({
      data: {
        eventType: 'CUSTOMER_NOTIFICATION',
        payload: {
          type: 'TICKETS_CONFIRMED',
          userId: lockedRes.user_id,
          reservationId: lockedRes.id,
          lotteryId: lockedRes.lottery_id,
          ticketCount: lockedRes.ticket_count,
          timestamp: now.toISOString(),
        },
      },
    });

    // Write outbox event for progress update
    await tx.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: {
          lotteryId: lockedRes.lottery_id,
          reservationId: lockedRes.id,
          action: 'CONFIRMED',
          ticketCount: lockedRes.ticket_count,
          timestamp: now.toISOString(),
        },
      },
    });

    return {
      decision: 'APPROVED' as const,
      submissionId: lockedSub.id,
      reservationId: lockedRes.id,
      status: 'CONFIRMED',
      reviewId: review.id,
      lotteryId: lockedRes.lottery_id,
    };
  });

  clearSummaryCache(result.lotteryId);

  return {
    decision: result.decision,
    submissionId: result.submissionId,
    reservationId: result.reservationId,
    status: result.status,
    reviewId: result.reviewId,
  };
}

/**
 * Section 7.4: Rejects a payment submission.
 * Locks submission, reservation and claims in that order.
 * Requires: non-empty reason, submission SUBMITTED, reservation PENDING_REVIEW.
 * Marks submission REJECTED, reservation REJECTED.
 * Releases ONLY this reservation's claims.
 * Sets numbers AVAILABLE (guaranteeing another buyer's active claim is never released).
 * Repeating the request returns 409 Conflict.
 */
export async function rejectPaymentSubmission(
  params: RejectPaymentParams,
): Promise<{ submissionId: string; reservationId: string; status: string; reviewId: string }> {
  const { submissionId, adminUserId, reason, comparedWithBankRecord, requestId } = params;

  if (!reason || reason.trim().length < 3) {
    throw new AdminReviewError('INVALID_REASON', 'Rejection reason must be at least 3 characters.', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock submission with FOR UPDATE
    const lockedSubmissions = await tx.$queryRaw<Array<{ id: string; reservation_id: string; status: PaymentStatus }>>`
      SELECT id, reservation_id, status
      FROM payment_submissions
      WHERE id = ${submissionId}::uuid
      FOR UPDATE
    `;

    if (lockedSubmissions.length === 0 || !lockedSubmissions[0]) {
      throw new AdminReviewError('NOT_FOUND', 'Payment submission not found.', 404);
    }
    const lockedSub = lockedSubmissions[0];

    if (lockedSub.status !== PaymentStatus.SUBMITTED) {
      throw new AdminReviewError(
        'INVALID_STATUS',
        `Payment submission is already in ${lockedSub.status} status.`,
        409,
      );
    }

    // 2. Lock reservation with FOR UPDATE
    const lockedReservations = await tx.$queryRaw<Array<{
      id: string;
      status: ReservationStatus;
      user_id: string;
      lottery_id: string;
      ticket_count: number;
    }>>`
      SELECT id, status, user_id, lottery_id, ticket_count
      FROM reservations
      WHERE id = ${lockedSub.reservation_id}::uuid
      FOR UPDATE
    `;

    if (lockedReservations.length === 0 || !lockedReservations[0]) {
      throw new AdminReviewError('NOT_FOUND', 'Reservation not found.', 404);
    }
    const lockedRes = lockedReservations[0];

    if (lockedRes.status !== ReservationStatus.PENDING_REVIEW) {
      throw new AdminReviewError(
        'INVALID_STATUS',
        `Reservation is in ${lockedRes.status} status. Expected PENDING_REVIEW.`,
        409,
      );
    }

    const items = await tx.reservationItem.findMany({
      where: { reservationId: lockedRes.id },
    });

    const now = new Date();

    // 3. Mark submission REJECTED
    await tx.paymentSubmission.update({
      where: { id: lockedSub.id },
      data: { status: PaymentStatus.REJECTED },
    });

    // 4. Mark reservation REJECTED
    await tx.reservation.update({
      where: { id: lockedRes.id },
      data: {
        status: ReservationStatus.REJECTED,
        rejectionReason: reason.trim(),
        reviewedAt: now,
        reviewedBy: adminUserId,
      },
    });

    // 5. Release ONLY this reservation's active claims
    await tx.numberClaim.updateMany({
      where: {
        reservationId: lockedRes.id,
        status: ClaimStatus.ACTIVE,
      },
      data: {
        status: ClaimStatus.RELEASED,
        releasedAt: now,
      },
    });

    // 6. Reset numbers to AVAILABLE ONLY IF no other active claim exists on the number
    // This strictly protects against releasing another buyer's re-held or reserved claims
    const numberIds = items.map((i) => i.lotteryNumberId);
    if (numberIds.length > 0) {
      await tx.$executeRaw`
        UPDATE lottery_numbers
        SET status = 'AVAILABLE', updated_at = NOW()
        WHERE id = ANY(${numberIds}::uuid[])
          AND status IN ('PENDING_REVIEW', 'HELD')
          AND NOT EXISTS (
            SELECT 1 FROM number_claims
            WHERE number_claims.lottery_number_id = lottery_numbers.id
              AND number_claims.status = 'ACTIVE'
          )
      `;
    }

    // 7. Insert immutable payment_reviews row
    const review = await tx.paymentReview.create({
      data: {
        paymentSubmissionId: lockedSub.id,
        reviewerId: adminUserId,
        decision: 'REJECTED',
        reason: reason.trim(),
        comparedWithBankRecord: Boolean(comparedWithBankRecord),
      },
    });

    // 8. Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'PAYMENT_REJECTED',
        entityType: 'PaymentSubmission',
        entityId: lockedSub.id,
        requestId: requestId || null,
        details: {
          reservationId: lockedRes.id,
          reason: reason.trim(),
        },
      },
    });

    // 9. Write outbox event for customer rejection notice
    await tx.outboxEvent.create({
      data: {
        eventType: 'CUSTOMER_NOTIFICATION',
        payload: {
          type: 'PAYMENT_REJECTED',
          userId: lockedRes.user_id,
          reservationId: lockedRes.id,
          lotteryId: lockedRes.lottery_id,
          reason: reason.trim(),
          timestamp: now.toISOString(),
        },
      },
    });

    // 10. Write outbox event for progress update
    await tx.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: {
          lotteryId: lockedRes.lottery_id,
          reservationId: lockedRes.id,
          action: 'REJECTED',
          ticketCount: lockedRes.ticket_count,
          timestamp: now.toISOString(),
        },
      },
    });

    return {
      submissionId: lockedSub.id,
      reservationId: lockedRes.id,
      status: 'REJECTED',
      reviewId: review.id,
      lotteryId: lockedRes.lottery_id,
    };
  });

  clearSummaryCache(result.lotteryId);

  return {
    submissionId: result.submissionId,
    reservationId: result.reservationId,
    status: result.status,
    reviewId: result.reviewId,
  };
}

/**
 * Returns a 5-minute signed URL for viewing payment evidence, and writes an audit row.
 */
export async function getPaymentEvidenceUrl(
  submissionId: string,
  adminUserId: string,
  requestId?: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number; mimeType: string }> {
  const submission = await prisma.paymentSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!submission) {
    throw new AdminReviewError('NOT_FOUND', 'Payment submission not found.', 404);
  }

  const { downloadUrl, expiresInSeconds } = generateSignedDownloadUrl(
    submission.storageKey,
    submission.originalFilename,
    300,
    submission.mimeType,
  );

  // Write audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'EVIDENCE_VIEWED',
      entityType: 'PaymentSubmission',
      entityId: submission.id,
      requestId: requestId || null,
      details: {
        storageKey: submission.storageKey,
        originalFilename: submission.originalFilename,
        fileSizeBytes: submission.fileSizeBytes.toString(),
      },
    },
  });

  return { downloadUrl, expiresInSeconds, mimeType: submission.mimeType };
}

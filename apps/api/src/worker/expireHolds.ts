import { prisma } from '../db/index.js';
import { ReservationStatus, ClaimStatus } from '@prisma/client';
import { clearSummaryCache } from '../modules/lotteries/service.js';

export interface ExpireHoldsResult {
  expiredCount: number;
  releasedClaimsCount: number;
  affectedLotteryIds: string[];
}

/**
 * Section 7.5: Selects a batch of AWAITING_PAYMENT reservations with hold_expires_at < now()
 * using FOR UPDATE SKIP LOCKED. Re-checks status inside the transaction.
 * Marks EXPIRED, releases claims, sets numbers AVAILABLE, writes audit and outbox events.
 * Safe to run twice or in parallel. Never touches PENDING_REVIEW.
 * Does not reset numbers if already re-held by another buyer.
 */
export async function expireHolds(batchSize = 100): Promise<ExpireHoldsResult> {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock expired AWAITING_PAYMENT reservations using FOR UPDATE SKIP LOCKED
    const candidates = await tx.$queryRaw<Array<{ id: string; lottery_id: string }>>`
      SELECT id, lottery_id
      FROM reservations
      WHERE status = 'AWAITING_PAYMENT'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at < NOW()
      ORDER BY hold_expires_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (candidates.length === 0) {
      return {
        expiredCount: 0,
        releasedClaimsCount: 0,
        affectedLotteryIds: [] as string[],
      };
    }

    const candidateIds = candidates.map((c) => c.id);
    const uniqueLotteryIds = Array.from(new Set(candidates.map((c) => c.lottery_id)));

    // 2. Mark reservations as EXPIRED
    await tx.reservation.updateMany({
      where: {
        id: { in: candidateIds },
        status: ReservationStatus.AWAITING_PAYMENT,
      },
      data: {
        status: ReservationStatus.EXPIRED,
      },
    });

    // 3. Mark only these reservations' ACTIVE claims as RELEASED
    const releasedClaimsResult = await tx.numberClaim.updateMany({
      where: {
        reservationId: { in: candidateIds },
        status: ClaimStatus.ACTIVE,
      },
      data: {
        status: ClaimStatus.RELEASED,
        releasedAt: new Date(),
      },
    });

    // 4. Find all lottery numbers associated with these reservations
    const items = await tx.reservationItem.findMany({
      where: { reservationId: { in: candidateIds } },
      select: { lotteryNumberId: true },
    });
    const numberIds = items.map((i) => i.lotteryNumberId);

    // 5. Set numbers to AVAILABLE ONLY IF:
    // - Number is currently HELD
    // - There are NO OTHER ACTIVE claims on this number (guarantees re-held numbers are untouched)
    if (numberIds.length > 0) {
      await tx.$executeRaw`
        UPDATE lottery_numbers
        SET status = 'AVAILABLE', updated_at = NOW()
        WHERE id = ANY(${numberIds}::uuid[])
          AND status = 'HELD'
          AND NOT EXISTS (
            SELECT 1 FROM number_claims
            WHERE number_claims.lottery_number_id = lottery_numbers.id
              AND number_claims.status = 'ACTIVE'
          )
      `;
    }

    // 6. Append audit logs and outbox events for each expired reservation
    for (const candidate of candidates) {
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: 'RESERVATION_EXPIRED',
          entityType: 'Reservation',
          entityId: candidate.id,
          details: {
            reason: 'Hold timer expired before payment submission',
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'PROGRESS_UPDATE',
          payload: {
            lotteryId: candidate.lottery_id,
            reservationId: candidate.id,
            action: 'EXPIRED',
            timestamp: new Date().toISOString(),
          },
        },
      });
    }

    return {
      expiredCount: candidates.length,
      releasedClaimsCount: releasedClaimsResult.count,
      affectedLotteryIds: uniqueLotteryIds,
    };
  });

  // Invalidate in-memory lottery numbers summary cache for affected lotteries
  for (const lotteryId of result.affectedLotteryIds) {
    clearSummaryCache(lotteryId);
  }

  return result;
}

import { prisma } from '../../db/index.js';
import { LotteryStatus, NumberStatus, ReservationStatus } from '@prisma/client';
import {
  CreateLotteryRequest,
  UpdateLotteryRequest,
  LotteryNumbersSummary,
  NumberStatusRange,
} from '@tg-lottery/shared';

import { cache, CACHE_KEYS } from '../cache/index.js';
import { deleteCampaignImageFromSupabase } from './storage.js';
import { getTelegramClient } from '../telegram/client.js';
import { getPlatformTelegramChannelId } from '../platform/settings.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';

export class LotteryError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_STATE_TRANSITION'
      | 'INVALID_RANGE'
      | 'CANNOT_SHRINK_HELD_NUMBERS'
      | 'INVALID_STATE'
      | 'INVALID_WINNING_NUMBER'
      | 'CONFLICT',
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = 'LotteryError';
  }
}

/**
 * Invalidates public number summaries and campaign listings across Redis & in-memory cache.
 */
export function clearSummaryCache(lotteryId?: string) {
  if (lotteryId) {
    void cache.del(CACHE_KEYS.NUMBERS_SUMMARY(lotteryId), CACHE_KEYS.LOTTERY(lotteryId));
    void cache.del(CACHE_KEYS.OPEN_LOTTERIES, CACHE_KEYS.ALL_LOTTERIES);
  } else {
    void cache.delPattern('cache:lottery:*');
    void cache.del(CACHE_KEYS.OPEN_LOTTERIES, CACHE_KEYS.ALL_LOTTERIES);
  }
}

// 1. Create Campaign (DRAFT)
export async function createLottery(
  data: CreateLotteryRequest,
  adminUserId: string,
  requestId?: string,
) {
  const existing = await prisma.lottery.findUnique({
    where: { slug: data.slug },
  });

  if (existing) {
    throw new LotteryError('CONFLICT', `A campaign with slug '${data.slug}' already exists.`, 409);
  }

  const lottery = await prisma.lottery.create({
    data: {
      slug: data.slug,
      title: data.title,
      description: data.description,
      prizeDescription: data.prizeDescription,
      imageUrl: data.imageUrl || null,
      status: LotteryStatus.DRAFT,
      currency: 'ETB',
      ticketPriceMinor: data.ticketPriceMinor,
      numberStart: data.numberStart,
      numberEnd: data.numberEnd,
      maxNumbersPerPurchase: data.maxNumbersPerPurchase,
      holdMinutes: data.holdMinutes,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
      paymentInstructions: data.paymentInstructions,
      createdBy: adminUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_CREATED',
      entityType: 'LOTTERY',
      entityId: lottery.id,
      requestId,
      details: { slug: lottery.slug, title: lottery.title, status: lottery.status },
    },
  });

  return serializeLottery(lottery);
}

// 2. Publish Campaign (DRAFT -> OPEN) & Generate Numbers atomically
export async function publishLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  return prisma.$transaction(async (tx) => {
    const lottery = await tx.lottery.findUnique({
      where: { id: lotteryId },
    });

    if (!lottery) {
      throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
    }

    if (lottery.status !== LotteryStatus.DRAFT) {
      throw new LotteryError(
        'INVALID_STATE_TRANSITION',
        `Cannot publish campaign in status ${lottery.status}. Only DRAFT campaigns can be published.`,
        409,
      );
    }

    // Generate inventory numbers if not yet generated
    const existingCount = await tx.lotteryNumber.count({
      where: { lotteryId: lottery.id },
    });

    if (existingCount === 0) {
      const BATCH_SIZE = 2000;
      let batch = [];
      for (let num = lottery.numberStart; num <= lottery.numberEnd; num++) {
        batch.push({
          lotteryId: lottery.id,
          numberValue: num,
          status: NumberStatus.AVAILABLE,
        });
        if (batch.length >= BATCH_SIZE) {
          await tx.lotteryNumber.createMany({ data: batch });
          batch = [];
        }
      }
      if (batch.length > 0) {
        await tx.lotteryNumber.createMany({ data: batch });
      }
    }

    const updated = await tx.lottery.update({
      where: { id: lotteryId },
      data: { status: LotteryStatus.OPEN },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'LOTTERY_PUBLISHED',
        entityType: 'LOTTERY',
        entityId: lottery.id,
        requestId,
        details: { fromStatus: lottery.status, toStatus: LotteryStatus.OPEN },
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: 'CAMPAIGN_ANNOUNCEMENT',
        payload: {
          lotteryId: lottery.id,
          title: lottery.title,
          prize: lottery.prizeDescription,
          ticketPriceMinor: lottery.ticketPriceMinor.toString(),
          totalNumbers: lottery.numberEnd - lottery.numberStart + 1,
          slug: lottery.slug,
          timestamp: new Date().toISOString(),
        },
      },
    });

    clearSummaryCache(lotteryId);
    return serializeLottery(updated);
  });
}

// 3. Pause Campaign (OPEN -> PAUSED)
export async function pauseLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  if (lottery.status !== LotteryStatus.OPEN) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot pause campaign in status ${lottery.status}. Only OPEN campaigns can be paused.`,
      409,
    );
  }

  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { status: LotteryStatus.PAUSED },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_PAUSED',
      entityType: 'LOTTERY',
      entityId: lottery.id,
      requestId,
    },
  });

  clearSummaryCache(lotteryId);
  return serializeLottery(updated);
}

// 4. Resume Campaign (PAUSED -> OPEN)
export async function resumeLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  if (lottery.status !== LotteryStatus.PAUSED) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot resume campaign in status ${lottery.status}. Only PAUSED campaigns can be resumed.`,
      409,
    );
  }

  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { status: LotteryStatus.OPEN },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_RESUMED',
      entityType: 'LOTTERY',
      entityId: lottery.id,
      requestId,
    },
  });

  clearSummaryCache(lotteryId);
  return serializeLottery(updated);
}

// 5. Close Campaign (OPEN | PAUSED -> CLOSED)
export async function closeLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  if (lottery.status !== LotteryStatus.OPEN && lottery.status !== LotteryStatus.PAUSED) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot close campaign in status ${lottery.status}. Only OPEN or PAUSED campaigns can be closed.`,
      409,
    );
  }

  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { status: LotteryStatus.CLOSED },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_CLOSED',
      entityType: 'LOTTERY',
      entityId: lottery.id,
      requestId,
    },
  });

  clearSummaryCache(lotteryId);
  return serializeLottery(updated);
}

// 6. Cancel Campaign (OPEN | PAUSED | CLOSED -> CANCELLED)
export async function cancelLottery(
  lotteryId: string,
  adminUserId: string,
  reason?: string,
  requestId?: string,
) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  const allowedStatuses: LotteryStatus[] = [
    LotteryStatus.OPEN,
    LotteryStatus.PAUSED,
    LotteryStatus.CLOSED,
  ];

  if (!allowedStatuses.includes(lottery.status)) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot cancel campaign in status ${lottery.status}.`,
      409,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.lottery.update({
      where: { id: lotteryId },
      data: { status: LotteryStatus.CANCELLED },
    });

    // FR-29: Find confirmed reservations and create PENDING refund rows
    const confirmedReservations = await tx.reservation.findMany({
      where: { lotteryId, status: ReservationStatus.CONFIRMED },
    });

    for (const r of confirmedReservations) {
      await tx.refund.create({
        data: {
          reservationId: r.id,
          amountMinor: r.totalAmountMinor,
          status: 'PENDING',
          note: reason ? `Lottery cancelled: ${reason}` : 'Lottery cancelled',
        },
      });
    }

    // Release any active unreleased claims
    const activeClaims = await tx.numberClaim.findMany({
      where: {
        lotteryNumber: { lotteryId },
        releasedAt: null,
      },
      select: { id: true },
    });

    if (activeClaims.length > 0) {
      const now = new Date();
      await tx.numberClaim.updateMany({
        where: { id: { in: activeClaims.map((c) => c.id) } },
        data: { releasedAt: now },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'LOTTERY_CANCELLED',
        entityType: 'LOTTERY',
        entityId: lottery.id,
        requestId,
        details: { reason, refundCount: confirmedReservations.length },
      },
    });

    return res;
  });

  clearSummaryCache(lotteryId);
  return serializeLottery(updated);
}


// 7. Archive Campaign (COMPLETED | CANCELLED -> ARCHIVED)
export async function archiveLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  const allowedStatuses: LotteryStatus[] = [
    LotteryStatus.DRAFT,
    LotteryStatus.COMPLETED,
    LotteryStatus.CANCELLED,
  ];

  if (!allowedStatuses.includes(lottery.status)) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot archive campaign in status ${lottery.status}. Only DRAFT, COMPLETED or CANCELLED campaigns can be archived.`,
      409,
    );
  }

  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { status: LotteryStatus.ARCHIVED },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_ARCHIVED',
      entityType: 'LOTTERY',
      entityId: lottery.id,
      requestId,
    },
  });

  clearSummaryCache(lotteryId);
  return serializeLottery(updated);
}

// 7.1 Permanent Deletion of Campaign (Allowed as Final Act for ARCHIVED campaigns)
export async function deleteLottery(lotteryId: string, adminUserId: string, requestId?: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  // Require campaign to be in ARCHIVED status as the final act
  if (lottery.status !== LotteryStatus.ARCHIVED) {
    throw new LotteryError(
      'INVALID_STATE_TRANSITION',
      `Cannot permanently delete campaign in status "${lottery.status}". A campaign must first be archived before permanent deletion.`,
      409,
    );
  }

  // Delete image from Supabase Storage bucket if it exists
  if (lottery.imageUrl) {
    try {
      await deleteCampaignImageFromSupabase(lottery.imageUrl);
    } catch {
      // ignore storage cleanup failure so DB deletion proceeds
    }
  }

  // Atomically delete all associated campaign records
  await prisma.$transaction(async (tx) => {
    // 1. Channel posts
    await tx.channelPost.deleteMany({ where: { lotteryId } });

    // 2. Draws & Draw Commitments
    await tx.draw.deleteMany({ where: { lotteryId } });
    await tx.drawCommitment.deleteMany({ where: { lotteryId } });

    // 3. Reservations & their dependents (payment reviews, submissions, claims, items)
    const reservations = await tx.reservation.findMany({
      where: { lotteryId },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);

    if (reservationIds.length > 0) {
      await tx.refund.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });

      const submissions = await tx.paymentSubmission.findMany({
        where: { reservationId: { in: reservationIds } },
        select: { id: true },
      });
      const submissionIds = submissions.map((s) => s.id);

      if (submissionIds.length > 0) {
        await tx.paymentReview.deleteMany({
          where: { paymentSubmissionId: { in: submissionIds } },
        });
        await tx.paymentSubmission.deleteMany({
          where: { id: { in: submissionIds } },
        });
      }

      await tx.numberClaim.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await tx.reservationItem.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await tx.reservation.deleteMany({
        where: { id: { in: reservationIds } },
      });
    }

    // 4. Lottery numbers
    await tx.lotteryNumber.deleteMany({ where: { lotteryId } });

    // 5. Lottery record itself
    await tx.lottery.delete({ where: { id: lotteryId } });
  });

  // 6. Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_DELETED',
      entityType: 'LOTTERY',
      entityId: lotteryId,
      details: { title: lottery.title, slug: lottery.slug },
      requestId,
    },
  });

  clearSummaryCache(lotteryId);

  return {
    success: true,
    message: `Campaign "${lottery.title}" and all its records have been permanently erased from the database.`,
  };
}

// 8. Edit Campaign with Range Rules (FR-14 & FR-15)
export async function updateLottery(
  lotteryId: string,
  data: UpdateLotteryRequest,
  adminUserId: string,
  requestId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const lottery = await tx.lottery.findUnique({
      where: { id: lotteryId },
    });

    if (!lottery) {
      throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
    }

    if (lottery.status === LotteryStatus.ARCHIVED || lottery.status === LotteryStatus.COMPLETED) {
      throw new LotteryError(
        'INVALID_STATE_TRANSITION',
        `Cannot edit a campaign in ${lottery.status} status.`,
        409,
      );
    }

    let newNumberEnd = lottery.numberEnd;

    if (data.numberEnd !== undefined && data.numberEnd !== lottery.numberEnd) {
      newNumberEnd = data.numberEnd;

      if (newNumberEnd < lottery.numberStart) {
        throw new LotteryError('INVALID_RANGE', 'numberEnd cannot be less than numberStart.', 400);
      }
      if (newNumberEnd - lottery.numberStart >= 10000) {
        throw new LotteryError('INVALID_RANGE', 'Campaign cannot exceed 10,000 numbers.', 400);
      }

      // If the campaign is already published, handle inventory adjustments
      if (lottery.status !== LotteryStatus.DRAFT) {
        if (newNumberEnd > lottery.numberEnd) {
          // Range expands: insert new AVAILABLE numbers
          const numbersToInsert = [];
          for (let n = lottery.numberEnd + 1; n <= newNumberEnd; n++) {
            numbersToInsert.push({
              lotteryId: lottery.id,
              numberValue: n,
              status: NumberStatus.AVAILABLE,
            });
          }
          await tx.lotteryNumber.createMany({ data: numbersToInsert });
        } else {
          // Range shrinks: only allowed if removed numbers are all AVAILABLE with no claims (FR-14)
          const removedNumbers = await tx.lotteryNumber.findMany({
            where: {
              lotteryId: lottery.id,
              numberValue: { gt: newNumberEnd },
            },
            include: { claims: { where: { status: 'ACTIVE' } } },
          });

          const hasNonAvailable = removedNumbers.some(
            (num) => num.status !== NumberStatus.AVAILABLE || num.claims.length > 0,
          );

          if (hasNonAvailable) {
            throw new LotteryError(
              'CANNOT_SHRINK_HELD_NUMBERS',
              'Cannot shrink number range because some of the removed numbers are held, reserved, or claimed.',
              409,
            );
          }

          // Delete removed numbers
          await tx.lotteryNumber.deleteMany({
            where: {
              lotteryId: lottery.id,
              numberValue: { gt: newNumberEnd },
            },
          });
        }
      }
    }

    const updated = await tx.lottery.update({
      where: { id: lotteryId },
      data: {
        title: data.title ?? lottery.title,
        description: data.description !== undefined ? data.description : lottery.description,
        prizeDescription: data.prizeDescription ?? lottery.prizeDescription,
        ticketPriceMinor: data.ticketPriceMinor ?? lottery.ticketPriceMinor,
        numberEnd: newNumberEnd,
        maxNumbersPerPurchase: data.maxNumbersPerPurchase ?? lottery.maxNumbersPerPurchase,
        holdMinutes: data.holdMinutes ?? lottery.holdMinutes,
        startsAt: data.startsAt !== undefined ? (data.startsAt ? new Date(data.startsAt) : null) : lottery.startsAt,
        endsAt: data.endsAt !== undefined ? (data.endsAt ? new Date(data.endsAt) : null) : lottery.endsAt,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : lottery.imageUrl,
        drawLiveUrl: data.drawLiveUrl !== undefined ? data.drawLiveUrl : lottery.drawLiveUrl,
        paymentInstructions:
          data.paymentInstructions !== undefined
            ? data.paymentInstructions
            : lottery.paymentInstructions,
      },
    });

    // If campaign image was replaced with a new one or cleared, clean up old Supabase image
    if (data.imageUrl !== undefined && data.imageUrl !== lottery.imageUrl && lottery.imageUrl) {
      void deleteCampaignImageFromSupabase(lottery.imageUrl);
    }

    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'LOTTERY_UPDATED',
        entityType: 'LOTTERY',
        entityId: lottery.id,
        requestId,
        details: {
          changes: {
            ...data,
            ticketPriceMinor:
              data.ticketPriceMinor !== undefined ? String(data.ticketPriceMinor) : undefined,
          },
        },
      },
    });

    clearSummaryCache(lotteryId);
    return serializeLottery(updated);
  });
}

// 9. List Campaigns (Cached in Redis / Memory for 30s)
export async function getLotteries(filters?: { status?: LotteryStatus | LotteryStatus[] }) {
  const isCustomerHomeQuery =
    !filters ||
    (Array.isArray(filters.status) &&
      filters.status.includes(LotteryStatus.OPEN) &&
      filters.status.length <= 4) ||
    filters.status === LotteryStatus.OPEN;

  const cacheKey = isCustomerHomeQuery ? CACHE_KEYS.OPEN_LOTTERIES : null;
  if (cacheKey) {
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) return cached;
  }

  const where = filters?.status
    ? Array.isArray(filters.status)
      ? { status: { in: filters.status } }
      : { status: filters.status }
    : {};
  const lotteries = await prisma.lottery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const lotteryIds = lotteries.map((l) => l.id);
  const reservedCounts = await prisma.lotteryNumber.groupBy({
    by: ['lotteryId'],
    where: {
      lotteryId: { in: lotteryIds },
      status: { in: [NumberStatus.RESERVED, NumberStatus.PENDING_REVIEW] },
    },
    _count: {
      id: true,
    },
  });
  const countMap = new Map(reservedCounts.map((r) => [r.lotteryId, r._count.id]));

  // Query completed draws to attach latestDraw for celebratory UI
  const draws = await prisma.draw.findMany({
    where: { lotteryId: { in: lotteryIds } },
    orderBy: { createdAt: 'desc' },
  });
  const drawMap = new Map<string, { id: string; prizeLabel: string; winningNumber: number; drawOrder: number; createdAt: string }>();
  for (const d of draws) {
    if (!drawMap.has(d.lotteryId)) {
      drawMap.set(d.lotteryId, {
        id: d.id,
        prizeLabel: d.prizeLabel,
        winningNumber: d.winningNumber,
        drawOrder: d.drawOrder,
        createdAt: d.createdAt.toISOString(),
      });
    }
  }

  const result = lotteries.map((lottery) => {
    const totalNumbers = lottery.numberEnd - lottery.numberStart + 1;
    const reservedNumbers = countMap.get(lottery.id) || 0;
    const availableNumbers = Math.max(0, totalNumbers - reservedNumbers);
    return {
      ...serializeLottery(lottery),
      totalNumbers,
      reservedNumbers,
      availableNumbers,
      latestDraw: drawMap.get(lottery.id) || null,
    };
  });

  if (cacheKey) {
    await cache.set(cacheKey, result, 30); // 30s TTL
  }

  return result;
}

// 10. Get Single Campaign (Cached in Redis / Memory for 60s)
export async function getLotteryById(lotteryId: string) {
  const cacheKey = CACHE_KEYS.LOTTERY(lotteryId);
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    return cached;
  }

  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
  });

  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }

  const reservedCount = await prisma.lotteryNumber.count({
    where: {
      lotteryId,
      status: { in: [NumberStatus.RESERVED, NumberStatus.PENDING_REVIEW] },
    },
  });

  const latestDraw = await prisma.draw.findFirst({
    where: { lotteryId },
    orderBy: { createdAt: 'desc' },
  });

  const totalNumbers = lottery.numberEnd - lottery.numberStart + 1;
  const availableNumbers = Math.max(0, totalNumbers - reservedCount);

  const result = {
    ...serializeLottery(lottery),
    totalNumbers,
    reservedNumbers: reservedCount,
    availableNumbers,
    latestDraw: latestDraw
      ? {
          id: latestDraw.id,
          prizeLabel: latestDraw.prizeLabel,
          winningNumber: latestDraw.winningNumber,
          drawOrder: latestDraw.drawOrder,
          createdAt: latestDraw.createdAt.toISOString(),
        }
      : null,
  };

  await cache.set(cacheKey, result, 60); // 60s TTL
  return result;
}

// 11. Compact Numbers Summary (Micro-cached in Redis / Memory for 3 seconds)
export async function getLotteryNumbersSummary(lotteryId: string): Promise<LotteryNumbersSummary> {
  const cacheKey = CACHE_KEYS.NUMBERS_SUMMARY(lotteryId);
  const cached = await cache.get<LotteryNumbersSummary>(cacheKey);

  if (cached) {
    return cached;
  }

  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
  });

  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }

  const totalNumbers = lottery.numberEnd - lottery.numberStart + 1;

  // Ultra-Fast Sparse Query: Only fetch numbers that are NOT AVAILABLE (HELD, PENDING_REVIEW, RESERVED)
  // In an active campaign, 90-99% of numbers are AVAILABLE. Fetching exceptions reduces DB payload by up to 98%.
  const nonAvailableNumbers = await prisma.lotteryNumber.findMany({
    where: {
      lotteryId,
      status: { not: NumberStatus.AVAILABLE },
    },
    orderBy: { numberValue: 'asc' },
    select: { numberValue: true, status: true },
  });

  const counts: Record<string, number> = {
    AVAILABLE: 0,
    HELD: 0,
    PENDING_REVIEW: 0,
    RESERVED: 0,
  };

  const nonAvailableMap = new Map<number, NumberStatus>();
  for (const n of nonAvailableNumbers) {
    nonAvailableMap.set(n.numberValue, n.status);
    counts[n.status] = (counts[n.status] ?? 0) + 1;
  }
  counts.AVAILABLE = Math.max(0, totalNumbers - nonAvailableNumbers.length);

  const ranges: NumberStatusRange[] = [];
  let currentRange: NumberStatusRange | null = null;

  for (let num = lottery.numberStart; num <= lottery.numberEnd; num++) {
    const status = nonAvailableMap.get(num) || NumberStatus.AVAILABLE;

    if (!currentRange) {
      currentRange = { start: num, end: num, status };
    } else if (currentRange.status === status && num === currentRange.end + 1) {
      currentRange.end = num;
    } else {
      ranges.push(currentRange);
      currentRange = { start: num, end: num, status };
    }
  }

  if (currentRange) {
    ranges.push(currentRange);
  }

  const summaryResult: LotteryNumbersSummary = {
    lotteryId,
    totalNumbers,
    counts,
    ranges,
    cachedAt: new Date().toISOString(),
  };

  // Cache in Redis for 3 seconds (reduces polling storm from hundreds of clients)
  await cache.set(cacheKey, summaryResult, 3);

  return summaryResult;
}

// 12. Complete Manual Offline Draw (Superadmin / Admin finishes campaign with manual winning number & draw video / live link)
export async function completeManualDraw({
  lotteryId,
  adminUserId,
  winningNumber,
  prizeLabel,
  drawVideoUrl,
  drawLiveUrl,
  requestId,
}: {
  lotteryId: string;
  adminUserId: string;
  winningNumber: number;
  prizeLabel?: string;
  drawVideoUrl?: string;
  drawLiveUrl?: string;
  requestId?: string;
}) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }

  if (lottery.status === LotteryStatus.ARCHIVED || lottery.status === LotteryStatus.CANCELLED) {
    throw new LotteryError('INVALID_STATE', `Cannot complete a draw on a ${lottery.status} campaign.`, 400);
  }

  if (winningNumber < lottery.numberStart || winningNumber > lottery.numberEnd) {
    throw new LotteryError(
      'INVALID_WINNING_NUMBER',
      `Winning number #${winningNumber} is outside the campaign range (${lottery.numberStart} - ${lottery.numberEnd}).`,
      400,
    );
  }

  const label = (prizeLabel || lottery.prizeDescription || 'Grand Prize').trim();

  // Insert immutable Draw record
  const draw = await prisma.draw.create({
    data: {
      lotteryId,
      prizeLabel: label,
      drawOrder: 1,
      eligibleCount: lottery.numberEnd - lottery.numberStart + 1,
      eligibleSetSha256: 'manual-offline-draw-v1.0',
      randomSeed: 'manual-offline-draw',
      winningNumber,
      winningIndex: Math.max(0, winningNumber - lottery.numberStart),
      algorithmVersion: 'MANUAL-DRAW-v1.0',
      runBy: adminUserId,
      verificationProof: {
        type: 'MANUAL_OFFLINE_DRAW',
        winningNumber,
        completedAt: new Date().toISOString(),
        hasDrawVideo: Boolean(drawVideoUrl),
        drawLiveUrl: drawLiveUrl || null,
      },
    },
  });

  // Mark lottery COMPLETED and record drawVideoUrl and drawLiveUrl
  const updatedLottery = await prisma.lottery.update({
    where: { id: lotteryId },
    data: {
      status: LotteryStatus.COMPLETED,
      ...(drawVideoUrl ? { drawVideoUrl } : {}),
      ...(drawLiveUrl !== undefined ? { drawLiveUrl: drawLiveUrl.trim() || null } : {}),
    },
  });

  // Invalidate caches
  await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
  await cache.del(CACHE_KEYS.OPEN_LOTTERIES);
  await cache.del(CACHE_KEYS.ALL_LOTTERIES);
  await cache.del(CACHE_KEYS.NUMBERS_SUMMARY(lotteryId));

  // Write audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_MANUAL_DRAW_COMPLETED',
      entityType: 'LOTTERY',
      entityId: lotteryId,
      details: {
        winningNumber,
        prizeLabel: label,
        drawId: draw.id,
        drawVideoUrl: drawVideoUrl || null,
        drawLiveUrl: drawLiveUrl || null,
        requestId,
      },
    },
  });

  // Broadcast winner to Telegram channel if configured in Settings
  try {
    const channelId = getPlatformTelegramChannelId();
    if (channelId && config.TELEGRAM_BOT_TOKEN && !config.TELEGRAM_BOT_TOKEN.includes('dummy')) {
      const client = getTelegramClient();
      const text =
        `🎉 <b>LOTTERY WINNER ANNOUNCED!</b> 🎉\n\n` +
        `🏆 Campaign: <b>${lottery.title}</b>\n` +
        `🎁 Prize: <b>${label}</b>\n` +
        `🎟 Lucky Winning Number: <b>#${winningNumber}</b>\n\n` +
        `Congratulations to the lucky ticket holder!\nOpen the Mini App to verify your tickets.`;
      await client.sendMessage(channelId, text);
    }
  } catch (err) {
    logger.warn({ err }, 'Could not broadcast winner to Telegram channel');
  }

  return {
    lottery: serializeLottery(updatedLottery),
    draw,
  };
}

// 13. Update Lottery Draw Video (Attach or replace draw video on completed campaign)
export async function updateLotteryDrawVideo(lotteryId: string, drawVideoUrl: string, adminUserId: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }
  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { drawVideoUrl },
  });
  await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
  await cache.del(CACHE_KEYS.OPEN_LOTTERIES);
  await cache.del(CACHE_KEYS.ALL_LOTTERIES);
  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_DRAW_VIDEO_UPDATED',
      entityType: 'LOTTERY',
      entityId: lotteryId,
      details: { drawVideoUrl },
    },
  });
  return serializeLottery(updated);
}

// 14. Update Lottery Live Stream URL (Set TikTok / Social Live link during draw process)
export async function updateLotteryDrawLiveUrl(lotteryId: string, drawLiveUrl: string, adminUserId: string) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }
  const updated = await prisma.lottery.update({
    where: { id: lotteryId },
    data: { drawLiveUrl: drawLiveUrl.trim() || null },
  });
  await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
  await cache.del(CACHE_KEYS.OPEN_LOTTERIES);
  await cache.del(CACHE_KEYS.ALL_LOTTERIES);
  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      action: 'LOTTERY_DRAW_LIVE_URL_UPDATED',
      entityType: 'LOTTERY',
      entityId: lotteryId,
      details: { drawLiveUrl: drawLiveUrl.trim() || null },
    },
  });
  return serializeLottery(updated);
}

export interface ManualReserveInput {
  numberValue: number;
  customerIdentifier?: string; // Telegram ID or Username
  customerName?: string;
  customerPhone?: string;
  paymentReference?: string;
  notes?: string;
}

/**
 * Manually reserves a ticket number for a customer (e.g. offline purchase, bank transfer).
 * Atomically marks the number as RESERVED, creates a confirmed reservation, records payment,
 * and updates campaign progress and sparse inventory caches.
 */
export async function manualReserveNumber(
  lotteryId: string,
  adminUserId: string,
  input: ManualReserveInput,
  requestId?: string,
) {
  const { numberValue, customerIdentifier, customerName, paymentReference, notes } = input;

  if (typeof numberValue !== 'number' || isNaN(numberValue)) {
    throw new LotteryError('INVALID_STATE', 'Valid ticket number is required.', 400);
  }

  // 1. Validate lottery exists and can accept bookings
  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
  });
  if (!lottery) {
    throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);
  }
  if (lottery.status !== LotteryStatus.OPEN && lottery.status !== LotteryStatus.PAUSED) {
    throw new LotteryError('INVALID_STATE', `Cannot reserve numbers on a ${lottery.status} campaign.`, 400);
  }

  // 2. Validate and check number availability
  const lotteryNumber = await prisma.lotteryNumber.findUnique({
    where: {
      lotteryId_numberValue: {
        lotteryId,
        numberValue,
      },
    },
    include: {
      claims: {
        where: { status: 'ACTIVE' },
      },
    },
  });

  if (!lotteryNumber) {
    throw new LotteryError('NOT_FOUND', `Ticket number #${numberValue} was not found in this campaign.`, 404);
  }

  if (lotteryNumber.status !== NumberStatus.AVAILABLE || lotteryNumber.claims.length > 0) {
    throw new LotteryError(
      'CONFLICT',
      `Ticket #${numberValue} is currently ${lotteryNumber.status} and cannot be reserved.`,
      409,
    );
  }

  // 3. Resolve or auto-provision customer account
  let customerUser = null;
  const rawId = (customerIdentifier || '').trim();
  const cleanUsername = rawId.replace(/^@/, '').trim();
  const isNumericTgId = /^\d{5,15}$/.test(rawId);

  if (isNumericTgId) {
    customerUser = await prisma.user.findUnique({
      where: { telegramUserId: BigInt(rawId) },
    });
  } else if (cleanUsername) {
    customerUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { username: { equals: cleanUsername, mode: 'insensitive' } },
        ],
      },
    });
  }

  if (!customerUser) {
    const syntheticTgId = isNumericTgId
      ? BigInt(rawId)
      : BigInt(Math.floor(100000000 + Math.random() * 900000000));
    const generatedUsername = cleanUsername || `player_${numberValue}_${Date.now().toString(36).slice(-4)}`;
    const displayName = customerName?.trim() || cleanUsername || `Player #${numberValue}`;

    customerUser = await prisma.user.create({
      data: {
        telegramUserId: syntheticTgId,
        username: generatedUsername,
        firstName: displayName,
        role: 'CUSTOMER',
      },
    });
  }

  // 4. Atomically commit reservation, payment, claim, and inventory update
  const result = await prisma.$transaction(async (tx) => {
    // Re-verify availability within transaction lock
    const lockedNum = await tx.lotteryNumber.findUnique({
      where: { id: lotteryNumber.id },
    });
    if (!lockedNum || lockedNum.status !== NumberStatus.AVAILABLE) {
      throw new LotteryError('CONFLICT', `Ticket #${numberValue} was reserved by another transaction.`, 409);
    }

    const now = new Date();
    const publicRef = `RES-MANUAL-${Math.floor(100000 + Math.random() * 900000)}`;
    const farFutureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // Create confirmed reservation
    const reservation = await tx.reservation.create({
      data: {
        lotteryId: lottery.id,
        userId: customerUser.id,
        publicReference: publicRef,
        ticketCount: 1,
        currency: lottery.currency,
        unitPriceMinor: lottery.ticketPriceMinor,
        totalAmountMinor: lottery.ticketPriceMinor,
        status: ReservationStatus.CONFIRMED,
        holdExpiresAt: farFutureExpiry,
        reviewedAt: now,
        reviewedBy: adminUserId,
      },
    });

    // Create reservation item snapshot
    await tx.reservationItem.create({
      data: {
        reservationId: reservation.id,
        lotteryId: lottery.id,
        lotteryNumberId: lockedNum.id,
        numberValueSnapshot: lockedNum.numberValue,
        unitPriceMinor: lottery.ticketPriceMinor,
      },
    });

    // Create active claim
    await tx.numberClaim.create({
      data: {
        lotteryNumberId: lockedNum.id,
        reservationId: reservation.id,
        status: 'ACTIVE',
        expiresAt: farFutureExpiry,
      },
    });

    // Mark number as RESERVED
    const updatedNumber = await tx.lotteryNumber.update({
      where: { id: lockedNum.id },
      data: { status: NumberStatus.RESERVED },
    });

    // Create approved payment submission record
    const submission = await tx.paymentSubmission.create({
      data: {
        reservationId: reservation.id,
        submittedBy: customerUser.id,
        storageKey: 'manual-admin-receipt',
        originalFilename: 'manual_receipt.txt',
        mimeType: 'text/plain',
        fileSizeBytes: BigInt(0),
        fileSha256: `manual-admin-${reservation.id}`,
        paymentReference: paymentReference?.trim() || `MANUAL-${publicRef}`,
        claimedAmountMinor: lottery.ticketPriceMinor,
        status: 'APPROVED',
      },
    });

    // Record review approval
    await tx.paymentReview.create({
      data: {
        paymentSubmissionId: submission.id,
        reviewerId: adminUserId,
        decision: 'APPROVED',
        reason: notes?.trim() || 'Manual ticket reservation confirmed by administrator',
        comparedWithBankRecord: true,
      },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'MANUAL_TICKET_RESERVED',
        entityType: 'LotteryNumber',
        entityId: lockedNum.id,
        requestId: requestId || null,
        details: {
          lotteryId,
          numberValue,
          reservationId: reservation.id,
          publicReference: publicRef,
          customerUsername: customerUser.username,
          customerTelegramId: customerUser.telegramUserId.toString(),
          paymentReference: paymentReference?.trim() || 'MANUAL',
        },
      },
    });

    // Write outbox progress update
    await tx.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: {
          lotteryId,
          reservationId: reservation.id,
          action: 'CONFIRMED',
          ticketCount: 1,
          timestamp: now.toISOString(),
        },
      },
    });

    return {
      reservation,
      updatedNumber,
      customerUser,
    };
  });

  // 5. Invalidate caches so progress and summaries update instantly across system
  clearSummaryCache(lotteryId);
  await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
  await cache.del(CACHE_KEYS.OPEN_LOTTERIES);
  await cache.del(CACHE_KEYS.ALL_LOTTERIES);

  return {
    success: true,
    lotteryNumberId: result.updatedNumber.id,
    numberValue: result.updatedNumber.numberValue,
    status: result.updatedNumber.status,
    reservationReference: result.reservation.publicReference,
    customer: {
      id: result.customerUser.id,
      username: result.customerUser.username,
      telegramUserId: result.customerUser.telegramUserId.toString(),
      firstName: result.customerUser.firstName,
    },
  };
}

/**
 * Releases a reserved or held number back to AVAILABLE status if needed.
 */
export async function manualReleaseNumber(
  lotteryId: string,
  adminUserId: string,
  numberValue: number,
  requestId?: string,
) {
  const lottery = await prisma.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) throw new LotteryError('NOT_FOUND', 'Campaign not found.', 404);

  const lotteryNumber = await prisma.lotteryNumber.findUnique({
    where: { lotteryId_numberValue: { lotteryId, numberValue } },
    include: { claims: { where: { status: 'ACTIVE' } } },
  });
  if (!lotteryNumber) throw new LotteryError('NOT_FOUND', `Ticket #${numberValue} not found.`, 404);

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Release active claims
    for (const claim of lotteryNumber.claims) {
      await tx.numberClaim.update({
        where: { id: claim.id },
        data: { status: 'RELEASED', releasedAt: now },
      });
      // Cancel reservation if it was a single ticket reservation
      await tx.reservation.updateMany({
        where: { id: claim.reservationId, ticketCount: 1 },
        data: { status: ReservationStatus.CANCELLED },
      });
    }

    // Set number back to AVAILABLE
    await tx.lotteryNumber.update({
      where: { id: lotteryNumber.id },
      data: { status: NumberStatus.AVAILABLE },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'MANUAL_NUMBER_RELEASED',
        entityType: 'LotteryNumber',
        entityId: lotteryNumber.id,
        requestId: requestId || null,
        details: { lotteryId, numberValue },
      },
    });
  });

  clearSummaryCache(lotteryId);
  await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
  await cache.del(CACHE_KEYS.OPEN_LOTTERIES);
  await cache.del(CACHE_KEYS.ALL_LOTTERIES);

  return { success: true, numberValue, status: NumberStatus.AVAILABLE };
}

// Helper: Serializes BigInt values into strings for JSON response
function serializeLottery(lottery: {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  prizeDescription: string;
  imageUrl?: string | null;
  drawVideoUrl?: string | null;
  drawLiveUrl?: string | null;
  status: LotteryStatus;
  currency: string;
  ticketPriceMinor: bigint;
  numberStart: number;
  numberEnd: number;
  maxNumbersPerPurchase: number;
  holdMinutes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  paymentInstructions: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...lottery,
    ticketPriceMinor: String(lottery.ticketPriceMinor),
  };
}

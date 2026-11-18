import crypto from 'node:crypto';
import { prisma } from '../../db/index.js';
import { LotteryStatus, ReservationStatus, UserRole, Reservation, ReservationItem, Lottery, LotteryNumber, Draw } from '@prisma/client';
import { clearSummaryCache } from '../lotteries/service.js';
import { cache, CACHE_KEYS } from '../cache/index.js';
import { expireHolds } from '../../worker/expireHolds.js';

type ReservationItemWithNumber = Partial<ReservationItem> & {
  lotteryNumberId?: string;
  numberValueSnapshot?: number;
  lotteryNumber?: Partial<LotteryNumber> | null;
  unitPriceMinor?: bigint;
};

type ReservationWithRelations = Reservation & {
  items?: ReservationItemWithNumber[];
  lottery?: (Lottery & { draws?: Draw[] }) | null;
};

export class ReservationError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'CAMPAIGN_NOT_OPEN'
      | 'CAMPAIGN_NOT_STARTED'
      | 'CAMPAIGN_ENDED'
      | 'INVALID_NUMBER_COUNT'
      | 'INVALID_NUMBER_RANGE'
      | 'DUPLICATE_NUMBERS'
      | 'USER_BLOCKED'
      | 'RESERVATION_LIMIT_EXCEEDED'
      | 'IDEMPOTENCY_MISMATCH'
      | 'NUMBER_UNAVAILABLE'
      | 'INVALID_STATUS'
      | 'HOARDING_DETECTED'
      | 'FORBIDDEN',
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ReservationError';
  }
}

export interface CreateReservationInput {
  lotteryId: string;
  userId: string;
  numbers: number[];
  idempotencyKey: string;
  requestId?: string;
}

export interface SerializedReservation {
  id: string;
  publicReference: string;
  userId: string;
  lotteryId: string;
  status: ReservationStatus;
  currency: string;
  unitPriceMinor: string;
  ticketCount: number;
  totalAmountMinor: string;
  holdExpiresAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id?: string;
    lotteryNumberId: string;
    numberValue: number;
    numberValueSnapshot: number;
    unitPriceMinor: string;
  }>;
  lottery?: {
    id: string;
    title: string;
    slug: string;
    status: LotteryStatus;
    prizeDescription?: string;
    ticketPriceMinor: string;
    holdMinutes: number;
    paymentInstructions: string | null;
    draws?: Array<{
      id: string;
      winningNumber: number;
      winningIndex: number;
      prizeLabel: string;
      createdAt: string;
    }>;
  };
}

function serializeReservation(reservation: ReservationWithRelations): SerializedReservation {
  return {
    id: reservation.id,
    publicReference: reservation.publicReference,
    userId: reservation.userId,
    lotteryId: reservation.lotteryId,
    status: reservation.status,
    currency: reservation.currency,
    unitPriceMinor: reservation.unitPriceMinor.toString(),
    ticketCount: reservation.ticketCount,
    totalAmountMinor: reservation.totalAmountMinor.toString(),
    holdExpiresAt: reservation.holdExpiresAt ? reservation.holdExpiresAt.toISOString() : null,
    submittedAt: reservation.submittedAt ? reservation.submittedAt.toISOString() : null,
    reviewedAt: reservation.reviewedAt ? reservation.reviewedAt.toISOString() : null,
    rejectionReason: reservation.rejectionReason ?? null,
    idempotencyKey: reservation.idempotencyKey,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    items: (reservation.items || []).map((item) => {
      const numVal = item.numberValueSnapshot ?? item.lotteryNumber?.numberValue ?? 0;
      return {
        id: item.id || '',
        lotteryNumberId: item.lotteryNumberId || '',
        numberValue: numVal,
        numberValueSnapshot: numVal,
        unitPriceMinor: item.unitPriceMinor ? item.unitPriceMinor.toString() : reservation.unitPriceMinor.toString(),
      };
    }),
    lottery: reservation.lottery
      ? {
          id: reservation.lottery.id,
          title: reservation.lottery.title,
          slug: reservation.lottery.slug,
          status: reservation.lottery.status,
          prizeDescription: reservation.lottery.prizeDescription,
          ticketPriceMinor: reservation.lottery.ticketPriceMinor.toString(),
          holdMinutes: reservation.lottery.holdMinutes,
          paymentInstructions: reservation.lottery.paymentInstructions,
          draws: (reservation.lottery.draws || []).map((d) => ({
            id: d.id,
            winningNumber: d.winningNumber,
            winningIndex: d.winningIndex,
            prizeLabel: d.prizeLabel,
            createdAt: d.createdAt.toISOString(),
          })),
        }
      : undefined,
  };
}

/**
 * Creates a lottery reservation atomically following Section 7.1.
 */
export async function createReservation(
  input: CreateReservationInput,
): Promise<SerializedReservation> {
  const { lotteryId, userId, numbers, idempotencyKey, requestId } = input;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lotteryId)) {
    throw new ReservationError('NOT_FOUND', 'Invalid lottery campaign ID format.', 404);
  }

  // 1. Validate user is not blocked
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBlocked: true, role: true },
  });

  if (!user) {
    throw new ReservationError('NOT_FOUND', 'User not found', 404);
  }

  if (user.isBlocked) {
    throw new ReservationError('USER_BLOCKED', 'User account is suspended.', 403);
  }

  // 2. Reject duplicate numbers in request
  const uniqueNumbers = Array.from(new Set(numbers));
  if (uniqueNumbers.length !== numbers.length) {
    throw new ReservationError('DUPLICATE_NUMBERS', 'Duplicate numbers requested.', 400);
  }

  // Sort numbers ascending to guarantee lock acquisition order and prevent deadlocks
  const sortedNumbers = [...numbers].sort((a, b) => a - b);

  // 3. Check idempotency
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ lotteryId, numbers: sortedNumbers }))
    .digest('hex');

  const existingReservation = await prisma.reservation.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey,
      },
    },
    include: {
      items: {
        orderBy: { numberValueSnapshot: 'asc' },
      },
      lottery: true,
    },
  });

  if (existingReservation) {
    if (existingReservation.requestHash === requestHash) {
      return serializeReservation(existingReservation);
    }
    throw new ReservationError(
      'IDEMPOTENCY_MISMATCH',
      'Idempotency key has already been used with different parameters.',
      422,
    );
  }

  // 4. Validate campaign is OPEN and inside sale window
  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
  });

  if (!lottery) {
    throw new ReservationError('NOT_FOUND', 'Lottery campaign not found.', 404);
  }

  if (lottery.status !== LotteryStatus.OPEN) {
    throw new ReservationError(
      'CAMPAIGN_NOT_OPEN',
      `Campaign is currently ${lottery.status}, not accepting reservations.`,
      409,
    );
  }

  const now = new Date();
  if (lottery.startsAt && now < lottery.startsAt) {
    throw new ReservationError('CAMPAIGN_NOT_STARTED', 'Campaign sale window has not started yet.', 409);
  }
  if (lottery.endsAt && now > lottery.endsAt) {
    throw new ReservationError('CAMPAIGN_ENDED', 'Campaign sale window has ended.', 409);
  }

  // Validate count within lottery limit
  if (sortedNumbers.length < 1 || sortedNumbers.length > lottery.maxNumbersPerPurchase) {
    throw new ReservationError(
      'INVALID_NUMBER_COUNT',
      `Selection must be between 1 and ${lottery.maxNumbersPerPurchase} numbers.`,
      400,
    );
  }

  // Validate range within campaign bounds
  if (sortedNumbers.some((n) => n < lottery.numberStart || n > lottery.numberEnd)) {
    throw new ReservationError(
      'INVALID_NUMBER_RANGE',
      `Selected numbers must be within campaign range #${lottery.numberStart} to #${lottery.numberEnd}.`,
      400,
    );
  }

  // 5. Enforce user limits: max 3 AWAITING_PAYMENT and max 5 PENDING_REVIEW
  // First, sweep expired holds so stale reservations never block fresh purchases
  try {
    await expireHolds();
  } catch {
    // Non-fatal if concurrent sweep occurs
  }

  const [awaitingCount, pendingCount] = await Promise.all([
    prisma.reservation.count({
      where: {
        userId,
        status: ReservationStatus.AWAITING_PAYMENT,
        holdExpiresAt: { gt: new Date() },
      },
    }),
    prisma.reservation.count({
      where: {
        userId,
        status: ReservationStatus.PENDING_REVIEW,
      },
    }),
  ]);

  if (awaitingCount >= 3) {
    throw new ReservationError(
      'RESERVATION_LIMIT_EXCEEDED',
      'Maximum limit of 3 unpaid reservations reached. Please complete payment or cancel existing reservations.',
      409,
    );
  }

  if (pendingCount >= 5) {
    throw new ReservationError(
      'RESERVATION_LIMIT_EXCEEDED',
      'Maximum limit of 5 reservations under review reached.',
      409,
    );
  }

  // 5b. Anti-hoarding check (Section 9, Item 4)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [expiredCount, confirmedCount] = await Promise.all([
    prisma.reservation.count({
      where: {
        userId,
        status: ReservationStatus.EXPIRED,
        createdAt: { gte: oneHourAgo },
      },
    }),
    prisma.reservation.count({
      where: {
        userId,
        status: ReservationStatus.CONFIRMED,
        createdAt: { gte: oneHourAgo },
      },
    }),
  ]);

  if (expiredCount >= 5 && confirmedCount === 0) {
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'HOARDING_FLAG_TRIGGERED',
        entityType: 'USER',
        entityId: userId,
        details: {
          expiredCount,
          reason: '>= 5 expired holds without confirmed purchases in past hour.',
        },
        requestId,
      },
    });

    throw new ReservationError(
      'HOARDING_DETECTED',
      'Excessive abandoned ticket holds detected. You are temporarily restricted from reserving tickets.',
      429,
    );
  }

  // 6. Execute atomic reservation inside database transaction
  // Use FOR UPDATE NOWAIT on ordered numbers to prevent deadlocks and race conditions
  const unitPriceMinor = lottery.ticketPriceMinor;
  const ticketCount = sortedNumbers.length;
  const totalAmountMinor = unitPriceMinor * BigInt(ticketCount);
  const publicReference = `RES-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created = await prisma.$transaction(async (tx) => {
    // Acquire row locks in ascending order with NOWAIT
    let lockedNumbers: Array<{ id: string; number_value: number; status: string }>;
    try {
      lockedNumbers = await tx.$queryRaw<Array<{ id: string; number_value: number; status: string }>>`
        SELECT id, number_value, status
        FROM lottery_numbers
        WHERE lottery_id = ${lotteryId}::uuid
          AND number_value = ANY(${sortedNumbers}::int[])
        ORDER BY number_value ASC
        FOR UPDATE NOWAIT
      `;
    } catch (err: unknown) {
      // Postgres error code 55P03 is lock_not_available
      const errorObj = err as { code?: string; meta?: { code?: string }; message?: string };
      if (
        errorObj?.code === '55P03' ||
        errorObj?.meta?.code === '55P03' ||
        /lock_not_available|could not obtain lock/i.test(errorObj?.message || '')
      ) {
        throw new ReservationError(
          'NUMBER_UNAVAILABLE',
          'One or more requested numbers are currently locked or held by another buyer.',
          409,
        );
      }
      throw err;
    }

    if (lockedNumbers.length !== sortedNumbers.length) {
      throw new ReservationError(
        'NUMBER_UNAVAILABLE',
        'One or more requested numbers do not exist in this campaign.',
        409,
      );
    }

    const unavailable = lockedNumbers.filter((n) => n.status !== 'AVAILABLE');
    if (unavailable.length > 0) {
      throw new ReservationError(
        'NUMBER_UNAVAILABLE',
        `One or more requested numbers are not available (unavailable: ${unavailable.map((u) => u.number_value).join(', ')}).`,
        409,
      );
    }

    // Compute hold expiry using database clock with resilient fallback
    let holdExpiresAt: Date;
    try {
      const expiryResult = await tx.$queryRaw<Array<{ expires_at: Date }>>`
        SELECT NOW() + (${lottery.holdMinutes} * INTERVAL '1 minute') AS expires_at
      `;
      holdExpiresAt = expiryResult[0]?.expires_at || new Date(Date.now() + (lottery.holdMinutes || 10) * 60 * 1000);
    } catch {
      holdExpiresAt = new Date(Date.now() + (lottery.holdMinutes || 10) * 60 * 1000);
    }

    // Create reservation record
    const reservation = await tx.reservation.create({
      data: {
        publicReference,
        userId,
        lotteryId,
        status: ReservationStatus.AWAITING_PAYMENT,
        currency: lottery.currency,
        unitPriceMinor,
        ticketCount,
        totalAmountMinor,
        holdExpiresAt,
        idempotencyKey,
        requestHash,
      },
    });

    const numberIds = lockedNumbers.map((n) => n.id);

    // Update numbers to HELD
    await tx.lotteryNumber.updateMany({
      where: { id: { in: numberIds } },
      data: { status: 'HELD' },
    });

    // Insert reservation items
    await tx.reservationItem.createMany({
      data: lockedNumbers.map((n) => ({
        reservationId: reservation.id,
        lotteryId,
        lotteryNumberId: n.id,
        numberValueSnapshot: n.number_value,
        unitPriceMinor,
      })),
    });

    // Insert active claims
    await tx.numberClaim.createMany({
      data: lockedNumbers.map((n) => ({
        lotteryNumberId: n.id,
        reservationId: reservation.id,
        status: 'ACTIVE',
        expiresAt: holdExpiresAt,
      })),
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'RESERVATION_CREATED',
        entityType: 'Reservation',
        entityId: reservation.id,
        requestId: requestId || null,
        details: {
          ticketCount,
          numbers: sortedNumbers,
          totalAmountMinor: totalAmountMinor.toString(),
          unitPriceMinor: unitPriceMinor.toString(),
          holdExpiresAt: holdExpiresAt.toISOString(),
        },
      },
    });

    // Write outbox event for progress update
    await tx.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: {
          lotteryId,
          reservationId: reservation.id,
          ticketCount,
          action: 'RESERVED',
          timestamp: new Date().toISOString(),
        },
      },
    });

    return {
      ...reservation,
      items: lockedNumbers.map((n) => ({
        lotteryNumberId: n.id,
        numberValueSnapshot: n.number_value,
        unitPriceMinor,
      })),
      lottery,
    };
  });

  // Clear public summary cache so new held status is reflected
  clearSummaryCache(lotteryId);

  const serialized = serializeReservation(created);

  // Enterprise Feature: Cache active hold session in Redis/Memory for instant session recovery
  if (created.holdExpiresAt) {
    const holdSecs = Math.max(1, Math.floor((created.holdExpiresAt.getTime() - Date.now()) / 1000));
    void cache.set(CACHE_KEYS.ACTIVE_HOLD(userId), serialized, holdSecs);
  }

  return serialized;
}

/**
 * Cancels a reservation while in AWAITING_PAYMENT status.
 */
export async function cancelReservation(
  reservationId: string,
  userId: string,
  userRole: UserRole,
  requestId?: string,
): Promise<SerializedReservation> {
  const isAdmin = userRole === UserRole.ADMIN || userRole === UserRole.SUPERADMIN;

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: true,
        lottery: true,
      },
    });

    if (!reservation) {
      throw new ReservationError('NOT_FOUND', 'Reservation not found.', 404);
    }

    if (reservation.userId !== userId && !isAdmin) {
      throw new ReservationError('FORBIDDEN', 'You do not have permission to cancel this reservation.', 403);
    }

    if (reservation.status !== ReservationStatus.AWAITING_PAYMENT) {
      throw new ReservationError(
        'INVALID_STATUS',
        `Cannot cancel reservation with status ${reservation.status}. Only AWAITING_PAYMENT reservations can be cancelled.`,
        409,
      );
    }

    // Update reservation status to CANCELLED
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: ReservationStatus.CANCELLED },
      include: {
        items: true,
        lottery: true,
      },
    });

    // Release active claims
    await tx.numberClaim.updateMany({
      where: {
        reservationId,
        status: 'ACTIVE',
      },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
      },
    });

    // Set numbers back to AVAILABLE (only if still HELD)
    const numberIds = reservation.items.map((i) => i.lotteryNumberId);
    await tx.lotteryNumber.updateMany({
      where: {
        id: { in: numberIds },
        status: 'HELD',
      },
      data: {
        status: 'AVAILABLE',
      },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'RESERVATION_CANCELLED',
        entityType: 'Reservation',
        entityId: reservation.id,
        requestId: requestId || null,
        details: {
          ticketCount: reservation.ticketCount,
          reason: 'Reservation cancelled by user or admin',
        },
      },
    });

    // Write outbox event
    await tx.outboxEvent.create({
      data: {
        eventType: 'PROGRESS_UPDATE',
        payload: {
          lotteryId: reservation.lotteryId,
          reservationId: reservation.id,
          ticketCount: reservation.ticketCount,
          action: 'CANCELLED',
          timestamp: new Date().toISOString(),
        },
      },
    });

    return updated;
  });

  clearSummaryCache(result.lotteryId);
  void cache.del(CACHE_KEYS.ACTIVE_HOLD(result.userId));

  return serializeReservation(result);
}

/**
 * Retrieves a reservation by ID.
 */
export async function getReservationById(
  reservationId: string,
  userId: string,
  userRole: UserRole,
): Promise<SerializedReservation> {
  const isAdmin = userRole === UserRole.ADMIN || userRole === UserRole.SUPERADMIN;

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      items: {
        orderBy: { numberValueSnapshot: 'asc' },
      },
      lottery: true,
    },
  });

  if (!reservation) {
    throw new ReservationError('NOT_FOUND', 'Reservation not found.', 404);
  }

  if (reservation.userId !== userId && !isAdmin) {
    throw new ReservationError('FORBIDDEN', 'Access denied to this reservation.', 403);
  }

  return serializeReservation(reservation);
}

/**
 * Retrieves all reservations for a given user.
 */
export async function getUserReservations(userId: string): Promise<SerializedReservation[]> {
  const reservations = await prisma.reservation.findMany({
    where: { userId },
    include: {
      items: {
        orderBy: { numberValueSnapshot: 'asc' },
      },
      lottery: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return reservations.map(serializeReservation);
}

/**
 * Retrieves confirmed tickets (or filtered by status) for a given user with optional pagination.
 */
export async function getUserConfirmedTickets(
  userId: string,
  status?: ReservationStatus,
  pagination?: { limit?: number; offset?: number },
): Promise<SerializedReservation[]> {
  const whereClause: { userId: string; status?: ReservationStatus } = { userId };
  if (status) {
    whereClause.status = status;
  }

  const limit = pagination?.limit ? Math.min(Math.max(1, pagination.limit), 100) : undefined;
  const offset = pagination?.offset && pagination.offset > 0 ? pagination.offset : undefined;

  const reservations = await prisma.reservation.findMany({
    where: whereClause,
    include: {
      items: {
        orderBy: { numberValueSnapshot: 'asc' },
      },
      lottery: {
        include: {
          draws: {
            orderBy: { drawOrder: 'asc' },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  return reservations.map(serializeReservation);
}

/**
 * Enterprise Session Continuity:
 * Retrieves active ticket hold for a user with cache-first acceleration.
 * If user switched apps, lost internet, or closed Telegram, this instantly recovers their countdown session.
 */
export async function getUserActiveHold(userId: string): Promise<SerializedReservation | null> {
  // 1. Fast path: Redis / Memory cache hit (< 1ms)
  const cached = await cache.get<SerializedReservation>(CACHE_KEYS.ACTIVE_HOLD(userId));
  if (cached && cached.holdExpiresAt) {
    const remainingMs = new Date(cached.holdExpiresAt).getTime() - Date.now();
    if (remainingMs > 0) {
      return cached;
    }
    // Expired from real clock perspective, purge
    void cache.del(CACHE_KEYS.ACTIVE_HOLD(userId));
  }

  // 2. Reliable path: PostgreSQL database check
  const active = await prisma.reservation.findFirst({
    where: {
      userId,
      status: ReservationStatus.AWAITING_PAYMENT,
      holdExpiresAt: { gt: new Date() },
    },
    include: {
      items: {
        orderBy: { numberValueSnapshot: 'asc' },
      },
      lottery: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!active) {
    return null;
  }

  const serialized = serializeReservation(active);
  if (active.holdExpiresAt) {
    const holdSecs = Math.max(1, Math.floor((active.holdExpiresAt.getTime() - Date.now()) / 1000));
    void cache.set(CACHE_KEYS.ACTIVE_HOLD(userId), serialized, holdSecs);
  }

  return serialized;
}

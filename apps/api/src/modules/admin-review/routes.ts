import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  ApprovePaymentRequestSchema,
  RejectPaymentRequestSchema,
} from '@tg-lottery/shared';
import {
  approvePaymentSubmission,
  rejectPaymentSubmission,
  getPaymentEvidenceUrl,
  AdminReviewError,
} from './service.js';
import { authenticateAdmin, requireRole } from '../auth/middleware.js';
import { hashPassword, encryptTotpSecret } from '../auth/crypto.js';
import { generateSecret } from 'otplib';
import { prisma } from '../../db/index.js';
import {
  PaymentStatus,
  ReservationStatus,
  UserRole,
  LotteryStatus,
  NumberStatus,
} from '@prisma/client';
import { config } from '../../config/index.js';
import { cache, CACHE_KEYS } from '../cache/index.js';
import { clearSummaryCache } from '../lotteries/service.js';
import { getTelegramClient } from '../telegram/client.js';
import { updateChannelProgressPost } from '../telegram/service.js';

const uuidSchema = z.string().uuid();

export const adminReviewRouter = Router();

// Protect all admin review routes
adminReviewRouter.use(authenticateAdmin);

// POST /admin/payment-submissions/:id/approve
adminReviewRouter.post('/payment-submissions/:id/approve', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const submissionId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(submissionId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid submission ID format', requestId } });
    return;
  }

  const parsed = ApprovePaymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid approval payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const result = await approvePaymentSubmission({
      submissionId,
      adminUserId: admin.id,
      adminRole: admin.role,
      comparedWithBankRecord: parsed.data.comparedWithBankRecord,
      note: parsed.data.note,
      requestId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminReviewError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    throw err;
  }
});

// POST /admin/payment-submissions/:id/reject
adminReviewRouter.post('/payment-submissions/:id/reject', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const submissionId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(submissionId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid submission ID format', requestId } });
    return;
  }

  const parsed = RejectPaymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid rejection payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const result = await rejectPaymentSubmission({
      submissionId,
      adminUserId: admin.id,
      reason: parsed.data.reason,
      comparedWithBankRecord: parsed.data.comparedWithBankRecord,
      requestId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminReviewError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    throw err;
  }
});

// GET /admin/payment-submissions/:id/evidence-url
adminReviewRouter.get('/payment-submissions/:id/evidence-url', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const submissionId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(submissionId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid submission ID format', requestId } });
    return;
  }

  try {
    const result = await getPaymentEvidenceUrl(submissionId, admin.id, requestId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminReviewError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    throw err;
  }
});

// GET /admin/payment-submissions (List submissions with pagination)
adminReviewRouter.get('/payment-submissions', async (req: Request, res: Response) => {
  const status = req.query.status as PaymentStatus | undefined;
  const reservationId = req.query.reservationId as string | undefined;
  const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit as string, 10)), 100) : 50;
  const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;
  const skip = (page - 1) * limit;

  const submissions = await prisma.paymentSubmission.findMany({
    where: {
      status: status || undefined,
      reservationId: reservationId || undefined,
    },
    include: {
      reservation: {
        include: {
          lottery: { select: { title: true, slug: true } },
          user: { select: { username: true, telegramUserId: true } },
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: skip > 0 ? skip : undefined,
  });

  const serialized = submissions.map((sub) => ({
    id: sub.id,
    reservationId: sub.reservationId,
    submittedBy: sub.submittedBy,
    originalFilename: sub.originalFilename,
    mimeType: sub.mimeType,
    fileSizeBytes: sub.fileSizeBytes.toString(),
    fileSha256: sub.fileSha256,
    claimedAmountMinor: sub.claimedAmountMinor ? sub.claimedAmountMinor.toString() : null,
    paymentReference: sub.paymentReference,
    status: sub.status,
    createdAt: sub.createdAt.toISOString(),
    reservation: {
      id: sub.reservation.id,
      publicReference: sub.reservation.publicReference,
      totalAmountMinor: sub.reservation.totalAmountMinor.toString(),
      ticketCount: sub.reservation.ticketCount,
      status: sub.reservation.status,
      lotteryId: sub.reservation.lotteryId,
      lotteryTitle: sub.reservation.lottery.title,
      customerUsername: sub.reservation.user.username,
      customerTelegramId: sub.reservation.user.telegramUserId.toString(),
    },
    reviews: sub.reviews.map((r) => ({
      id: r.id,
      reviewerId: r.reviewerId,
      decision: r.decision,
      reason: r.reason,
      comparedWithBankRecord: r.comparedWithBankRecord,
      createdAt: r.createdAt.toISOString(),
    })),
  }));

  res.status(200).json(serialized);
});

// GET /admin/reservations (List reservations for admin review & search)
adminReviewRouter.get('/reservations', async (req: Request, res: Response) => {
  const status = req.query.status as ReservationStatus | undefined;
  const lotteryId = req.query.lotteryId as string | undefined;
  const search = ((req.query.search as string) || '').trim();

  const reservations = await prisma.reservation.findMany({
    where: {
      status: status || undefined,
      lotteryId: lotteryId || undefined,
      ...(search
        ? {
            OR: [
              { publicReference: { contains: search, mode: 'insensitive' } },
              { user: { username: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: {
      items: { orderBy: { numberValueSnapshot: 'asc' } },
      lottery: { select: { title: true, slug: true } },
      user: { select: { username: true, telegramUserId: true } },
      paymentSubmissions: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const serialized = reservations.map((resItem) => ({
    id: resItem.id,
    publicReference: resItem.publicReference,
    status: resItem.status,
    ticketCount: resItem.ticketCount,
    totalAmountMinor: resItem.totalAmountMinor.toString(),
    holdExpiresAt: resItem.holdExpiresAt ? resItem.holdExpiresAt.toISOString() : null,
    submittedAt: resItem.submittedAt ? resItem.submittedAt.toISOString() : null,
    reviewedAt: resItem.reviewedAt ? resItem.reviewedAt.toISOString() : null,
    lottery: resItem.lottery,
    user: {
      username: resItem.user.username,
      telegramUserId: resItem.user.telegramUserId.toString(),
    },
    items: resItem.items.map((i) => ({
      numberValue: i.numberValueSnapshot,
      lotteryNumberId: i.lotteryNumberId,
    })),
    paymentSubmissionsCount: resItem.paymentSubmissions.length,
  }));

  res.status(200).json(serialized);
});

// GET /admin/overview (KPI Metrics from database)
adminReviewRouter.get('/overview', async (_req: Request, res: Response) => {
  const [
    activeCampaignsCount,
    confirmedReservations,
    confirmedClaimsCount,
    pendingReviewsCount,
    failedOutboxCount,
    totalCustomersCount,
  ] = await Promise.all([
    prisma.lottery.count({ where: { status: LotteryStatus.OPEN } }),
    prisma.reservation.aggregate({
      where: { status: ReservationStatus.CONFIRMED },
      _sum: { totalAmountMinor: true },
    }),
    prisma.numberClaim.count({
      where: { status: 'ACTIVE', reservation: { status: ReservationStatus.CONFIRMED } },
    }),
    prisma.paymentSubmission.count({
      where: { status: PaymentStatus.SUBMITTED },
    }),
    prisma.outboxEvent.count({
      where: { status: 'FAILED' },
    }),
    prisma.user.count({
      where: { role: UserRole.CUSTOMER },
    }),
  ]);

  const totalRevenueMinor = (confirmedReservations._sum.totalAmountMinor || 0n).toString();

  res.status(200).json({
    activeCampaignsCount,
    totalTicketsSold: confirmedClaimsCount,
    totalRevenueMinor,
    pendingReviewsCount,
    failedOutboxCount,
    totalCustomersCount,
  });
});

// GET /admin/audit-logs (Immutable Audit Trail with Real User Actor Resolution & History Filters)
adminReviewRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const entityType = req.query.entityType as string | undefined;
  const action = req.query.action as string | undefined;
  const actorUserId = req.query.actorUserId as string | undefined;
  const search = ((req.query.search as string) || '').trim();
  const category = req.query.category as string | undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  // Rolling retention timeframe window (default: 7 days / 1 week)
  const timeframe = (req.query.timeframe as string) || '7d';
  let sinceDate: Date | undefined;
  if (timeframe === '24h') {
    sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  } else if (timeframe === '3d') {
    sinceDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  } else if (timeframe === '7d' || !timeframe) {
    sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  // Category filter mapping
  let categoryActionFilter: string[] | undefined = undefined;
  if (category === 'SECURITY') {
    categoryActionFilter = [
      'ADMIN_LOGIN_SUCCESS',
      'ADMIN_LOGIN_FAILED',
      'ADMIN_TOTP_SUCCESS',
      'ADMIN_TOTP_FAILED',
      'CUSTOMER_AUTH_TELEGRAM',
      'ADMIN_PASSWORD_CHANGED',
      'AUDIT_RETENTION_PURGE_EXECUTED',
    ];
  } else if (category === 'DRAWS') {
    categoryActionFilter = ['DRAW_COMMITMENT_CREATED', 'DRAW_EXECUTED', 'DRAW_CANCELLED'];
  } else if (category === 'RESERVATIONS') {
    categoryActionFilter = [
      'RESERVATION_CREATED',
      'RESERVATION_EXPIRED',
      'RESERVATION_CANCELLED',
      'HOARDING_FLAG_TRIGGERED',
      'RESERVATION_HELD',
    ];
  } else if (category === 'PAYMENTS') {
    categoryActionFilter = ['PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED'];
  } else if (category === 'ADMIN') {
    categoryActionFilter = [
      'ADMIN_USER_CREATED',
      'CUSTOMER_BLOCKED',
      'CUSTOMER_UNBLOCKED',
      'PLATFORM_SETTINGS_UPDATED',
      'LOTTERY_CREATED',
      'LOTTERY_UPDATED',
      'LOTTERY_PUBLISHED',
      'LOTTERY_PAUSED',
      'LOTTERY_RESUMED',
      'LOTTERY_CLOSED',
      'LOTTERY_CANCELLED',
      'AUDIT_RETENTION_PURGE_EXECUTED',
    ];
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: entityType || undefined,
      actorUserId: category === 'SYSTEM' ? null : actorUserId || undefined,
      ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
      ...(categoryActionFilter ? { action: { in: categoryActionFilter } } : {}),
      ...(action && !categoryActionFilter ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' } },
              { requestId: { contains: search, mode: 'insensitive' } },
              {
                actor: {
                  OR: [
                    { username: { contains: search, mode: 'insensitive' } },
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { adminCredential: { email: { contains: search, mode: 'insensitive' } } },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    include: {
      actor: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          telegramUserId: true,
          role: true,
          adminCredential: { select: { email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const serialized = logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details,
    requestId: log.requestId,
    createdAt: log.createdAt.toISOString(),
    actor: {
      userId: log.actorUserId,
      username: log.actor?.username || null,
      firstName: log.actor?.firstName || null,
      lastName: log.actor?.lastName || null,
      telegramUserId: log.actor?.telegramUserId ? log.actor.telegramUserId.toString() : null,
      email: log.actor?.adminCredential?.email || null,
      role: log.actor ? log.actor.role : 'SYSTEM',
      isSystem: !log.actorUserId,
    },
  }));

  res.status(200).json(serialized);
});

// POST /admin/audit-logs/purge-expired (Superadmin 1-Week Rolling Retention Purge)
adminReviewRouter.post('/audit-logs/purge-expired', requireRole(UserRole.SUPERADMIN), async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const admin = req.admin!;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    const expiredCount = await prisma.auditLog.count({
      where: { createdAt: { lt: sevenDaysAgo } },
    });

    let purgedCount = 0;
    if (expiredCount > 0) {
      const deleteResult = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: sevenDaysAgo } },
      });
      purgedCount = deleteResult.count;
    }

    // Write an audit log for this retention cleanup operation
    await prisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: 'AUDIT_RETENTION_PURGE_EXECUTED',
        entityType: 'AUDIT_LOG',
        entityId: admin.id,
        requestId,
        details: {
          purgedCount,
          retentionWindowDays: 7,
          cutoffTimestamp: sevenDaysAgo.toISOString(),
          executedBy: admin.email,
        },
      },
    });

    const activeCount = await prisma.auditLog.count();

    res.status(200).json({
      success: true,
      purgedCount,
      retentionDays: 7,
      cutoffDate: sevenDaysAgo.toISOString(),
      activeCount,
      message: `Successfully purged ${purgedCount} expired audit logs older than 7 days.`,
    });
  } catch (err: unknown) {
    res.status(500).json({
      error: {
        code: 'PURGE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to purge expired audit logs',
        requestId,
      },
    });
  }
});

// GET /admin/customers (Customers overview & enriched statistics)
adminReviewRouter.get('/customers', async (req: Request, res: Response) => {
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const statusFilter = (req.query.status as string) || 'ALL';
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);

  const isNumeric = /^\d+$/.test(search);

  // Status conditions
  let isBlockedCondition: boolean | undefined = undefined;
  if (statusFilter === 'ACTIVE') isBlockedCondition = false;
  if (statusFilter === 'BLOCKED') isBlockedCondition = true;

  const customers = await prisma.user.findMany({
    where: {
      role: UserRole.CUSTOMER,
      ...(isBlockedCondition !== undefined ? { isBlocked: isBlockedCondition } : {}),
      ...(statusFilter === 'WITH_TICKETS'
        ? { reservations: { some: { status: ReservationStatus.CONFIRMED } } }
        : {}),
      ...(statusFilter === 'WITH_HOLDS'
        ? {
            reservations: {
              some: {
                status: {
                  in: [ReservationStatus.AWAITING_PAYMENT, ReservationStatus.PENDING_REVIEW],
                },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              ...(isNumeric
                ? [
                    {
                      telegramUserId: {
                        equals: BigInt(search),
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    },
    include: {
      reservations: {
        select: {
          id: true,
          status: true,
          totalAmountMinor: true,
          ticketCount: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          reservations: true,
          auditLogs: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const serialized = customers.map((c) => {
    let totalSpent = 0n;
    let confirmedTickets = 0;
    let activeHolds = 0;
    let expiredReservations = 0;
    let lastActiveAt: Date = c.createdAt;

    for (const r of c.reservations) {
      if (r.status === ReservationStatus.CONFIRMED) {
        totalSpent += r.totalAmountMinor;
        confirmedTickets += r.ticketCount;
      } else if (
        r.status === ReservationStatus.AWAITING_PAYMENT ||
        r.status === ReservationStatus.PENDING_REVIEW
      ) {
        activeHolds += 1;
      } else if (
        r.status === ReservationStatus.EXPIRED ||
        r.status === ReservationStatus.CANCELLED ||
        r.status === ReservationStatus.REJECTED
      ) {
        expiredReservations += 1;
      }
      if (r.createdAt > lastActiveAt) {
        lastActiveAt = r.createdAt;
      }
    }

    return {
      id: c.id,
      telegramUserId: c.telegramUserId.toString(),
      username: c.username,
      firstName: c.firstName,
      lastName: c.lastName,
      isBlocked: c.isBlocked,
      totalReservations: c._count.reservations,
      confirmedTickets,
      activeHolds,
      expiredReservations,
      totalSpentMinor: totalSpent.toString(),
      auditLogsCount: c._count.auditLogs,
      lastActiveAt: lastActiveAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    };
  });

  // Client-requested in-memory sorting
  if (sortBy === 'totalSpent') {
    serialized.sort((a, b) => {
      const diff = BigInt(a.totalSpentMinor) - BigInt(b.totalSpentMinor);
      return sortOrder === 'asc' ? (diff > 0n ? 1 : diff < 0n ? -1 : 0) : diff < 0n ? 1 : diff > 0n ? -1 : 0;
    });
  } else if (sortBy === 'confirmedTickets') {
    serialized.sort((a, b) => (sortOrder === 'asc' ? a.confirmedTickets - b.confirmedTickets : b.confirmedTickets - a.confirmedTickets));
  } else if (sortBy === 'totalReservations') {
    serialized.sort((a, b) => (sortOrder === 'asc' ? a.totalReservations - b.totalReservations : b.totalReservations - a.totalReservations));
  } else if (sortBy === 'activeHolds') {
    serialized.sort((a, b) => (sortOrder === 'asc' ? a.activeHolds - b.activeHolds : b.activeHolds - a.activeHolds));
  }

  res.status(200).json(serialized);
});

// GET /admin/customers/:id (Customer 360 Full Profile)
adminReviewRouter.get('/customers/:id', async (req: Request, res: Response) => {
  const customerId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (!uuidSchema.safeParse(customerId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid customer ID format', requestId } });
    return;
  }

  const customer = await prisma.user.findFirst({
    where: {
      id: customerId,
      role: UserRole.CUSTOMER,
    },
    include: {
      reservations: {
        include: {
          lottery: {
            select: {
              id: true,
              title: true,
              slug: true,
              ticketPriceMinor: true,
            },
          },
          items: {
            select: {
              numberValueSnapshot: true,
            },
            orderBy: { numberValueSnapshot: 'asc' },
          },
          paymentSubmissions: {
            select: {
              id: true,
              status: true,
              claimedAmountMinor: true,
              paymentReference: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });

  if (!customer) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found', requestId } });
    return;
  }

  // Fetch real audit trail history for this customer (actor or target entity)
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [{ actorUserId: customer.id }, { entityId: customer.id }],
    },
    include: {
      actor: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          telegramUserId: true,
          adminCredential: { select: { email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  // Calculate customer statistics
  let totalSpent = 0n;
  let confirmedTickets = 0;
  let activeHolds = 0;
  let expiredReservations = 0;

  for (const r of customer.reservations) {
    if (r.status === ReservationStatus.CONFIRMED) {
      totalSpent += r.totalAmountMinor;
      confirmedTickets += r.ticketCount;
    } else if (
      r.status === ReservationStatus.AWAITING_PAYMENT ||
      r.status === ReservationStatus.PENDING_REVIEW
    ) {
      activeHolds += 1;
    } else if (
      r.status === ReservationStatus.EXPIRED ||
      r.status === ReservationStatus.CANCELLED ||
      r.status === ReservationStatus.REJECTED
    ) {
      expiredReservations += 1;
    }
  }

  // Customer's winning ticket numbers per lottery
  const confirmedNumbersByLottery = new Map<string, Set<number>>();
  for (const r of customer.reservations) {
    if (r.status === ReservationStatus.CONFIRMED) {
      if (!confirmedNumbersByLottery.has(r.lottery.id)) {
        confirmedNumbersByLottery.set(r.lottery.id, new Set());
      }
      for (const item of r.items) {
        confirmedNumbersByLottery.get(r.lottery.id)!.add(item.numberValueSnapshot);
      }
    }
  }

  const allDraws = await prisma.draw.findMany({
    include: {
      lottery: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const wonDraws = allDraws.filter((d) => {
    const nums = confirmedNumbersByLottery.get(d.lotteryId);
    return nums && nums.has(d.winningNumber);
  });

  res.status(200).json({
    id: customer.id,
    telegramUserId: customer.telegramUserId.toString(),
    username: customer.username,
    firstName: customer.firstName,
    lastName: customer.lastName,
    role: customer.role,
    isBlocked: customer.isBlocked,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    stats: {
      totalReservations: customer.reservations.length,
      confirmedTickets,
      activeHolds,
      expiredReservations,
      totalSpentMinor: totalSpent.toString(),
      wonDrawsCount: wonDraws.length,
    },
    reservations: customer.reservations.map((r) => ({
      id: r.id,
      publicReference: r.publicReference,
      status: r.status,
      ticketCount: r.ticketCount,
      totalAmountMinor: r.totalAmountMinor.toString(),
      createdAt: r.createdAt.toISOString(),
      holdExpiresAt: r.holdExpiresAt ? r.holdExpiresAt.toISOString() : null,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      lottery: {
        id: r.lottery.id,
        title: r.lottery.title,
        slug: r.lottery.slug,
        ticketPriceMinor: r.lottery.ticketPriceMinor.toString(),
      },
      items: r.items.map((i) => ({ numberValue: i.numberValueSnapshot })),
      paymentSubmission: r.paymentSubmissions[0]
        ? {
            id: r.paymentSubmissions[0].id,
            status: r.paymentSubmissions[0].status,
            paymentReference: r.paymentSubmissions[0].paymentReference,
            claimedAmountMinor: r.paymentSubmissions[0].claimedAmountMinor
              ? r.paymentSubmissions[0].claimedAmountMinor.toString()
              : null,
            createdAt: r.paymentSubmissions[0].createdAt.toISOString(),
          }
        : null,
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.details,
      requestId: log.requestId,
      createdAt: log.createdAt.toISOString(),
      actor: {
        userId: log.actorUserId,
        username: log.actor?.username || null,
        firstName: log.actor?.firstName || null,
        lastName: log.actor?.lastName || null,
        telegramUserId: log.actor?.telegramUserId ? log.actor.telegramUserId.toString() : null,
        email: log.actor?.adminCredential?.email || null,
        role: log.actor ? log.actor.role : 'SYSTEM',
        isSystem: !log.actorUserId,
      },
    })),
    wonDraws: wonDraws.map((d) => ({
      id: d.id,
      lotteryTitle: d.lottery.title,
      prizeLabel: d.prizeLabel,
      winningNumber: d.winningNumber,
      createdAt: d.createdAt.toISOString(),
    })),
  });
});

// POST /admin/customers/:id/toggle-block (Block or unblock customer account with audit trail)
adminReviewRouter.post('/customers/:id/toggle-block', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const customerId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (!uuidSchema.safeParse(customerId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid customer ID format', requestId } });
    return;
  }

  const { isBlocked, reason } = req.body;
  if (typeof isBlocked !== 'boolean') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'isBlocked boolean is required', requestId },
    });
    return;
  }

  const customer = await prisma.user.findFirst({
    where: { id: customerId, role: UserRole.CUSTOMER },
  });

  if (!customer) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found', requestId } });
    return;
  }

  const updatedCustomer = await prisma.user.update({
    where: { id: customer.id },
    data: { isBlocked },
  });

  const actionName = isBlocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED';
  const defaultReason = isBlocked
    ? 'Customer account flagged and blocked by operator'
    : 'Customer account access restored by operator';

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: actionName,
      entityType: 'USER',
      entityId: customer.id,
      details: {
        reason: reason || defaultReason,
        customerUsername: customer.username,
        customerTelegramId: customer.telegramUserId.toString(),
        customerFirstName: customer.firstName,
        performedByRole: currentAdmin.role,
      },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    isBlocked: updatedCustomer.isBlocked,
    customerId: updatedCustomer.id,
    message: isBlocked ? 'Customer account successfully blocked' : 'Customer account successfully unblocked',
  });
});

// GET /admin/users (Admins & Operators)
adminReviewRouter.get('/users', async (_req: Request, res: Response) => {
  const admins = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: [UserRole.SUPERADMIN, UserRole.ADMIN] } },
        { adminCredential: { isNot: null } },
      ],
    },
    include: {
      adminCredential: {
        select: {
          email: true,
          failedAttempts: true,
          lockedUntil: true,
          mustChangePassword: true,
          totpSecretEncrypted: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const serialized = admins.map((a) => {
    const isDeactivated = Boolean(
      a.adminCredential?.lockedUntil &&
      a.adminCredential.lockedUntil.getFullYear() >= 9000
    );
    const heldRole = isDeactivated && a.adminCredential?.totpSecretEncrypted?.startsWith('DEACTIVATED:')
      ? (a.adminCredential.totpSecretEncrypted.replace('DEACTIVATED:', '') as 'SUPERADMIN' | 'ADMIN')
      : null;

    return {
      id: a.id,
      role: isDeactivated ? (heldRole || 'ADMIN') : a.role,
      actualRole: a.role,
      isDeactivated,
      heldRole,
      telegramUserId: a.telegramUserId ? a.telegramUserId.toString() : null,
      username: a.username,
      firstName: a.firstName,
      lastName: a.lastName,
      isBlocked: a.isBlocked,
      email: a.adminCredential?.email || null,
      lockedUntil: isDeactivated ? null : (a.adminCredential?.lockedUntil ? a.adminCredential.lockedUntil.toISOString() : null),
      failedAttempts: a.adminCredential?.failedAttempts ?? 0,
      mustChangePassword: a.adminCredential?.mustChangePassword ?? false,
      createdAt: a.createdAt.toISOString(),
    };
  });

  res.status(200).json(serialized);
});

// POST /admin/users (Create Admin/Operator - SUPERADMIN only)
adminReviewRouter.post('/users', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can create administrative users', requestId },
    });
    return;
  }

  const { email, password, role, firstName, lastName, username, telegramUserId } = req.body;
  if (!email || !password || !role) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Email, password, and role are required', requestId },
    });
    return;
  }

  // Allowed roles for administrative creation: ADMIN and SUPERADMIN
  const allowedRoles = [UserRole.ADMIN, UserRole.SUPERADMIN, 'ADMIN', 'SUPERADMIN'];
  if (!allowedRoles.includes(role)) {
    res.status(400).json({
      error: {
        code: 'INVALID_ROLE',
        message: 'Invalid role. Only ADMIN or SUPERADMIN accounts can be created.',
        requestId,
      },
    });
    return;
  }

  const targetRole =
    role === 'SUPERADMIN' || role === UserRole.SUPERADMIN
      ? UserRole.SUPERADMIN
      : UserRole.ADMIN;

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await prisma.adminCredential.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    res.status(409).json({
      error: { code: 'EMAIL_EXISTS', message: 'An admin with this email already exists', requestId },
    });
    return;
  }

  let targetTgId: bigint;
  if (telegramUserId) {
    const cleaned = String(telegramUserId).trim();
    if (!/^\d+$/.test(cleaned)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Telegram User ID must be a valid numerical ID (e.g. 123456789)',
          requestId,
        },
      });
      return;
    }
    targetTgId = BigInt(cleaned);
  } else {
    // Generate synthetic telegramUserId for backend-only admin accounts if not provided
    targetTgId = BigInt(Math.floor(100000000 + Math.random() * 900000000));
  }

  const passwordHash = await hashPassword(String(password));
  const totpSecret = generateSecret();
  const totpSecretEncrypted = encryptTotpSecret(totpSecret);

  // Check if a user with this telegramUserId already exists (e.g. customer)
  const existingUserByTg = await prisma.user.findUnique({
    where: { telegramUserId: targetTgId },
    include: { adminCredential: true },
  });

  if (existingUserByTg?.adminCredential) {
    res.status(409).json({
      error: {
        code: 'TELEGRAM_ID_EXISTS',
        message: `This Telegram ID is already linked to an administrator account (${existingUserByTg.adminCredential.email})`,
        requestId,
      },
    });
    return;
  }

  let createdUser;
  if (existingUserByTg) {
    // Elevate existing customer to targetRole and attach admin credentials
    await prisma.adminCredential.create({
      data: {
        userId: existingUserByTg.id,
        email: normalizedEmail,
        passwordHash,
        totpSecretEncrypted,
        mustChangePassword: true,
      },
    });

    createdUser = await prisma.user.update({
      where: { id: existingUserByTg.id },
      data: {
        role: targetRole,
        firstName: firstName || existingUserByTg.firstName,
        lastName: lastName || existingUserByTg.lastName,
        username: username || existingUserByTg.username,
      },
      include: { adminCredential: true },
    });
  } else {
    // Create new admin/superadmin user
    createdUser = await prisma.user.create({
      data: {
        telegramUserId: targetTgId,
        username: username || normalizedEmail.split('@')[0],
        firstName: firstName || (targetRole === UserRole.SUPERADMIN ? 'Superadmin' : 'Admin'),
        lastName: lastName || '',
        role: targetRole,
        adminCredential: {
          create: {
            email: normalizedEmail,
            passwordHash,
            totpSecretEncrypted,
            mustChangePassword: true, // Forced password change on first login
          },
        },
      },
      include: { adminCredential: true },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_USER_CREATED',
      entityType: 'USER',
      entityId: createdUser.id,
      details: {
        email: normalizedEmail,
        telegramUserId: targetTgId.toString(),
        role: targetRole,
        mustChangePassword: true,
      },
      requestId,
    },
  });

  res.status(201).json({
    id: createdUser.id,
    email: normalizedEmail,
    telegramUserId: targetTgId.toString(),
    role: createdUser.role,
    totpSecret,
    mustChangePassword: true,
  });
});

// POST /admin/users/:id/deactivate (Revoke Role & Deactivate Console - SUPERADMIN only)
adminReviewRouter.post('/users/:id/deactivate', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const targetId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can deactivate administrative accounts', requestId },
    });
    return;
  }

  if (targetId === currentAdmin.id) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Cannot deactivate your own active superadmin account', requestId },
    });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetId },
    include: { adminCredential: true },
  });

  if (!targetUser || !targetUser.adminCredential) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Administrator account not found', requestId },
    });
    return;
  }

  const envSuperadminEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@orojackpot.com').toLowerCase();
  if (targetUser.adminCredential.email.toLowerCase() === envSuperadminEmail) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Cannot deactivate the primary root superadmin account', requestId },
    });
    return;
  }

  // Preserve their assigned role for resumption
  const heldRole = targetUser.role !== UserRole.CUSTOMER
    ? targetUser.role
    : (targetUser.adminCredential.totpSecretEncrypted?.startsWith('DEACTIVATED:')
        ? (targetUser.adminCredential.totpSecretEncrypted.replace('DEACTIVATED:', '') as UserRole)
        : UserRole.ADMIN);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { role: UserRole.CUSTOMER },
    }),
    prisma.adminCredential.update({
      where: { userId: targetId },
      data: {
        lockedUntil: new Date('9999-12-31T23:59:59.999Z'),
        totpSecretEncrypted: `DEACTIVATED:${heldRole}`,
      },
    }),
  ]);

  void cache.del(CACHE_KEYS.USER_PROFILE(targetId));

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_ROLE_DEACTIVATED',
      entityType: 'USER',
      entityId: targetId,
      details: {
        email: targetUser.adminCredential.email,
        heldRole,
        reason: 'Revoked administrative role and deactivated console access',
      },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    message: `Account deactivated. Role revoked; user is now treated as a normal customer.`,
    isDeactivated: true,
    heldRole,
  });
});

// POST /admin/users/:id/resume (Resume Role & Reactivate Console - SUPERADMIN only)
adminReviewRouter.post('/users/:id/resume', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const targetId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can resume administrative accounts', requestId },
    });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetId },
    include: { adminCredential: true },
  });

  if (!targetUser || !targetUser.adminCredential) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Administrator account not found', requestId },
    });
    return;
  }

  // Restore their preserved role
  let restoredRole: UserRole = UserRole.ADMIN;
  if (targetUser.adminCredential.totpSecretEncrypted?.startsWith('DEACTIVATED:')) {
    const rawRole = targetUser.adminCredential.totpSecretEncrypted.replace('DEACTIVATED:', '');
    if (rawRole === 'SUPERADMIN' || rawRole === UserRole.SUPERADMIN) {
      restoredRole = UserRole.SUPERADMIN;
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { role: restoredRole },
    }),
    prisma.adminCredential.update({
      where: { userId: targetId },
      data: {
        lockedUntil: null,
        failedAttempts: 0,
        totpSecretEncrypted: null,
      },
    }),
  ]);

  void cache.del(CACHE_KEYS.USER_PROFILE(targetId));

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_ROLE_RESUMED',
      entityType: 'USER',
      entityId: targetId,
      details: {
        email: targetUser.adminCredential.email,
        restoredRole,
      },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    message: `Account resumed. Role restored as ${restoredRole}.`,
    isDeactivated: false,
    role: restoredRole,
  });
});

// DELETE /admin/users/:id (Totally erase admin/superadmin account from database - SUPERADMIN only)
adminReviewRouter.delete('/users/:id', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const targetId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can delete administrative accounts', requestId },
    });
    return;
  }

  if (targetId === currentAdmin.id) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Cannot delete your own active superadmin account', requestId },
    });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetId },
    include: {
      adminCredential: true,
      reservations: { select: { id: true }, take: 1 },
    },
  });

  if (!targetUser) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Account not found', requestId },
    });
    return;
  }

  const envSuperadminEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@orojackpot.com').toLowerCase();
  if (targetUser.adminCredential?.email.toLowerCase() === envSuperadminEmail) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Cannot delete the primary root superadmin account', requestId },
    });
    return;
  }

  const deletedEmail = targetUser.adminCredential?.email || targetUser.username || targetUser.id;

  // Delete the admin credentials completely from the database
  if (targetUser.adminCredential) {
    await prisma.adminCredential.delete({
      where: { userId: targetId },
    });
  }

  // Revert user role to CUSTOMER and invalidate profile cache
  await prisma.user.update({
    where: { id: targetId },
    data: { role: UserRole.CUSTOMER },
  });

  void cache.del(CACHE_KEYS.USER_PROFILE(targetId));

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_USER_DELETED',
      entityType: 'USER',
      entityId: targetId,
      details: {
        deletedEmail,
        deletedUserId: targetId,
      },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    message: `Administrator account (${deletedEmail}) has been completely deleted.`,
  });
});

// POST /admin/users/:id/reset-lockout (Unlock admin account & reset failed attempts - SUPERADMIN only)
adminReviewRouter.post('/users/:id/reset-lockout', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const targetId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can unlock accounts', requestId },
    });
    return;
  }

  const credential = await prisma.adminCredential.findUnique({
    where: { userId: targetId },
  });

  if (!credential) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Administrator credentials not found', requestId },
    });
    return;
  }

  // If account is deactivated (lockedUntil year >= 9000), inform operator to use resume
  if (credential.lockedUntil && credential.lockedUntil.getFullYear() >= 9000) {
    res.status(400).json({
      error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated. Please click "Resume" to restore access.', requestId },
    });
    return;
  }

  await prisma.adminCredential.update({
    where: { userId: targetId },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_LOCKOUT_RESET',
      entityType: 'USER',
      entityId: targetId,
      details: { email: credential.email },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    message: 'Account unlocked and failed attempts reset to 0.',
  });
});

// POST /admin/users/:id/reset-password (Set temporary password for admin - SUPERADMIN only)
adminReviewRouter.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const targetId = req.params.id as string;
  const requestId = req.headers['x-request-id'] as string;
  const { password } = req.body || {};

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can reset operator passwords', requestId },
    });
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters long', requestId },
    });
    return;
  }

  const credential = await prisma.adminCredential.findUnique({
    where: { userId: targetId },
  });

  if (!credential) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Administrator credentials not found', requestId },
    });
    return;
  }

  const newHash = await hashPassword(password);
  const isDeactivated = Boolean(credential.lockedUntil && credential.lockedUntil.getFullYear() >= 9000);

  await prisma.adminCredential.update({
    where: { userId: targetId },
    data: {
      passwordHash: newHash,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: isDeactivated ? credential.lockedUntil : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'ADMIN_PASSWORD_RESET_BY_SUPERADMIN',
      entityType: 'USER',
      entityId: targetId,
      details: { email: credential.email },
      requestId,
    },
  });

  res.status(200).json({
    success: true,
    message: `Password reset successfully for ${credential.email}. Operator must change password upon next login.`,
  });
});

// GET /admin/lotteries/:id/inventory (Inspect Campaign Numbers)
adminReviewRouter.get('/lotteries/:id/inventory', async (req: Request, res: Response) => {
  const lotteryId = req.params.id as string;
  const status = req.query.status as NumberStatus | undefined;
  const search = req.query.search ? Number(req.query.search) : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const numbers = await prisma.lotteryNumber.findMany({
    where: {
      lotteryId,
      status: status || undefined,
      numberValue: search !== undefined && !isNaN(search) ? search : undefined,
    },
    include: {
      claims: {
        where: { status: 'ACTIVE' },
        include: {
          reservation: {
            select: {
              publicReference: true,
              status: true,
              user: { select: { username: true, telegramUserId: true } },
            },
          },
        },
        take: 1,
      },
    },
    orderBy: { numberValue: 'asc' },
    take: limit,
  });

  const serialized = numbers.map((n) => {
    const activeClaim = n.claims[0];
    return {
      id: n.id,
      numberValue: n.numberValue,
      status: n.status,
      activeClaim: activeClaim
        ? {
            reservationReference: activeClaim.reservation.publicReference,
            reservationStatus: activeClaim.reservation.status,
            customerUsername: activeClaim.reservation.user.username,
            customerTelegramId: activeClaim.reservation.user.telegramUserId.toString(),
            heldUntil: activeClaim.expiresAt ? activeClaim.expiresAt.toISOString() : null,
          }
        : null,
    };
  });

  res.status(200).json(serialized);
});

// In-memory configurable platform settings with database & cache persistence
export interface PlatformSettingsState {
  dualApprovalRequired: boolean;
  dualApprovalThresholdMinor: string;
  reviewEscalationDelayMinutes: number;
  maintenanceMode: boolean;
  customerSupportTelegram: string;
  telegramChannelId: string;
}

let platformSettings: PlatformSettingsState = {
  dualApprovalRequired: false,
  dualApprovalThresholdMinor: '1000000', // 10,000.00 ETB
  reviewEscalationDelayMinutes: 120, // 2 hours
  maintenanceMode: false,
  customerSupportTelegram: '@EthiopianLotterySupport',
  telegramChannelId: config.TELEGRAM_CHANNEL_ID || '',
};

export function getPlatformTelegramChannelId(): string {
  return platformSettings.telegramChannelId || config.TELEGRAM_CHANNEL_ID || '';
}

// Bootstrap saved settings from cache or DB audit log
async function initPlatformSettings() {
  try {
    const cached = await cache.get<string>(CACHE_KEYS.PLATFORM_SETTINGS);
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      platformSettings = { ...platformSettings, ...(parsed as Partial<PlatformSettingsState>) };
      if (platformSettings.telegramChannelId) {
        (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
      }
      return;
    }

    const latestAudit = await prisma.auditLog.findFirst({
      where: { action: 'PLATFORM_SETTINGS_UPDATED', entityType: 'SETTINGS' },
      orderBy: { createdAt: 'desc' },
    });
    if (latestAudit && latestAudit.details && typeof latestAudit.details === 'object') {
      platformSettings = { ...platformSettings, ...(latestAudit.details as Record<string, unknown>) };
      if (platformSettings.telegramChannelId) {
        (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
      }
      await cache.set(CACHE_KEYS.PLATFORM_SETTINGS, JSON.stringify(platformSettings));
    }
  } catch {
    // Non-fatal, use defaults
  }
}
void initPlatformSettings();

// GET /admin/settings
adminReviewRouter.get('/settings', (_req: Request, res: Response) => {
  res.status(200).json(platformSettings);
});

// PATCH /admin/settings (SUPERADMIN only)
adminReviewRouter.patch('/settings', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const requestId = req.headers['x-request-id'] as string;

  if (currentAdmin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can update system settings', requestId },
    });
    return;
  }

  platformSettings = {
    ...platformSettings,
    ...req.body,
  };

  if (typeof req.body.telegramChannelId === 'string') {
    platformSettings.telegramChannelId = req.body.telegramChannelId.trim();
    (config as { TELEGRAM_CHANNEL_ID?: string }).TELEGRAM_CHANNEL_ID = platformSettings.telegramChannelId;
  }

  await cache.set(CACHE_KEYS.PLATFORM_SETTINGS, JSON.stringify(platformSettings));

  await prisma.auditLog.create({
    data: {
      actorUserId: currentAdmin.id,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'SETTINGS',
      entityId: currentAdmin.id,
      details: JSON.parse(JSON.stringify(platformSettings)),
      requestId,
    },
  });

  res.status(200).json(platformSettings);
});

// POST /admin/settings/test-telegram-channel (Verify Telegram Channel Wiring)
adminReviewRouter.post('/settings/test-telegram-channel', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const targetChannel = ((req.body?.channelId as string) || platformSettings.telegramChannelId || config.TELEGRAM_CHANNEL_ID || '').trim();

  if (!targetChannel) {
    res.status(400).json({
      ok: false,
      error: 'Please enter a Telegram Channel username (e.g. @MyChannel) or ID (-100...) first.',
      requestId,
    });
    return;
  }

  const client = getTelegramClient();

  try {
    // 1. Check bot token
    const bot = await client.getMe();

    // 2. Resolve channel info
    const chat = await client.getChat(targetChannel);

    // 3. Check membership & admin status
    let memberStatus = 'unknown';
    let canPost = false;
    let canEdit = false;

    try {
      const member = await client.getChatMember(targetChannel, bot.id);
      memberStatus = member.status;
      canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
      canEdit = member.status === 'creator' || (member.status === 'administrator' && member.can_edit_messages !== false);
    } catch {
      // Failed to get specific member info, bot might not have permissions to query members
    }

    const isBotAdmin = memberStatus === 'administrator' || memberStatus === 'creator';

    if (!isBotAdmin) {
      res.status(200).json({
        ok: false,
        botUsername: bot.username || bot.first_name,
        channelTitle: chat.title || targetChannel,
        channelUsername: chat.username || null,
        channelId: String(chat.id),
        chatType: chat.type,
        memberStatus,
        canPost,
        error: `Bot @${bot.username || bot.first_name} is in the channel but is NOT an Administrator. Please promote the bot to Administrator with "Post Messages" permission in Telegram channel settings.`,
        requestId,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      botUsername: bot.username || bot.first_name,
      channelTitle: chat.title || targetChannel,
      channelUsername: chat.username || null,
      channelId: String(chat.id),
      chatType: chat.type,
      memberStatus,
      canPost,
      canEdit,
      message: `Verified! Bot @${bot.username || bot.first_name} is an Administrator in "${chat.title || targetChannel}" with Post Messages privileges. Auto-sync is ready!`,
      requestId,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    let friendlyError = errorMsg;
    if (errorMsg.includes('chat not found')) {
      friendlyError = `Channel "${targetChannel}" was not found. If it is private, add the bot to the channel first. If public, make sure the @username is spelled correctly.`;
    } else if (errorMsg.includes('bot is not a member') || errorMsg.includes('Forbidden')) {
      friendlyError = `The bot is not yet added to channel "${targetChannel}". Open Telegram, go to Channel Settings > Administrators, and add your bot.`;
    } else if (errorMsg.includes('Unauthorized') || errorMsg.includes('401')) {
      friendlyError = `Telegram Bot Token is invalid or unauthorized. Please verify TELEGRAM_BOT_TOKEN in .env.`;
    }

    res.status(200).json({
      ok: false,
      error: friendlyError,
      requestId,
    });
  }
});

// POST /admin/payment-submissions/purge-campaign
adminReviewRouter.post('/payment-submissions/purge-campaign', async (req: Request, res: Response) => {
  const currentAdmin = req.admin!;
  const requestId = req.headers['x-request-id'] as string;
  const { lotteryId, mode = 'ALL' } = req.body || {};

  if (!lotteryId || typeof lotteryId !== 'string') {
    res.status(400).json({
      error: { code: 'INVALID_PAYLOAD', message: 'lotteryId is required', requestId },
    });
    return;
  }

  const lottery = await prisma.lottery.findUnique({
    where: { id: lotteryId },
    select: { id: true, title: true, status: true },
  });

  if (!lottery) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId },
    });
    return;
  }

  try {
    const isPendingOnly = mode === 'PENDING_ONLY';

    // 1. Find target reservations
    const reservations = await prisma.reservation.findMany({
      where: {
        lotteryId,
        ...(isPendingOnly
          ? { status: { in: [ReservationStatus.AWAITING_PAYMENT, ReservationStatus.PENDING_REVIEW] } }
          : {}),
      },
      select: {
        id: true,
        items: { select: { lotteryNumberId: true } },
      },
    });

    const resIds = reservations.map((r) => r.id);

    // 2. Find target payment submissions
    const submissions = await prisma.paymentSubmission.findMany({
      where: {
        reservationId: { in: resIds },
        ...(isPendingOnly ? { status: PaymentStatus.SUBMITTED } : {}),
      },
      select: { id: true },
    });
    const subIds = submissions.map((s) => s.id);

    // 3. Delete reviews and submissions
    if (subIds.length > 0) {
      await prisma.paymentReview.deleteMany({
        where: { paymentSubmissionId: { in: subIds } },
      });
      await prisma.paymentSubmission.deleteMany({
        where: { id: { in: subIds } },
      });
    }

    // 4. Delete claims, refunds, items, and reservations
    if (resIds.length > 0) {
      await prisma.refund.deleteMany({
        where: { reservationId: { in: resIds } },
      }).catch(() => {});

      await prisma.numberClaim.deleteMany({
        where: { reservationId: { in: resIds } },
      });

      await prisma.reservationItem.deleteMany({
        where: { reservationId: { in: resIds } },
      });

      await prisma.reservation.deleteMany({
        where: { id: { in: resIds } },
      });
    }

    // 5. Free up lottery numbers
    if (isPendingOnly) {
      const affectedNumberIds = reservations.flatMap((r) => r.items.map((it) => it.lotteryNumberId));
      if (affectedNumberIds.length > 0) {
        await prisma.lotteryNumber.updateMany({
          where: {
            id: { in: affectedNumberIds },
            status: { in: [NumberStatus.HELD, NumberStatus.PENDING_REVIEW] },
          },
          data: { status: NumberStatus.AVAILABLE },
        });
      }
    } else {
      // Full reset of all numbers back to AVAILABLE
      await prisma.lotteryNumber.updateMany({
        where: { lotteryId },
        data: { status: NumberStatus.AVAILABLE },
      });
    }

    // 6. Invalidate caches
    await clearSummaryCache(lotteryId);
    await cache.del(CACHE_KEYS.LOTTERY(lotteryId));
    await cache.del(CACHE_KEYS.NUMBERS_SUMMARY(lotteryId));
    await cache.del(CACHE_KEYS.ALL_LOTTERIES);
    await cache.del(CACHE_KEYS.OPEN_LOTTERIES);

    // 7. Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: currentAdmin.id,
        action: 'CAMPAIGN_PAYMENTS_PURGED',
        entityType: 'LOTTERY',
        entityId: lotteryId,
        details: {
          lotteryTitle: lottery.title,
          mode,
          deletedSubmissionsCount: subIds.length,
          deletedReservationsCount: resIds.length,
        },
        requestId,
      },
    });

    // 8. Sync updated ticket counts to Telegram channel in background if configured
    void updateChannelProgressPost(lotteryId, { force: true }).catch(() => {});

    res.status(200).json({
      ok: true,
      lotteryId,
      lotteryTitle: lottery.title,
      mode,
      deletedSubmissionsCount: subIds.length,
      deletedReservationsCount: resIds.length,
      message: `Successfully erased ${subIds.length} payment submissions and ${resIds.length} reservations for "${lottery.title}". All associated numbers are now restored to AVAILABLE.`,
      requestId,
    });
  } catch (err: unknown) {
    res.status(500).json({
      error: {
        code: 'PURGE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to purge campaign payments',
        requestId,
      },
    });
  }
});


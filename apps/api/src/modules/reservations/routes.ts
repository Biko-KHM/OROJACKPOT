import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  CreateReservationRequestSchema,
  CreatePaymentSubmissionRequestSchema,
} from '@tg-lottery/shared';
import {
  createReservation,
  cancelReservation,
  getReservationById,
  getUserReservations,
  getUserConfirmedTickets,
  getUserActiveHold,
  ReservationError,
} from './service.js';
import { ReservationStatus } from '@prisma/client';
import {
  submitPaymentEvidence,
  PaymentSubmissionError,
} from '../payments/service.js';
import { authenticateCustomer } from '../auth/middleware.js';
import { logger } from '../../logger/index.js';

const uuidSchema = z.string().uuid();

export const reservationsRouter = Router();

// GET /reservations/:id
reservationsRouter.get('/:id', authenticateCustomer, async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const reservationId = req.params.id as string;
  const user = req.user!;

  if (!uuidSchema.safeParse(reservationId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid reservation ID format.', requestId } });
    return;
  }

  try {
    const reservation = await getReservationById(reservationId, user.id, user.role);
    res.status(200).json(reservation);
  } catch (err) {
    if (err instanceof ReservationError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error({ err, requestId, reservationId }, 'Error getting reservation by ID');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /reservations/:id/cancel
reservationsRouter.post('/:id/cancel', authenticateCustomer, async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const reservationId = req.params.id as string;
  const user = req.user!;

  if (!uuidSchema.safeParse(reservationId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid reservation ID format.', requestId } });
    return;
  }

  try {
    const reservation = await cancelReservation(reservationId, user.id, user.role, requestId);
    res.status(200).json(reservation);
  } catch (err) {
    if (err instanceof ReservationError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to cancel reservation';
    logger.error({ err, requestId, reservationId }, 'Error cancelling reservation');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /reservations/:id/payment-submissions
reservationsRouter.post('/:id/payment-submissions', authenticateCustomer, async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const reservationId = req.params.id as string;
  const user = req.user!;

  if (!uuidSchema.safeParse(reservationId).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid reservation ID format.', requestId } });
    return;
  }

  const parsed = CreatePaymentSubmissionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorDetails = parsed.error.format();
    const errorMessages = parsed.error.errors.map((e) => `${e.path.join('.') || 'payload'}: ${e.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: errorMessages ? `Invalid payment submission (${errorMessages})` : 'Invalid payment submission payload',
        details: errorDetails,
        requestId,
      },
    });
    return;
  }

  try {
    const submission = await submitPaymentEvidence({
      reservationId,
      userId: user.id,
      storageKey: parsed.data.storageKey,
      originalFilename: parsed.data.originalFilename,
      claimedAmountMinor: parsed.data.claimedAmountMinor,
      paymentReference: parsed.data.paymentReference,
      requestId,
    });
    res.status(201).json(submission);
  } catch (err) {
    if (err instanceof PaymentSubmissionError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to submit payment evidence';
    logger.error({ err, requestId, reservationId }, 'Error submitting payment evidence');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});


// Handler for POST /lotteries/:id/reservations
export async function createReservationHandler(req: Request, res: Response): Promise<void> {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const user = req.user!;

  const parseResult = CreateReservationRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.format();
    const errorMessages = parseResult.error.errors.map((e) => `${e.path.join('.') || 'payload'}: ${e.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: errorMessages ? `Invalid reservation request (${errorMessages})` : 'Invalid reservation request payload.',
        details: errorDetails,
        requestId,
      },
    });
    return;
  }

  try {
    const reservation = await createReservation({
      lotteryId,
      userId: user.id,
      numbers: parseResult.data.numbers,
      idempotencyKey: parseResult.data.idempotencyKey,
      requestId,
    });
    res.status(201).json(reservation);
  } catch (err) {
    if (err instanceof ReservationError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to create reservation';
    logger.error({ err, requestId, lotteryId }, 'Error in createReservationHandler');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
}

// Router for /me
export const meRouter = Router();

// GET /me
meRouter.get('/', authenticateCustomer, (req: Request, res: Response) => {
  res.status(200).json({
    ...(req.user || {}),
    user: req.user,
  });
});

// GET /me/tickets
meRouter.get('/tickets', authenticateCustomer, async (req: Request, res: Response) => {
  const user = req.user!;
  const statusQuery = req.query.status as string | undefined;

  let targetStatus: ReservationStatus | undefined = ReservationStatus.CONFIRMED;
  if (statusQuery) {
    const upper = statusQuery.toUpperCase();
    if (upper === 'ALL') {
      targetStatus = undefined;
    } else if (Object.values(ReservationStatus).includes(upper as ReservationStatus)) {
      targetStatus = upper as ReservationStatus;
    }
  }

  const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offsetParam = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  const tickets = await getUserConfirmedTickets(user.id, targetStatus, {
    limit: limitParam && !isNaN(limitParam) ? limitParam : undefined,
    offset: offsetParam && !isNaN(offsetParam) ? offsetParam : undefined,
  });
  res.status(200).json(tickets);
});

// GET /me/reservations
meRouter.get('/reservations', authenticateCustomer, async (req: Request, res: Response) => {
  const user = req.user!;
  const reservations = await getUserReservations(user.id);
  res.status(200).json(reservations);
});

// GET /me/active-hold (Enterprise Session Continuity)
meRouter.get('/active-hold', authenticateCustomer, async (req: Request, res: Response) => {
  const user = req.user!;
  const activeHold = await getUserActiveHold(user.id);
  res.status(200).json({ activeHold });
});


import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import {
  ExecuteDrawRequestSchema,
  CreateDrawCommitmentRequestSchema,
  ExecuteCommittedDrawRequestSchema,
  MarkRefundPaidRequestSchema,
} from '@tg-lottery/shared';
import {
  prepareDrawCommitment,
  executeDrawFromCommitment,
  executeDraw,
  getDrawCommitmentsByLottery,
  getDrawsByLottery,
  getDrawVerificationData,
  getPublicDrawSnapshot,
  announceDrawResult,
  getRefunds,
  markRefundPaid,
  DrawError,
} from './service.js';
import { authenticateAdmin } from '../auth/middleware.js';

const uuidSchema = z.string().uuid();

// ============================================================================
// ADMIN DRAWS ROUTER (/admin/...)
// ============================================================================
export const adminDrawsRouter = Router();

// Require admin authentication for all admin draw & refund endpoints
adminDrawsRouter.use(authenticateAdmin);

// POST /admin/lotteries/:id/draw-commit (Phase 1: Pre-Draw Commitment & Snapshot)
adminDrawsRouter.post('/lotteries/:id/draw-commit', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(lotteryId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid lottery ID format', requestId },
    });
    return;
  }

  if (admin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can prepare draw commitments.', requestId },
    });
    return;
  }

  const parsed = CreateDrawCommitmentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid draw commitment payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const commitment = await prepareDrawCommitment({
      lotteryId,
      prizeLabel: parsed.data.prizeLabel,
      drawOrder: parsed.data.drawOrder,
      publicEntropySource: parsed.data.publicEntropySource,
      customPublicEntropy: parsed.data.customPublicEntropy,
      adminUserId: admin.id,
      adminRole: admin.role,
      requestId,
    });

    res.status(201).json({ data: commitment });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// GET /admin/lotteries/:id/commitments
adminDrawsRouter.get('/lotteries/:id/commitments', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;

  if (!uuidSchema.safeParse(lotteryId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid lottery ID format', requestId },
    });
    return;
  }

  try {
    const commitments = await getDrawCommitmentsByLottery(lotteryId);
    res.status(200).json({ data: commitments });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/commitments/:id/execute (Phase 2: Reveal & Execute Committed Draw)
adminDrawsRouter.post('/commitments/:id/execute', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const commitmentId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(commitmentId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid commitment ID format', requestId },
    });
    return;
  }

  if (admin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can execute draws.', requestId },
    });
    return;
  }

  const parsed = ExecuteCommittedDrawRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid execute request payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const draw = await executeDrawFromCommitment({
      commitmentId,
      publicEntropy: parsed.data.publicEntropy,
      adminUserId: admin.id,
      adminRole: admin.role,
      requestId,
    });

    res.status(200).json({ data: draw });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    if ((err as any)?.code === 'P2002' || (err as any)?.code === 'P2034') {
      res.status(409).json({
        error: {
          code: 'DRAW_ALREADY_EXECUTED',
          message: 'Draw has already been executed or concurrent conflict detected.',
          requestId,
        },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/draw (Atomic Commit & Execute for Backward Compatibility)
adminDrawsRouter.post('/lotteries/:id/draw', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(lotteryId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid lottery ID format', requestId },
    });
    return;
  }

  if (admin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can execute draws.', requestId },
    });
    return;
  }

  const parsed = ExecuteDrawRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid draw payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const draw = await executeDraw({
      lotteryId,
      prizeLabel: parsed.data.prizeLabel,
      adminUserId: admin.id,
      adminRole: admin.role,
      requestId,
      publicEntropy: parsed.data.publicEntropy,
    });

    res.status(200).json({ data: draw });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    if ((err as any)?.code === 'P2002' || (err as any)?.code === 'P2034') {
      res.status(409).json({
        error: {
          code: 'DRAW_ALREADY_EXECUTED',
          message: 'Draw has already been executed or concurrent conflict detected.',
          requestId,
        },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// GET /admin/lotteries/:id/draws
adminDrawsRouter.get('/lotteries/:id/draws', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;

  if (!uuidSchema.safeParse(lotteryId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid lottery ID format', requestId },
    });
    return;
  }

  try {
    const draws = await getDrawsByLottery(lotteryId);
    res.status(200).json({ data: draws });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/draws/:id/announce
adminDrawsRouter.post('/draws/:id/announce', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const drawId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(drawId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid draw ID format', requestId },
    });
    return;
  }

  if (admin.role !== UserRole.SUPERADMIN) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only SUPERADMIN can announce draw results.', requestId },
    });
    return;
  }

  try {
    const result = await announceDrawResult(drawId, admin.id, admin.role, requestId);
    res.status(200).json({ data: result, ...result });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// GET /admin/refunds
adminDrawsRouter.get('/refunds', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const { lotteryId, status, limit, offset } = req.query;

  try {
    const result = await getRefunds({
      lotteryId: typeof lotteryId === 'string' ? lotteryId : undefined,
      status: typeof status === 'string' ? status : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.status(200).json({ data: result.refunds, refunds: result.refunds, total: result.total });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/refunds/:id/paid and /admin/refunds/:id/mark-paid
const markPaidHandler = async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const refundId = req.params.id as string;
  const admin = req.admin!;

  if (!uuidSchema.safeParse(refundId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid refund ID format', requestId },
    });
    return;
  }

  const parsed = MarkRefundPaidRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        details: parsed.error.format(),
        requestId,
      },
    });
    return;
  }

  try {
    const updated = await markRefundPaid({
      refundId,
      adminUserId: admin.id,
      note: parsed.data.note,
      requestId,
    });
    res.status(200).json({ data: updated });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
};

adminDrawsRouter.post('/refunds/:id/paid', markPaidHandler);
adminDrawsRouter.post('/refunds/:id/mark-paid', markPaidHandler);

// ============================================================================
// PUBLIC DRAWS & TRANSPARENCY ROUTER (/public/draws or /draws/...)
// ============================================================================
export const publicDrawsRouter = Router();

// GET /draws/:id/verify (Public Verification Endpoint)
publicDrawsRouter.get('/:id/verify', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const drawId = req.params.id as string;

  if (!uuidSchema.safeParse(drawId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid draw ID format', requestId },
    });
    return;
  }

  try {
    const verificationData = await getDrawVerificationData(drawId);
    res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 60s
    res.status(200).json({ data: verificationData });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// GET /draws/:id/snapshot (Public Snapshot Download for Independent Auditors)
publicDrawsRouter.get('/:id/snapshot', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const drawId = req.params.id as string;

  if (!uuidSchema.safeParse(drawId).success) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid draw ID format', requestId },
    });
    return;
  }

  try {
    const snapshotData = await getPublicDrawSnapshot(drawId);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ data: snapshotData });
  } catch (err) {
    if (err instanceof DrawError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

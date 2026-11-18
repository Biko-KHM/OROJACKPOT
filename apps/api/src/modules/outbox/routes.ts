import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../auth/middleware.js';
import { getFailedOutboxEvents, retryFailedOutboxEvent } from './service.js';

export const adminOutboxRouter = Router();

adminOutboxRouter.use(authenticateAdmin);

const uuidSchema = z.string().uuid();

/**
 * GET /admin/outbox/failed
 * Lists outbox events in FAILED state.
 */
adminOutboxRouter.get('/outbox/failed', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  try {
    const result = await getFailedOutboxEvents({ limit, offset });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve failed outbox events';
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    });
  }
});

/**
 * POST /admin/outbox/:id/retry
 * Retries a failed outbox event.
 */
adminOutboxRouter.post('/outbox/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!uuidSchema.safeParse(id).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid outbox event ID format' } });
    return;
  }

  try {
    const updated = await retryFailedOutboxEvent(id as string);
    res.json({ success: true, event: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Outbox event not found';
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message,
      },
    });
  }
});

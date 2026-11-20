import crypto from 'node:crypto';
import express, { Router, Request, Response } from 'express';
import {
  CreateLotteryRequestSchema,
  UpdateLotteryRequestSchema,
} from '@tg-lottery/shared';
import {
  createLottery,
  publishLottery,
  pauseLottery,
  resumeLottery,
  closeLottery,
  cancelLottery,
  archiveLottery,
  deleteLottery,
  updateLottery,
  getLotteries,
  getLotteryById,
  getLotteryNumbersSummary,
  completeManualDraw,
  updateLotteryDrawVideo,
  LotteryError,
} from './service.js';
import { uploadDrawVideoToTelegram, streamDrawVideo } from './videoStorage.js';
import { authenticateAdmin, authenticateCustomer } from '../auth/middleware.js';
import { createReservationHandler } from '../reservations/routes.js';
import { reservationsRateLimiter } from '../security/rateLimiter.js';
import { LotteryStatus } from '@prisma/client';
import { updateChannelProgressPost } from '../telegram/service.js';
import { getDrawsByLottery } from '../draws/service.js';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';

// Customer Router: /lotteries
export const lotteriesRouter = Router();

// POST /lotteries/:id/reservations (Rate limited: max 10/min)
lotteriesRouter.post(
  '/:id/reservations',
  authenticateCustomer,
  reservationsRateLimiter.middleware(),
  createReservationHandler,
);

// GET /lotteries (Public/Customer)
lotteriesRouter.get('/', async (req: Request, res: Response) => {
  const statusParam = req.query.status as string | undefined;
  if (statusParam === 'ALL') {
    const lotteries = await getLotteries();
    res.status(200).json(lotteries);
    return;
  }
  if (statusParam && Object.values(LotteryStatus).includes(statusParam as LotteryStatus)) {
    const lotteries = await getLotteries({ status: statusParam as LotteryStatus });
    res.status(200).json(lotteries);
    return;
  }
  // Default for customer Mini App: return OPEN, DRAFT, CLOSED (waiting for draw), and COMPLETED lotteries
  const lotteries = await getLotteries({
    status: [
      LotteryStatus.OPEN,
      LotteryStatus.DRAFT,
      LotteryStatus.CLOSED,
      LotteryStatus.COMPLETED,
    ],
  });
  res.status(200).json(lotteries);
});

// GET /lotteries/:id
lotteriesRouter.get('/:id', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const lottery = await getLotteryById(lotteryId);
    res.status(200).json(lottery);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error({ err, requestId, lotteryId }, 'Error getting lottery by ID');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// GET /lotteries/:id/draw-video (Public video streaming endpoint for Mini App / web)
lotteriesRouter.get('/:id/draw-video', async (req: Request, res: Response) => {
  const lotteryId = req.params.id as string;
  try {
    const lottery = await getLotteryById(lotteryId);
    if (!lottery || !lottery.drawVideoUrl) {
      res.status(404).json({ error: { code: 'NO_DRAW_VIDEO', message: 'No draw video recorded for this campaign' } });
      return;
    }
    await streamDrawVideo(lottery.drawVideoUrl, req, res);
  } catch (err) {
    logger.error({ err, lotteryId }, 'Error streaming draw video');
    res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to stream draw video' } });
  }
});

// GET /lotteries/:id/numbers/summary & /lotteries/:id/numbers-summary (Cached 2 seconds)
const numbersSummaryHandler = async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const summary = await getLotteryNumbersSummary(lotteryId);
    res.setHeader('Cache-Control', 'public, max-age=2, s-maxage=2');
    res.status(200).json(summary);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error({ err, requestId, lotteryId }, 'Error getting lottery numbers summary');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
};

lotteriesRouter.get('/:id/numbers/summary', numbersSummaryHandler);
lotteriesRouter.get('/:id/numbers-summary', numbersSummaryHandler);

// GET /lotteries/:id/draws (Public completed draws for this lottery)
lotteriesRouter.get('/:id/draws', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const draws = await getDrawsByLottery(lotteryId);
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.status(200).json(draws);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// Admin Router: /admin/lotteries
export const adminLotteriesRouter = Router();

// Protect all admin lottery routes with admin session + CSRF checks
adminLotteriesRouter.use(authenticateAdmin);

// GET /admin/lotteries (Admin Campaign List with all statuses)
adminLotteriesRouter.get('/', async (req: Request, res: Response) => {
  const statusParam = req.query.status as string | undefined;
  const statusFilter =
    statusParam && statusParam !== 'ALL' && Object.values(LotteryStatus).includes(statusParam as LotteryStatus)
      ? (statusParam as LotteryStatus)
      : undefined;

  const lotteries = await getLotteries(statusFilter ? { status: statusFilter } : undefined);
  res.status(200).json(lotteries);
});

// POST /admin/lotteries (Create DRAFT)
adminLotteriesRouter.post('/', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const parsed = CreateLotteryRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const errorDetails = parsed.error.format();
    const errorMessages = parsed.error.errors.map((e) => `${e.path.join('.') || 'payload'}: ${e.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: errorMessages ? `Invalid campaign payload (${errorMessages})` : 'Invalid campaign payload',
        details: errorDetails,
        requestId,
      },
    });
    return;
  }

  try {
    const created = await createLottery(parsed.data, req.admin!.id, requestId);
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to create campaign';
    logger.error({ err, requestId }, 'Error in createLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// PATCH /admin/lotteries/:id
adminLotteriesRouter.patch('/:id', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const parsed = UpdateLotteryRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const errorDetails = parsed.error.format();
    const errorMessages = parsed.error.errors.map((e) => `${e.path.join('.') || 'payload'}: ${e.message}`).join(', ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: errorMessages ? `Invalid update payload (${errorMessages})` : 'Invalid update payload',
        details: errorDetails,
        requestId,
      },
    });
    return;
  }

  try {
    const updated = await updateLottery(lotteryId, parsed.data, req.admin!.id, requestId);
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to update campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in updateLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/publish
adminLotteriesRouter.post('/:id/publish', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const published = await publishLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(published);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to publish campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in publishLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/pause
adminLotteriesRouter.post('/:id/pause', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const paused = await pauseLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(paused);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to pause campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in pauseLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/resume
adminLotteriesRouter.post('/:id/resume', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const resumed = await resumeLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(resumed);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to resume campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in resumeLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/close
adminLotteriesRouter.post('/:id/close', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const closed = await closeLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(closed);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to close campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in closeLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/cancel
adminLotteriesRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const cancelled = await cancelLottery(
      lotteryId,
      req.admin!.id,
      req.body?.reason,
      requestId,
    );
    res.status(200).json(cancelled);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to cancel campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in cancelLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/archive
adminLotteriesRouter.post('/:id/archive', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const archived = await archiveLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(archived);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to archive campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in archiveLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// DELETE /admin/lotteries/:id (Permanent Deletion of Archived Campaign - Final Act)
adminLotteriesRouter.delete('/:id', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const result = await deleteLottery(lotteryId, req.admin!.id, requestId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, requestId },
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to delete campaign';
    logger.error({ err, requestId, lotteryId }, 'Error in deleteLottery route');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/sync-channel
adminLotteriesRouter.post('/:id/sync-channel', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  try {
    const syncResult = await updateChannelProgressPost(lotteryId, { force: true });
    res.status(200).json({
      ok: syncResult.success,
      channelConfigured: syncResult.channelConfigured ?? true,
      message: syncResult.channelConfigured === false
        ? 'TELEGRAM_CHANNEL_ID is not configured in .env; channel post was skipped.'
        : syncResult.success
          ? 'Telegram channel progress card synced successfully.'
          : 'Failed to update Telegram channel post.',
      requestId,
    });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 'CHANNEL_SYNC_FAILED',
        message: err instanceof Error ? err.message : 'Failed to sync to Telegram channel',
        requestId,
      },
    });
  }
});

import {
  uploadCampaignImageToSupabase,
  deleteCampaignImageFromSupabase,
} from './storage.js';

// POST /admin/lotteries/presign-upload (Direct Supabase Storage bucket signed upload URL)
adminLotteriesRouter.post('/presign-upload', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const clientFilename = (req.body?.filename as string) || (req.query?.filename as string) || 'campaign.jpg';
  const mimeType = (req.body?.contentType as string) || 'image/jpeg';

  let ext = 'jpg';
  if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('gif')) ext = 'gif';
  else if (mimeType.includes('svg')) ext = 'svg';
  else if (mimeType.includes('avif')) ext = 'avif';

  const sanitizedBase = (clientFilename || 'campaign')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 30);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  // Store directly under the bucket without subfolders
  const storedFileName = `${sanitizedBase}_${Date.now()}_${randomSuffix}.${ext}`;

  const supabaseUrl = process.env.SUPABASE_URL || config.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    config.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || config.SUPABASE_STORAGE_BUCKET;

  try {
    const signEndpoint = `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${storedFileName}`;
    const signRes = await fetch(signEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });

    if (!signRes.ok) {
      const errText = await signRes.text();
      throw new Error(`Supabase presign returned ${signRes.status}: ${errText}`);
    }

    const signData = (await signRes.json()) as { url: string; token: string };
    const uploadUrl = signData.url.startsWith('http')
      ? signData.url
      : `${supabaseUrl}/storage/v1${signData.url}`;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${storedFileName}`;

    res.status(200).json({
      success: true,
      uploadUrl,
      publicUrl,
      storedFileName,
      bucket,
      requestId,
    });
  } catch (err) {
    logger.error({ err, requestId }, 'Error generating Supabase presigned upload URL');
    res.status(500).json({
      error: {
        code: 'PRESIGN_FAILED',
        message: err instanceof Error ? err.message : 'Failed to generate signed upload URL',
        requestId,
      },
    });
  }
});

// Raw body parser for direct binary image uploads
const imageRawParser = express.raw({
  type: (req: any) => !req.headers['content-type']?.includes('application/json'),
  limit: '12mb',
});

// POST /admin/lotteries/upload-image
// Authenticated Admin endpoint that validates image, strips EXIF, and uploads to Supabase Storage
adminLotteriesRouter.post('/upload-image', imageRawParser, async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  let buffer: Buffer;
  let mimeType = 'image/jpeg';
  let clientFilename = 'campaign.jpg';
  const campaignId = (req.query.campaignId as string) || undefined;

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    // 1. Direct binary upload (via native streaming body)
    buffer = req.body;
    const rawContentType = req.headers['content-type'];
    mimeType = (rawContentType ? rawContentType.split(';')[0]?.trim().toLowerCase() : '') || 'image/jpeg';
    const queryFilename = (req.query.filename as string) || '';
    if (queryFilename) {
      try {
        clientFilename = decodeURIComponent(queryFilename);
      } catch {
        clientFilename = queryFilename;
      }
    } else if (req.headers['x-filename']) {
      try {
        clientFilename = decodeURIComponent(req.headers['x-filename'] as string);
      } catch {
        clientFilename = req.headers['x-filename'] as string;
      }
    }
  } else if (req.body?.dataUrl && typeof req.body.dataUrl === 'string') {
    // 2. Base64 fallback (converts to binary on server, NEVER stores base64 in DB)
    const matches = req.body.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || !matches[1] || !matches[2]) {
      res.status(400).json({
        error: { code: 'INVALID_DATA_URL', message: 'Invalid base64 data URL', requestId },
      });
      return;
    }
    mimeType = matches[1].toLowerCase();
    buffer = Buffer.from(matches[2], 'base64');
    clientFilename = req.body.filename || (req.query.filename as string) || 'campaign.jpg';
  } else {
    res.status(400).json({
      error: { code: 'INVALID_PAYLOAD', message: 'Image file or dataUrl is required', requestId },
    });
    return;
  }

  try {
    const uploaded = await uploadCampaignImageToSupabase(buffer, clientFilename, mimeType, campaignId);
    res.status(200).json({
      success: true,
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      bucket: uploaded.bucket,
      fileSizeBytes: uploaded.fileSizeBytes,
      mimeType: uploaded.mimeType,
      storage: 'supabase',
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload image to Supabase Storage';
    logger.error({ err, requestId }, 'Campaign image upload error');
    res.status(400).json({
      error: { code: 'IMAGE_UPLOAD_FAILED', message, requestId },
    });
  }
});

// DELETE /admin/lotteries/image
// Cleans up an unreferenced or replaced campaign image from Supabase Storage
adminLotteriesRouter.delete('/image', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const storagePathOrUrl = (req.body?.storagePath || req.body?.url || req.query.url) as string;

  if (!storagePathOrUrl) {
    res.status(400).json({
      error: { code: 'INVALID_PAYLOAD', message: 'storagePath or url is required', requestId },
    });
    return;
  }

  const deleted = await deleteCampaignImageFromSupabase(storagePathOrUrl);
  res.status(200).json({
    success: deleted,
    storagePathOrUrl,
    requestId,
  });
});

// Binary parser for draw video uploads (max 50MB per Telegram API)
const videoRawParser = express.raw({
  type: (req: any) => !req.headers['content-type']?.includes('application/json'),
  limit: '50mb',
});

// POST /admin/lotteries/:id/manual-draw
// Superadmin / Admin records a manual offline draw result and announces the winner
adminLotteriesRouter.post('/:id/manual-draw', async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const admin = req.admin!;
  const winningNumber = Number(req.body?.winningNumber);
  const prizeLabel = req.body?.prizeLabel as string | undefined;
  const drawVideoUrl = req.body?.drawVideoUrl as string | undefined;

  if (isNaN(winningNumber)) {
    res.status(400).json({
      error: { code: 'INVALID_WINNING_NUMBER', message: 'winningNumber is required and must be a number', requestId },
    });
    return;
  }

  try {
    const result = await completeManualDraw({
      lotteryId,
      adminUserId: admin.id,
      winningNumber,
      prizeLabel,
      drawVideoUrl,
      requestId,
    });
    res.status(200).json({ success: true, ...result, requestId });
  } catch (err) {
    if (err instanceof LotteryError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message, requestId } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to complete manual draw';
    logger.error({ err, lotteryId, requestId }, 'Manual draw completion error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, requestId } });
  }
});

// POST /admin/lotteries/:id/draw-video
// Uploads manual draw video directly to Telegram Cloud CDN (or local disk fallback) and associates with lottery
adminLotteriesRouter.post('/:id/draw-video', videoRawParser, async (req: Request, res: Response) => {
  const requestId = req.headers['x-request-id'] as string;
  const lotteryId = req.params.id as string;
  const admin = req.admin!;

  let buffer: Buffer;
  let filename = 'draw_video.mp4';

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    buffer = req.body;
    const queryFilename = (req.query.filename as string) || (req.headers['x-filename'] as string) || '';
    if (queryFilename) {
      try {
        filename = decodeURIComponent(queryFilename);
      } catch {
        filename = queryFilename;
      }
    }
  } else if (req.body?.dataUrl && typeof req.body.dataUrl === 'string') {
    const matches = req.body.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || !matches[2]) {
      res.status(400).json({ error: { code: 'INVALID_DATA_URL', message: 'Invalid base64 dataUrl', requestId } });
      return;
    }
    buffer = Buffer.from(matches[2], 'base64');
    filename = req.body.filename || 'draw_video.mp4';
  } else {
    res.status(400).json({ error: { code: 'NO_VIDEO_DATA', message: 'Video binary body or dataUrl is required', requestId } });
    return;
  }

  try {
    const lottery = await getLotteryById(lotteryId);
    if (!lottery) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } });
      return;
    }

    const storageKey = await uploadDrawVideoToTelegram(buffer, filename, lottery.title);
    const updated = await updateLotteryDrawVideo(lotteryId, storageKey, admin.id);

    res.status(200).json({
      success: true,
      drawVideoUrl: storageKey,
      videoPlaybackUrl: `/lotteries/${lotteryId}/draw-video`,
      lottery: updated,
      requestId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload draw video';
    logger.error({ err, lotteryId, requestId }, 'Draw video upload error');
    res.status(500).json({ error: { code: 'UPLOAD_FAILED', message, requestId } });
  }
});

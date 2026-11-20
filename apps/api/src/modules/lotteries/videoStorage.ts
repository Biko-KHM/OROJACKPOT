import fs from 'node:fs';
import path from 'node:path';
import { Request, Response } from 'express';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';
import { getTelegramClient } from '../telegram/client.js';
import { getPlatformTelegramChannelId } from '../platform/settings.js';

const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), 'data/storage/draw-videos');

// Ensure local directory exists
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

/**
 * Uploads a manual draw video to Telegram Bot Cloud CDN.
 * Falls back to local storage if Telegram is offline or in development.
 */
export async function uploadDrawVideoToTelegram(
  buffer: Buffer,
  filename: string,
  campaignTitle: string,
): Promise<string> {
  const client = getTelegramClient();
  const channelId = getPlatformTelegramChannelId();
  const isDummyToken = !config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN.includes('dummy');

  if (!isDummyToken && channelId) {
    try {
      const caption = `🎬 <b>Official Draw Verification Video</b>\nCampaign: <b>${campaignTitle}</b>`;
      const res = await client.sendVideo(channelId, buffer, filename || 'draw_video.mp4', caption);
      if (res.file_id) {
        logger.info({ fileId: res.file_id, campaignTitle }, 'Draw video successfully uploaded to Telegram Cloud CDN');
        return `tg:${res.file_id}`;
      }
    } catch (err) {
      logger.warn({ err }, 'Telegram video upload failed; falling back to local storage');
    }
  }

  // Local storage fallback for dev/testing
  const safeFilename = `${Date.now()}-${path.basename(filename || 'draw_video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(LOCAL_STORAGE_DIR, safeFilename);
  await fs.promises.writeFile(filePath, buffer);
  logger.info({ safeFilename }, 'Draw video saved to local disk storage');
  return `local:${safeFilename}`;
}

/**
 * Streams draw video with full HTTP 206 Partial Content Range support for all web and mobile browsers.
 */
export async function streamDrawVideo(videoRef: string, req: Request, res: Response): Promise<void> {
  if (videoRef.startsWith('tg:')) {
    const fileId = videoRef.slice(3);
    const client = getTelegramClient();
    try {
      const fileInfo = await client.getFile(fileId);
      if (!fileInfo?.file_path) {
        throw new Error('Telegram file_path not found');
      }
      const tgFileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

      const rangeHeader = req.headers.range;
      const fetchHeaders: HeadersInit = rangeHeader ? { Range: rangeHeader } : {};
      const tgResponse = await fetch(tgFileUrl, { headers: fetchHeaders });

      res.status(tgResponse.status);
      res.setHeader('Content-Type', tgResponse.headers.get('content-type') || 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const contentRange = tgResponse.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }
      const contentLength = tgResponse.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const buffer = Buffer.from(await tgResponse.arrayBuffer());
      res.send(buffer);
      return;
    } catch (err) {
      logger.error({ err, fileId }, 'Failed to stream video from Telegram Cloud');
      res.status(502).json({ error: { code: 'TELEGRAM_FETCH_FAILED', message: 'Could not stream draw video from Telegram Cloud' } });
      return;
    }
  }

  if (videoRef.startsWith('local:')) {
    const filename = videoRef.slice(6);
    const filePath = path.resolve(LOCAL_STORAGE_DIR, path.basename(filename));

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Draw video file missing on server' } });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] || '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=86400',
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // Redirect if external URL
  res.redirect(videoRef);
}


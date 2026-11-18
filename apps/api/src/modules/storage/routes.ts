import fs from 'node:fs';
import path from 'node:path';
import express, { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { authenticateCustomer } from '../auth/middleware.js';
import {
  generateSignedUploadUrl,
  verifyStorageSignature,
  writeStorageFile,
  readStorageFile,
  detectMagicBytes,
  StorageError,
} from './service.js';

export const uploadsRouter = Router();

// Common handler for presigned upload URLs (Customer authenticated)
function handlePresignUpload(req: Request, res: Response): void {
  const user = req.user!;
  const mimeType =
    (req.body?.mimeType as string) ||
    (req.body?.contentType as string) ||
    'image/jpeg';
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const storageKey = `proofs/${user.id}/${Date.now()}-${randomSuffix}`;

  const signed = generateSignedUploadUrl(storageKey, mimeType, 300);
  res.status(200).json({
    ...signed,
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
  });
}

// POST /uploads/payment-proof (Customer authenticated)
uploadsRouter.post('/payment-proof', authenticateCustomer, handlePresignUpload);

// POST /uploads/presign (Customer authenticated alias for web client)
uploadsRouter.post('/presign', authenticateCustomer, handlePresignUpload);

// Binary parser for direct upload via signed URL
const rawBodyParser = express.raw({
  type: ['image/*', 'application/pdf', 'application/octet-stream'],
  limit: '6mb', // Allow up to 6MB so we can catch and reject >5MB in service
});

// PUT /uploads/storage/:token (Upload via Presigned URL)
uploadsRouter.put('/storage/:token', rawBodyParser, async (req: Request, res: Response) => {
  const tokenStr = req.params.token as string;
  try {
    const payload = verifyStorageSignature(tokenStr);
    if (payload.action !== 'upload') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Token not authorized for upload' } });
      return;
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    await writeStorageFile(payload.key, buffer);

    res.status(200).json({ success: true, key: payload.key });
  } catch (err) {
    if (err instanceof StorageError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process upload' } });
  }
});

// GET /uploads/storage/:token (Private Download via Presigned URL)
uploadsRouter.get('/storage/:token', async (req: Request, res: Response) => {
  const tokenStr = req.params.token as string;
  try {
    const payload = verifyStorageSignature(tokenStr);
    if (payload.action !== 'download') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Token not authorized for download' } });
      return;
    }

    const buffer = await readStorageFile(payload.key);

    // Determine MIME type: prefer token payload, then sniff magic bytes, then filename fallback
    let mimeType = payload.contentType;
    if (!mimeType || mimeType === 'application/octet-stream') {
      const detected = detectMagicBytes(buffer);
      if (detected.isValid && detected.mimeType) {
        mimeType = detected.mimeType;
      } else {
        const ext = (payload.filename || '').split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'webp') mimeType = 'image/webp';
        else if (ext === 'pdf') mimeType = 'application/pdf';
        else mimeType = 'image/jpeg';
      }
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${payload.filename || 'evidence.jpg'}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof StorageError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to download file' } });
  }
});

// GET /uploads/campaign-images/:filename (Public campaign images)
uploadsRouter.get('/campaign-images/:filename', (req: Request, res: Response) => {
  const rawParam = req.params.filename;
  if (!rawParam) {
    res.status(400).send('Filename missing');
    return;
  }
  const filename = path.basename(rawParam);
  const filePath = path.resolve(process.cwd(), 'data/storage/campaign-images', filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).send('Image not found');
    return;
  }
  let contentType = 'image/jpeg';
  if (filename.endsWith('.png')) contentType = 'image/png';
  else if (filename.endsWith('.webp')) contentType = 'image/webp';
  else if (filename.endsWith('.gif')) contentType = 'image/gif';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

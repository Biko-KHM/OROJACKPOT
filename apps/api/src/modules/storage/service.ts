import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { getTelegramClient } from '../telegram/client.js';

export class StorageError extends Error {
  constructor(
    public readonly code:
      | 'FILE_NOT_FOUND'
      | 'FILE_TOO_LARGE'
      | 'INVALID_FILE_TYPE'
      | 'INVALID_SIGNATURE'
      | 'URL_EXPIRED'
      | 'UNAUTHORIZED',
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface StorageTokenPayload {
  key: string;
  action: 'upload' | 'download';
  exp: number; // Unix timestamp in ms
  contentType?: string;
  filename?: string;
}

const STORAGE_ROOT = path.resolve(process.cwd(), 'data/storage');

// Ensure local private storage root exists
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

/**
 * Creates an HMAC-SHA256 signed storage token.
 */
export function createStorageSignature(payload: StorageTokenPayload): string {
  const payloadStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(payloadStr).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${hmac}`;
}

/**
 * Verifies an HMAC-SHA256 signed storage token in constant time.
 */
export function verifyStorageSignature(signedToken: string): StorageTokenPayload {
  const parts = signedToken.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new StorageError('INVALID_SIGNATURE', 'Malformed storage token', 401);
  }

  const [base64Payload, signature] = parts;
  const expectedHmac = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(base64Payload)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedHmac);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new StorageError('INVALID_SIGNATURE', 'Invalid token signature', 403);
  }

  const payload: StorageTokenPayload = JSON.parse(
    Buffer.from(base64Payload, 'base64url').toString('utf8'),
  );

  if (Date.now() > payload.exp) {
    throw new StorageError('URL_EXPIRED', 'Signed storage URL has expired', 403);
  }

  return payload;
}

/**
 * Generates a signed upload URL valid for 5 minutes (300 seconds).
 */
export function generateSignedUploadUrl(
  storageKey: string,
  contentType: string,
  expiresInSeconds = 300,
): { uploadUrl: string; storageKey: string; expiresInSeconds: number } {
  const exp = Date.now() + expiresInSeconds * 1000;
  const token = createStorageSignature({
    key: storageKey,
    action: 'upload',
    exp,
    contentType,
  });

  const uploadUrl = `/uploads/storage/${token}`;
  return { uploadUrl, storageKey, expiresInSeconds };
}

/**
 * Generates a signed download URL valid for 5 minutes (300 seconds).
 */
export function generateSignedDownloadUrl(
  storageKey: string,
  downloadFilename = 'evidence',
  expiresInSeconds = 300,
  contentType?: string,
): { downloadUrl: string; expiresInSeconds: number } {
  const exp = Date.now() + expiresInSeconds * 1000;
  const token = createStorageSignature({
    key: storageKey,
    action: 'download',
    exp,
    filename: downloadFilename,
    contentType,
  });

  const downloadUrl = `/uploads/storage/${token}`;
  return { downloadUrl, expiresInSeconds };
}

/**
 * Writes a buffer to private storage.
 */
export async function writeStorageFile(storageKey: string, buffer: Buffer): Promise<void> {
  const safePath = path.resolve(STORAGE_ROOT, storageKey);
  // Prevent directory traversal attacks
  if (!safePath.startsWith(STORAGE_ROOT)) {
    throw new StorageError('UNAUTHORIZED', 'Invalid storage key path', 403);
  }

  const dir = path.dirname(safePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  await fs.promises.writeFile(safePath, buffer);
}

/**
 * Reads a buffer from private storage (supports local private filesystem or Telegram Cloud).
 */
export async function readStorageFile(storageKey: string): Promise<Buffer> {
  if (storageKey.startsWith('tg:')) {
    const fileId = storageKey.slice(3);
    const client = getTelegramClient();
    try {
      const fileInfo = await client.getFile(fileId);
      if (!fileInfo?.file_path) {
        throw new Error('No file_path returned by Telegram getFile');
      }
      return await client.downloadFile(fileInfo.file_path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError('FILE_NOT_FOUND', `Failed to retrieve receipt from Telegram: ${msg}`, 404);
    }
  }

  const safePath = path.resolve(STORAGE_ROOT, storageKey);
  if (!safePath.startsWith(STORAGE_ROOT) || !fs.existsSync(safePath)) {
    throw new StorageError('FILE_NOT_FOUND', `Storage file not found: ${storageKey}`, 404);
  }

  return fs.promises.readFile(safePath);
}

/**
 * Checks if a file exists in private storage.
 */
export function hasStorageFile(storageKey: string): boolean {
  if (storageKey.startsWith('tg:')) {
    return true;
  }
  const safePath = path.resolve(STORAGE_ROOT, storageKey);
  return safePath.startsWith(STORAGE_ROOT) && fs.existsSync(safePath);
}

/**
 * Deletes a file from local storage if not hosted on Telegram.
 */
export async function deleteStorageFile(storageKey: string): Promise<void> {
  if (storageKey.startsWith('tg:')) {
    return;
  }
  const safePath = path.resolve(STORAGE_ROOT, storageKey);
  if (safePath.startsWith(STORAGE_ROOT) && fs.existsSync(safePath)) {
    await fs.promises.unlink(safePath).catch(() => {});
  }
}

/**
 * Magic bytes validation for allowed payment proof file types:
 * JPEG, PNG, WebP, PDF.
 * Explicitly rejects SVG, HTML, scripts and executables.
 */
export function detectMagicBytes(buffer: Buffer): {
  isValid: boolean;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null;
} {
  if (buffer.length < 8) {
    return { isValid: false, mimeType: null };
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isValid: true, mimeType: 'image/jpeg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, mimeType: 'image/png' };
  }

  // 3. WebP: 'RIFF' .... 'WEBP'
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return { isValid: true, mimeType: 'image/webp' };
  }

  // 4. PDF: '%PDF-' (25 50 44 46 2D)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { isValid: true, mimeType: 'application/pdf' };
  }

  return { isValid: false, mimeType: null };
}

/**
 * Strips EXIF metadata chunks and comments from image buffers.
 * Removes APP1 (Exif) markers in JPEG and eXIf/tEXt chunks in PNG.
 */
export function stripExifMetadata(buffer: Buffer, mimeType: string): Buffer {
  if (mimeType === 'image/jpeg') {
    return stripJpegExif(buffer);
  }
  if (mimeType === 'image/png') {
    return stripPngExif(buffer);
  }
  return buffer;
}

/**
 * Strips APP1 (0xFFE1) EXIF segments from JPEG images.
 */
function stripJpegExif(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return buffer;
  }

  const chunks: Buffer[] = [buffer.subarray(0, 2)]; // Start of Image (SOI)
  let pos = 2;

  while (pos < buffer.length) {
    if (buffer[pos] !== 0xff) {
      // Reached image scan data or malformed segment; append the rest
      chunks.push(buffer.subarray(pos));
      break;
    }

    const marker = buffer[pos + 1];
    if (marker === 0xd9) {
      // End of Image (EOI)
      chunks.push(buffer.subarray(pos, pos + 2));
      break;
    }

    if (marker === 0xda) {
      // Start of Scan (SOS): rest is entropy-coded image data
      chunks.push(buffer.subarray(pos));
      break;
    }

    // Segment length is 2 bytes (big endian)
    if (pos + 3 >= buffer.length) {
      chunks.push(buffer.subarray(pos));
      break;
    }

    const segmentLength = buffer.readUInt16BE(pos + 2);
    const segmentEnd = pos + 2 + segmentLength;

    // Marker 0xE1 is APP1 (EXIF metadata)
    if (marker === 0xe1) {
      // Skip this segment
      pos = segmentEnd;
    } else {
      chunks.push(buffer.subarray(pos, segmentEnd));
      pos = segmentEnd;
    }
  }

  return Buffer.concat(chunks);
}

/**
 * Strips eXIf and text metadata chunks from PNG images.
 */
function stripPngExif(buffer: Buffer): Buffer {
  if (buffer.length < 8) return buffer;

  const chunks: Buffer[] = [buffer.subarray(0, 8)]; // PNG 8-byte signature
  let pos = 8;

  while (pos + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(pos);
    const chunkType = buffer.subarray(pos + 4, pos + 8).toString('ascii');
    const totalChunkLength = 12 + chunkLength; // length (4) + type (4) + data + crc (4)

    if (pos + totalChunkLength > buffer.length) {
      chunks.push(buffer.subarray(pos));
      break;
    }

    // Drop EXIF and text metadata chunks
    if (['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(chunkType)) {
      pos += totalChunkLength;
    } else {
      chunks.push(buffer.subarray(pos, pos + totalChunkLength));
      pos += totalChunkLength;
    }
  }

  return Buffer.concat(chunks);
}

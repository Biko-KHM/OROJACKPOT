import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../logger/index.js';
import { detectMagicBytes, stripExifMetadata } from '../storage/service.js';

export interface UploadedCampaignImage {
  url: string;
  storagePath: string;
  bucket: string;
  fileSizeBytes: number;
  mimeType: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
]);

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB limit (Supabase bucket limit)

/**
 * Validates image buffer magic bytes against common image formats.
 */
function validateImageMagicBytes(buffer: Buffer, declaredMimeType: string): boolean {
  if (buffer.length < 4) return false;

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }

  // 3. GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }

  // 4. WebP: 'RIFF' .... 'WEBP'
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  // 5. SVG: Starts with <svg or <?xml ... <svg
  if (declaredMimeType.includes('svg')) {
    const textPreview = buffer.subarray(0, 500).toString('utf8').trim().toLowerCase();
    if (textPreview.includes('<svg') || (textPreview.includes('<?xml') && textPreview.includes('<svg'))) {
      return true;
    }
  }

  // 6. AVIF: 'ftypavif' or 'ftypavis'
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii').startsWith('ftypavi')) {
    return true;
  }

  return false;
}

/**
 * Determines file extension from MIME type.
 */
function getExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('svg')) return 'svg';
  if (mimeType.includes('avif')) return 'avif';
  return 'jpg';
}

/**
 * Uploads an image buffer directly to the Supabase Storage bucket `campaign-images`.
 * Uses the server-side SUPABASE_SERVICE_ROLE_KEY to authenticate.
 */
export async function uploadCampaignImageToSupabase(
  rawBuffer: Buffer,
  originalFilename: string,
  declaredMimeType: string,
  _campaignId?: string,
): Promise<UploadedCampaignImage> {
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new Error('Image data is empty');
  }

  if (rawBuffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image size (${(rawBuffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB`);
  }

  // Normalize MIME type
  let mimeType = declaredMimeType.split(';')[0]?.trim().toLowerCase() || 'image/jpeg';
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    // Attempt auto-detection via detectMagicBytes
    const detected = detectMagicBytes(rawBuffer);
    if (detected.isValid && detected.mimeType && detected.mimeType !== 'application/pdf') {
      mimeType = detected.mimeType;
    } else {
      throw new Error(`Unsupported image type: ${mimeType}. Allowed formats: JPEG, PNG, WebP, GIF, SVG, AVIF.`);
    }
  }

  // Validate magic bytes
  if (!validateImageMagicBytes(rawBuffer, mimeType)) {
    throw new Error('File contents do not match a valid image format.');
  }

  // Strip EXIF metadata for user privacy and security
  let processedBuffer = rawBuffer;
  try {
    processedBuffer = stripExifMetadata(rawBuffer, mimeType);
  } catch {
    // If stripping fails, proceed with raw buffer
    processedBuffer = rawBuffer;
  }

  const ext = getExtensionForMimeType(mimeType);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const sanitizedBase = (originalFilename || 'image')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 32);
  // Store directly at the root of the bucket without nested folders
  const storagePath = `${sanitizedBase}-${Date.now()}-${randomSuffix}.${ext}`;

  const supabaseUrl = process.env.SUPABASE_URL || config.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    config.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || config.SUPABASE_STORAGE_BUCKET;

  if (!supabaseKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server');
  }

  const uploadEndpoint = `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`;

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: new Uint8Array(processedBuffer),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    logger.error(
      { status: response.status, statusText: response.statusText, errorBody },
      'Supabase Storage upload failed',
    );
    throw new Error(`Supabase Storage upload failed (${response.status}): ${errorBody || response.statusText}`);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;

  logger.info({ storagePath, publicUrl, size: processedBuffer.length }, 'Campaign image uploaded to Supabase Storage');

  return {
    url: publicUrl,
    storagePath,
    bucket,
    fileSizeBytes: processedBuffer.length,
    mimeType,
  };
}

/**
 * Deletes a campaign image from the Supabase Storage bucket.
 * Extracts the storage path from either a full Supabase URL or a direct relative path.
 */
export async function deleteCampaignImageFromSupabase(storagePathOrUrl: string): Promise<boolean> {
  if (!storagePathOrUrl) return false;

  const supabaseUrl = process.env.SUPABASE_URL || config.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    config.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || config.SUPABASE_STORAGE_BUCKET;

  if (!supabaseKey) return false;

  let storagePath = storagePathOrUrl;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${bucket}/`;
  if (storagePath.startsWith(publicPrefix)) {
    storagePath = storagePath.substring(publicPrefix.length);
  } else if (storagePath.includes(`/${bucket}/`)) {
    storagePath = storagePath.substring(storagePath.indexOf(`/${bucket}/`) + `/${bucket}/`.length);
  }

  // Prevent directory traversal attacks
  if (storagePath.includes('..') || storagePath.startsWith('/')) {
    logger.warn({ storagePath }, 'Invalid storage path for deletion');
    return false;
  }

  try {
    const deleteEndpoint = `${supabaseUrl}/storage/v1/object/${bucket}`;
    const response = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [storagePath] }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, storagePath }, 'Supabase image deletion returned non-OK');
      return false;
    }

    logger.info({ storagePath }, 'Deleted old campaign image from Supabase Storage');
    return true;
  } catch (err) {
    logger.warn({ err, storagePath }, 'Failed to delete campaign image from Supabase Storage');
    return false;
  }
}

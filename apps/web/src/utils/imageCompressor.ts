/**
 * Client-side Image Optimization and Compression Utility
 *
 * Resizes large camera photos (10MB - 30MB) from mobile devices down to
 * crisp, web-optimized images (~150KB - 300KB) before uploading.
 *
 * Benefits:
 * - Eliminates mobile upload timeouts and 'Failed to fetch' errors on 3G/4G/LTE.
 * - Prevents Out-Of-Memory / call-stack overflow crashes in mobile WebViews.
 * - Bypasses server payload limits without losing visual quality.
 */

export interface CompressImageOptions {
  /** Maximum width or height in pixels. Defaults to 1200px. */
  maxDimension?: number;
  /** Output JPEG quality between 0.1 and 1.0. Defaults to 0.85. */
  quality?: number;
  /** Desired MIME type. Defaults to 'image/jpeg' for best cross-platform compression. */
  mimeType?: string;
}

/**
 * Resizes and compresses an image File or Blob in the browser using HTML5 Canvas.
 * Returns a lightweight Blob ready for direct upload.
 */
export async function compressImageFile(
  fileOrBlob: File | Blob,
  options: CompressImageOptions = {},
): Promise<Blob> {
  const maxDimension = options.maxDimension || 1200;
  const quality = options.quality ?? 0.85;
  const outputMime = options.mimeType || 'image/jpeg';

  // SVG images are vector-based and should not be rasterized via canvas
  if (fileOrBlob.type === 'image/svg+xml') {
    return fileOrBlob;
  }

  // Small images (< 150KB) that are already reasonable don't need aggressive compression
  if (fileOrBlob.size < 150 * 1024 && (fileOrBlob.type === 'image/jpeg' || fileOrBlob.type === 'image/webp')) {
    return fileOrBlob;
  }

  try {
    // 1. Load image source into an ImageBitmap or HTMLImageElement
    let imgWidth = 0;
    let imgHeight = 0;
    let imageSource: CanvasImageSource | null = null;

    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(fileOrBlob);
        imgWidth = bitmap.width;
        imgHeight = bitmap.height;
        imageSource = bitmap;
      } catch (bitmapErr) {
        // createImageBitmap can fail on some mobile formats (e.g. SVG or broken EXIF); fall back to Image()
        console.warn('createImageBitmap failed, falling back to HTMLImageElement:', bitmapErr);
      }
    }

    if (!imageSource) {
      const img = new Image();
      const objectUrl = URL.createObjectURL(fileOrBlob);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image in browser for optimization'));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);
      imgWidth = img.naturalWidth || img.width;
      imgHeight = img.naturalHeight || img.height;
      imageSource = img;
    }

    if (!imageSource || imgWidth <= 0 || imgHeight <= 0) {
      return fileOrBlob;
    }

    // 2. Calculate proportional target dimensions
    let targetWidth = imgWidth;
    let targetHeight = imgHeight;

    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
        targetWidth = maxDimension;
      } else {
        targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
        targetHeight = maxDimension;
      }
    }

    // 3. Render into an off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      return fileOrBlob;
    }

    // High quality downscaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // White background in case the input was transparent PNG converted to JPEG
    if (outputMime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }

    ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

    // Clean up ImageBitmap if applicable
    if ('close' in imageSource && typeof (imageSource as ImageBitmap).close === 'function') {
      (imageSource as ImageBitmap).close();
    }

    // 4. Export compressed Blob
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        outputMime,
        quality,
      );
    });

    if (compressedBlob && compressedBlob.size > 0) {
      return compressedBlob;
    }

    return fileOrBlob;
  } catch (err) {
    console.warn('Image optimization encountered an error, falling back to original file:', err);
    return fileOrBlob;
  }
}


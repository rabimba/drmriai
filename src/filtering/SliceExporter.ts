import { imageLoader } from '@cornerstonejs/core';
import type { SelectedSlice } from './types';
import { logger } from '../utils/logger';

const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

interface ExportedSlice {
  blob: Blob;
  instanceNumber: number;
  zPosition: number;
}

/** Canvas abstraction: OffscreenCanvas where available, DOM canvas fallback (older Safari). */
interface CanvasTarget {
  width: number;
  height: number;
  getContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  toJpeg(): Promise<Blob | null>;
  asSource(): CanvasImageSource;
}

function createCanvasTarget(width: number, height: number): CanvasTarget {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return {
      width,
      height,
      getContext: () => canvas.getContext('2d'),
      toJpeg: () => canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }),
      asSource: () => canvas,
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    width,
    height,
    getContext: () => canvas.getContext('2d'),
    toJpeg: () => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)),
    asSource: () => canvas,
  };
}

export async function exportSlicesToJpeg(
  slices: SelectedSlice[],
  windowCenter: number,
  windowWidth: number,
  options: { maxLongEdge?: number } = {},
): Promise<ExportedSlice[]> {
  const results: ExportedSlice[] = [];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const blob = await renderSliceToJpeg(slice.imageId, windowCenter, windowWidth, options.maxLongEdge ?? MAX_LONG_EDGE);
    if (blob) {
      results.push({
        blob,
        instanceNumber: slice.instanceNumber,
        zPosition: slice.zPosition,
      });
    }
    // Yield to the event loop every few slices so large exports don't freeze the UI
    if (i % 4 === 3) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}

async function renderSliceToJpeg(
  imageId: string,
  windowCenter: number,
  windowWidth: number,
  maxLongEdge: number,
): Promise<Blob | null> {
  const image = await imageLoader.loadAndCacheImage(imageId);

  const { columns: width, rows: height } = image;
  const pixelData = image.getPixelData();
  const numPixels = width * height;

  const rgba = new Uint8ClampedArray(numPixels * 4);

  // Color images (RGB / YBR / palette): no windowing — pass channels through.
  if (image.color === true) {
    if (pixelData.length === numPixels * 4) {
      // RGBA
      rgba.set(pixelData.subarray(0, numPixels * 4));
    } else if (pixelData.length === numPixels * 3) {
      // RGB triplets
      for (let i = 0, j = 0; i < numPixels; i++, j += 3) {
        const offset = i * 4;
        rgba[offset] = pixelData[j];
        rgba[offset + 1] = pixelData[j + 1];
        rgba[offset + 2] = pixelData[j + 2];
        rgba[offset + 3] = 255;
      }
    } else {
      logger.warn(`[SliceExporter] Color image with unexpected pixel data length (${pixelData.length} vs ${numPixels}px) — skipping`);
      return null;
    }
  } else {
    // Grayscale: apply rescale slope/intercept then windowing.
    const slope = image.slope ?? 1;
    const intercept = image.intercept ?? 0;
    const lower = windowCenter - windowWidth / 2;
    const upper = windowCenter + windowWidth / 2;
    // MONOCHROME1 = inverted grayscale (low values bright)
    const invert = image.photometricInterpretation === 'MONOCHROME1';

    for (let i = 0; i < numPixels && i < pixelData.length; i++) {
      const hu = pixelData[i] * slope + intercept;

      let val: number;
      if (hu <= lower) {
        val = 0;
      } else if (hu >= upper) {
        val = 255;
      } else {
        val = ((hu - lower) / windowWidth) * 255;
      }
      if (invert) val = 255 - val;

      const offset = i * 4;
      rgba[offset] = val;
      rgba[offset + 1] = val;
      rgba[offset + 2] = val;
      rgba[offset + 3] = 255;
    }
  }

  // Render to canvas
  const canvas = createCanvasTarget(width, height);
  const ctx = canvas.getContext();
  if (!ctx) return null;

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  // Resize if needed (keep aspect ratio)
  const longEdge = Math.max(width, height);
  if (longEdge > maxLongEdge) {
    const scale = maxLongEdge / longEdge;
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    const resized = createCanvasTarget(newW, newH);
    const resizedCtx = resized.getContext();
    if (!resizedCtx) return null;

    resizedCtx.drawImage(canvas.asSource(), 0, 0, newW, newH);
    return resized.toJpeg();
  }

  return canvas.toJpeg();
}

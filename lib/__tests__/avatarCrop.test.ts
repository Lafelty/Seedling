import { describe, expect, it } from 'vitest';
import {
  clampView,
  coverScale,
  CROP_MAX_ZOOM,
  CROP_OUTPUT_PX,
  croppedFileName,
  outputSize,
  panBounds,
  sourceRect,
} from '../avatarCrop';

/** A 300px frame, which is what the cropper renders at on a phone. */
const FRAME = 300;

const LANDSCAPE = { width: 2000, height: 1000 };
const PORTRAIT = { width: 1000, height: 2000 };
const SQUARE = { width: 1000, height: 1000 };

describe('coverScale', () => {
  it('fills the frame from the shorter side', () => {
    expect(coverScale(LANDSCAPE, FRAME)).toBeCloseTo(0.3);
    expect(coverScale(PORTRAIT, FRAME)).toBeCloseTo(0.3);
  });

  it('falls back to 1 for a photo with no size yet', () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
    expect(coverScale(SQUARE, 0)).toBe(1);
  });
});

describe('panBounds', () => {
  it('gives a square photo no slack at all', () => {
    expect(panBounds(SQUARE, FRAME, 1)).toEqual({ x: 0, y: 0 });
  });

  it('gives a landscape photo slack sideways only', () => {
    const bounds = panBounds(LANDSCAPE, FRAME, 1);
    expect(bounds.x).toBeCloseTo(150);
    expect(bounds.y).toBe(0);
  });

  it('gives a portrait photo slack up and down only', () => {
    const bounds = panBounds(PORTRAIT, FRAME, 1);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBeCloseTo(150);
  });

  it('grows the slack as the patient zooms in', () => {
    expect(panBounds(SQUARE, FRAME, 2).x).toBeCloseTo(150);
  });
});

describe('clampView', () => {
  it('holds a square photo still until it is zoomed', () => {
    const view = clampView({ zoom: 1, offsetX: 80, offsetY: -40 }, SQUARE, FRAME);
    expect(view.zoom).toBe(1);
    expect(view.offsetX).toBeCloseTo(0);
    expect(view.offsetY).toBeCloseTo(0);
  });

  it('stops a drag at the edge of the photo', () => {
    const view = clampView({ zoom: 1, offsetX: 900, offsetY: 900 }, LANDSCAPE, FRAME);
    expect(view.offsetX).toBeCloseTo(150);
    expect(view.offsetY).toBe(0);
  });

  it('pulls a cornered photo back in when the zoom drops', () => {
    const zoomedIn = clampView({ zoom: 3, offsetX: 999, offsetY: 999 }, SQUARE, FRAME);
    expect(zoomedIn.offsetX).toBeCloseTo(300);

    const zoomedOut = clampView({ ...zoomedIn, zoom: 1.5 }, SQUARE, FRAME);
    expect(zoomedOut.offsetX).toBeCloseTo(75);
  });

  it('keeps the zoom inside its range', () => {
    expect(clampView({ zoom: 0.2, offsetX: 0, offsetY: 0 }, SQUARE, FRAME).zoom).toBe(1);
    expect(clampView({ zoom: 99, offsetX: 0, offsetY: 0 }, SQUARE, FRAME).zoom).toBe(CROP_MAX_ZOOM);
  });

  it('survives a non-finite offset rather than passing NaN to a canvas', () => {
    const view = clampView({ zoom: 2, offsetX: Number.NaN, offsetY: 0 }, SQUARE, FRAME);
    expect(Number.isFinite(view.offsetX)).toBe(true);
  });
});

describe('sourceRect', () => {
  it('takes the middle square of an untouched landscape photo', () => {
    expect(sourceRect({ zoom: 1, offsetX: 0, offsetY: 0 }, LANDSCAPE, FRAME)).toEqual({
      x: 500,
      y: 0,
      size: 1000,
    });
  });

  it('takes the whole of an untouched square photo', () => {
    expect(sourceRect({ zoom: 1, offsetX: 0, offsetY: 0 }, SQUARE, FRAME)).toEqual({
      x: 0,
      y: 0,
      size: 1000,
    });
  });

  it('moves the crop opposite the drag — dragging right shows what was left', () => {
    const rect = sourceRect({ zoom: 1, offsetX: 60, offsetY: 0 }, LANDSCAPE, FRAME);
    expect(rect.x).toBeCloseTo(300);
    expect(rect.size).toBeCloseTo(1000);
  });

  it('shrinks the crop as the zoom rises', () => {
    const rect = sourceRect({ zoom: 2, offsetX: 0, offsetY: 0 }, SQUARE, FRAME);
    expect(rect.size).toBeCloseTo(500);
    expect(rect.x).toBeCloseTo(250);
    expect(rect.y).toBeCloseTo(250);
  });

  it('never asks for pixels outside the photo', () => {
    const rect = sourceRect({ zoom: 1, offsetX: 10_000, offsetY: 10_000 }, PORTRAIT, FRAME);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.size).toBeLessThanOrEqual(PORTRAIT.width);
    expect(rect.y + rect.size).toBeLessThanOrEqual(PORTRAIT.height);
  });
});

describe('outputSize', () => {
  it('caps a large crop at the stored size', () => {
    expect(outputSize({ x: 0, y: 0, size: 1800 })).toBe(CROP_OUTPUT_PX);
  });

  it('never upscales a small crop', () => {
    expect(outputSize({ x: 0, y: 0, size: 240 })).toBe(240);
  });

  it('keeps a floor so a hard zoom still stores something', () => {
    expect(outputSize({ x: 0, y: 0, size: 4 })).toBe(64);
  });
});

describe('croppedFileName', () => {
  it('keeps the original name recognisable and states the new type', () => {
    expect(croppedFileName('holiday.png')).toBe('holiday-cropped.jpg');
    expect(croppedFileName('IMG_0042.HEIC')).toBe('IMG_0042-cropped.jpg');
  });

  it('handles a name with no extension', () => {
    expect(croppedFileName('photo')).toBe('photo-cropped.jpg');
  });
});

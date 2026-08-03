// Turning a picked photo into the square that actually gets stored.
//
// A profile picture is always shown inside a circle (see components/ProfileAvatar),
// and `object-fit: cover` decides which part of the photo survives that circle.
// Letting the browser decide means a patient who uploads a full-body photo gets a
// circle full of torso. So the patient frames it themselves, and what we upload is
// the square they framed — the circle is then just that square with its corners
// hidden.
//
// The geometry lives here rather than in the component so it can be tested
// without a canvas: the component only owns pointers and pixels on screen.

/** The stored picture's side, in pixels. Plenty for a 76px circle on any screen. */
export const CROP_OUTPUT_PX = 512;

/** How far in the patient can push. Past this, a phone photo is only blur. */
export const CROP_MAX_ZOOM = 4;

/**
 * Cropped output is always JPEG: the source may be a PNG or WebP with an alpha
 * channel, and a transparent avatar over the garden's surface reads as a hole.
 * Flattening onto white at export time is what stops that.
 */
export const CROP_MIME = 'image/jpeg';

/** Quality of that JPEG. High enough that no one can see the re-encode. */
export const CROP_QUALITY = 0.92;

export interface Size {
  width: number;
  height: number;
}

/**
 * How the patient has placed the photo behind the frame.
 *
 * `zoom` is a multiple of the "just covers the frame" scale, so 1 always means
 * "as far out as this photo goes". The offsets are in *frame* pixels, measured
 * from the photo's centre to the frame's centre — the same units the drag
 * handler works in, so nothing has to be converted while a finger is down.
 */
export interface CropView {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** The square of the original the frame is showing, in the photo's own pixels. */
export interface SourceRect {
  x: number;
  y: number;
  size: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** The view a freshly picked photo opens at: zoomed out, dead centre. */
export const INITIAL_VIEW: CropView = { zoom: 1, offsetX: 0, offsetY: 0 };

/**
 * The scale at zoom 1 — the photo's shorter side exactly fills the frame, which
 * is the most of it that can be shown without leaving a gap at the edges.
 */
export function coverScale(image: Size, viewport: number): number {
  const shortest = Math.min(image.width, image.height);
  if (!(shortest > 0) || !(viewport > 0)) return 1;
  return viewport / shortest;
}

/**
 * How far the photo may be dragged in each direction before a corner of the
 * frame would show through. Zero on an axis means that axis has no slack — a
 * square photo at zoom 1 cannot move at all.
 */
export function panBounds(image: Size, viewport: number, zoom: number): { x: number; y: number } {
  const scale = coverScale(image, viewport) * zoom;
  return {
    x: Math.max(0, (image.width * scale - viewport) / 2),
    y: Math.max(0, (image.height * scale - viewport) / 2),
  };
}

/**
 * The nearest view to the requested one that still fills the frame. Called on
 * every drag and zoom step, so pushing past an edge stops rather than tears a
 * hole — and so zooming back out pulls a photo that was dragged to its corner
 * back into range instead of stranding it there.
 */
export function clampView(view: CropView, image: Size, viewport: number): CropView {
  const zoom = clamp(view.zoom, 1, CROP_MAX_ZOOM);
  const bounds = panBounds(image, viewport, zoom);
  return {
    zoom,
    offsetX: clamp(view.offsetX, -bounds.x, bounds.x),
    offsetY: clamp(view.offsetY, -bounds.y, bounds.y),
  };
}

/**
 * What the frame is showing, in the photo's own pixels — the rectangle to hand
 * to `drawImage`. The view is clamped first, so a caller that has been tracking
 * a finger cannot ask for pixels the photo does not have.
 */
export function sourceRect(view: CropView, image: Size, viewport: number): SourceRect {
  const clamped = clampView(view, image, viewport);
  const scale = coverScale(image, viewport) * clamped.zoom;
  const size = viewport / scale;

  // The frame's centre, expressed in photo pixels: start at the photo's centre
  // and undo the pan.
  const centreX = image.width / 2 - clamped.offsetX / scale;
  const centreY = image.height / 2 - clamped.offsetY / scale;

  return {
    // Rounding drift at the edges is worth a clamp: a half-pixel overhang makes
    // Safari draw a transparent strip down the side of the crop.
    x: clamp(centreX - size / 2, 0, Math.max(0, image.width - size)),
    y: clamp(centreY - size / 2, 0, Math.max(0, image.height - size)),
    size,
  };
}

/**
 * The side of the stored square. Never larger than the crop itself — upscaling a
 * tight crop back to 512px only makes the file bigger, not the picture better.
 */
export function outputSize(rect: SourceRect): number {
  return Math.max(64, Math.min(CROP_OUTPUT_PX, Math.round(rect.size)));
}

/** The stored name for a crop of `original`, keeping it recognisable in a bucket listing. */
export function croppedFileName(originalName: string): string {
  const stem = originalName.replace(/\.[^./\\]+$/, '') || 'avatar';
  return `${stem}-cropped.jpg`;
}

/**
 * Loads a picked file into an `<img>` that has finished decoding, so its natural
 * size can be read. The object URL is the caller's to revoke — the same URL is
 * what the cropper shows on screen, so it has to outlive this call.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be opened.'));
    image.src = url;
  });
}

/**
 * Draws the framed square out to a file.
 *
 * White is painted under the photo before it is drawn: JPEG has no alpha, and
 * an un-filled canvas exports transparent pixels as black.
 */
export async function cropToFile(
  image: HTMLImageElement,
  view: CropView,
  viewport: number,
  originalName: string
): Promise<File> {
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const rect = sourceRect(view, natural, viewport);
  const side = outputSize(rect);

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('The picture could not be prepared.');

  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, side, side);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, side, side);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, CROP_MIME, CROP_QUALITY);
  });
  if (!blob) throw new Error('The picture could not be prepared.');

  return new File([blob], croppedFileName(originalName), { type: CROP_MIME });
}

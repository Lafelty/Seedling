// Detection Web Worker: runs the full inference engine (MediaPipe Pose /
// HandLandmarker) off the main thread so model execution never blocks
// rendering — the root cause of jank on phones. Frames arrive as transferred
// ImageBitmaps; results go back as plain Pose objects (structured clone).
//
// The only caller of new Worker(...) lives in lib/poseDetection.ts — this file
// must only ever talk to lib/detectionCore.ts.

import { initCore, detectCore, disposeCore, type TrackingMode } from './detectionCore';

type WorkerRequest =
  | { type: 'init'; id: number; mode: TrackingMode }
  | { type: 'detect'; id: number; mode: TrackingMode; bitmap: ImageBitmap; timestamp: number }
  | { type: 'dispose'; id: number };

// TS project compiles with the DOM lib, so the worker global needs a local cast.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

// Every request gets exactly one reply, whatever happens.
//
// This handler is async, so a rejection inside it never reaches
// `worker.onerror` (that only fires for uncaught SYNCHRONOUS errors) — it
// surfaces as an unhandledrejection and no reply is posted. The caller's
// promise then never settles, `detectInFlight` stays true forever, and every
// later detect() hands back the same stale pose. A throwing `bitmap.close()`
// was enough to wedge detection for the rest of the page's life. So: catch
// everything, and always post — carrying an `error` field on failure.
scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  let reply: Record<string, unknown>;

  try {
    switch (msg.type) {
      case 'init':
        reply = { type: 'init', ok: await initCore(msg.mode) };
        break;
      case 'detect':
        reply = { type: 'detect', pose: await detectCore(msg.bitmap, msg.mode, msg.timestamp) };
        break;
      case 'dispose':
        disposeCore();
        reply = { type: 'dispose' };
        break;
      default:
        reply = { type: 'unknown', error: 'unknown request type' };
    }
  } catch (error) {
    reply = {
      type: (msg as { type?: string })?.type ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (msg?.type === 'detect') {
      // Transferred in — this side owns (and must free) it, including when
      // detection threw. Its own failure must not swallow the reply.
      try {
        msg.bitmap.close();
      } catch {
        // Already closed / not closeable — nothing left to release.
      }
    }
  }

  try {
    scope.postMessage({ ...reply, id: msg.id });
  } catch {
    // Structured clone of the payload failed — still settle the caller.
    scope.postMessage({ type: reply.type, id: msg.id, error: 'reply could not be serialized' });
  }
};

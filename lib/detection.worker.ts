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

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      const ok = await initCore(msg.mode);
      scope.postMessage({ type: 'init', id: msg.id, ok });
      break;
    }
    case 'detect': {
      const pose = await detectCore(msg.bitmap, msg.mode, msg.timestamp);
      msg.bitmap.close(); // transferred in — this side owns (and must free) it
      scope.postMessage({ type: 'detect', id: msg.id, pose });
      break;
    }
    case 'dispose': {
      disposeCore();
      scope.postMessage({ type: 'dispose', id: msg.id });
      break;
    }
  }
};

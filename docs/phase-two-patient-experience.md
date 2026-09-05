# Phase 2: patient experience

This phase polishes the existing patient flows. It does not change exercise
thresholds, repetition counting, star rules, database schemas, or therapist tools.
Phase 1's authenticated start, active-time clock, durable results, and idempotent
saving remain in place.

## Changes

- Shared Garden / Exercises / Progress / Profile navigation, with active-route
  labels and safe-area spacing. Exercises is available without returning home.
- Journal and Trends are two views of Progress. Existing `/progress` and
  `/dashboard` URLs still work; the admin patient view keeps its existing actions.
- A prominent exercise action in the garden, quieter progress summaries,
  consistent number typography, and larger patient controls.
- On small phones, the journal uses a native day picker instead of undersized
  calendar buttons. Wider screens keep the full calendar and selected-day state.
- Session preparation explains the exercise, camera setup, local video processing,
  and tracking limits **before** requesting camera permission. Demonstration
  pictures have manual previous/next controls. The camera preview remains visible
  while the patient checks positioning, then Start session opens the session.
- Live sessions prioritize one readable cue, repetitions, Pause, and Exit.
  Detailed tracking information lives in the pause dialog. Joint names are spoken
  and shown with spaces instead of internal underscores.
- Native dialogs provide background inertness, keyboard focus containment, Escape
  behavior, and opener-focus restoration for exercise details, pause/exit, and
  photo cropping. Pause and exit use one dialog, not overlapping overlays.
- Failed profile loads show Retry instead of blank editable fields. Sign out lives
  in Profile. Unavailable guardian updates have concise copy and read-only saved
  preferences; saving the profile does not rewrite those preferences.
- Fixed a chart display bug found during visual review: a single measured day now
  has a visible point rather than an empty target-pose-time chart.

The Impeccable and React guidance informed the shared components, progressive
disclosure, touch targets, contrast, and preservation of the existing garden style.

## Verification

- `npm test`: 209 unit tests.
- `npm run typecheck` and `npm run build` pass. ESLint reports no errors;
  43 existing warnings remain (mostly compiler-readiness and hook dependencies).
- `npm run test:e2e`: Chromium with fake camera/pose input and intercepted APIs.
  Checks patient routes at 320, 390, 768, and 1440 pixels; WCAG A/AA axe scans;
  48px control targets; modal focus; profile failure/retry/save; populated charts;
  preparation without camera access; preview in portrait/landscape; pause/exit;
  reconnection; completion; camera denial; tracker failure; and durable save retry.
- Browser screenshots are written to ignored `test-results/` for visual review.
  Automated checks complement visual inspection; they are not proof of complete
  accessibility or clinical accuracy.

To run browser checks locally:

1. Run `npm ci` and `npx playwright install chromium`.
2. Configure the existing public Supabase environment variables locally.
3. Start `npm run dev -- --port 3000` (or a production build with `npm start`).
4. In another terminal, run `npm run test:e2e`.

All browser account requests are intercepted. No real patient records, uploads,
or emails are written by this suite. The fake camera feed is not a recording of
a person and does not validate real-world pose tracking.

## Release checks

No migration is needed. Merge/deploy remains a separate action. Before release,
check camera permissions and positioning on a physical phone, including Safari,
and complete a staging session with the deployed database. Screen-reader and
real-device checks remain necessary beyond browser emulation.

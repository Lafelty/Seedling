# Site visual refresh

The patient and admin interfaces now share forest-green actions, sage surfaces,
Manrope typography, consistent focus and press feedback, and responsive navigation.
Desktop layouts use the available space: the garden has a weekly journal beside
the illustration, and Progress places the calendar beside the selected day and
milestones. Mobile retains the patient bottom navigation and adds an admin menu.

Authentication has an original botanical welcome image. The admin exercise list
adds search and status filters, contextual action labels, pending states and
recoverable errors. The editor uses the shared palette and reports save outcomes
inline. Ordinary saves preserve publication status. Exercise thresholds, camera
logic, growth calculations and award persistence retain their existing behavior.

See [DESIGN.md](../DESIGN.md) for the audit, component rules and online references.

## Verification

Verified against a production build on September 6, 2026:

- TypeScript check and production build passed.
- 209 unit tests passed.
- ESLint reported zero errors and 43 existing warnings.
- `test:visual` passed 17 routes at 390px and 1440px: no document overflow,
  browser errors or automated WCAG A/AA violations.
- `test:admin` passed mobile navigation/focus return, search and status filtering,
  pending actions, failure recovery, delete cancellation and editor save payloads.
- `test:release` passed the patient regression suite in Chromium, Firefox and
  WebKit, including responsive scans at 320/390/768/1440px, dialog focus, profile
  recovery, authentication recovery and durable session/award retries.
- Chromium and Firefox passed the simulated camera lifecycle. The Windows WebKit
  build does not expose MediaStream/getUserMedia; its preparation and unavailable
  camera recovery passed, but its live camera lifecycle could not be exercised.

Browser checks intercept backend traffic and use synthetic fixtures. They do not
edit real patient or admin records. Automated accessibility scans supplement visual
and keyboard review; they do not constitute a complete accessibility certification.
Screenshots and reports are local artifacts in `test-results/visual-refresh/`.

To repeat the visual/admin checks, start the production server and set
`E2E_BASE_URL` to its URL before running `npm run test:visual` and
`npm run test:admin`. `npm run test:release` manages its own server.

## Image provenance

`public/images/botanical-welcome.webp` is an original image generated with the
built-in image generation tool, then encoded as WebP with sharp (83,956 bytes).
It is used by `components/AuthLayout.tsx`. No reference image was supplied.

Generation prompt:

> Create a premium botanical editorial photograph for a rehabilitation garden web app login page, portrait aspect 3:4. A small real ginkgo sapling with delicate fan shaped leaves growing from a softly sculpted mound of dark earth and lush small moss, set on a perfectly seamless very pale sage green studio background (#e7eee6). One or two larger ginkgo leaves curve gracefully in the top right foreground, cropped. The sapling is centered in lower 60% of image, with abundant calm negative space above for HTML text. Artistic photographic still life, refined soft directional morning light from top left, gently defined shadow, subtle natural texture, rich fern greens, nearly tactile leaves, sophisticated art direction, realistic not cartoon, not glossy 3D, no glass, no pot, no humans, no text, no letters, no logo, no border. Quiet optimism and growth. High quality artwork designed to crop at different responsive sizes.

## Delivery

Implementation branch: `feat/site-visual-refresh`. This task does not merge or
deploy the redesign. The existing deployed site remains on its previous version.

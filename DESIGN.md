# NeuGrow visual system

The app is used at home in daylight for short patient sessions and at a desk for
care-team administration. Keep content bright, legible and calm, with a distinctive
garden identity. This is an evolution of the existing forest/sage palette.

## Audit and direction

The previous interface had a narrow mobile column on desktop, heavy serif
headings, several button styles, repeated gradients and no persistent admin
navigation. Keep the garden illustrations, growth rules, route names, patient
navigation labels and keyboard-accessible dialogs. Modernize composition and
controls across authentication, patient pages, sessions and administration.

Design variance 5, motion intensity 3, visual density 4 (patient) / 6 (admin).
Product interfaces use one sans family, Manrope, with tabular numerals for data.
Forest green identifies primary actions and selected states. Light sage carries
the garden; neutral surfaces carry forms and tables. Destructive actions use a
separate red semantic token. Existing colorful exercise/garden art remains intact.

## Components

- Content surfaces: 16px radius; fields and rectangular buttons: 12px; navigation
  items: 10px; badges and compact filters may be pills.
- Primary: filled forest, one prominent action per task group. Secondary: bordered
  surface. Tertiary: transparent. Delete: explicit red label and confirmation.
- Minimum 48px patient actions; 44px desktop admin actions, 48px on touch layouts.
- Pointer feedback: 140–200ms color/transform transitions, restrained press depth.
  Keyboard focus is immediate and visible. Reduced motion removes travel.
- Desktop navigation uses a persistent frame. Small screens retain the four-item
  patient bottom navigation and a compact admin menu. Session camera stays immersive.
- Loading, empty, error, selected and disabled states are part of every surface.
- Existing exercise thresholds, saving, awards and permission behavior are unchanged.

## References

- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh):
  predictable action placement, consistent hierarchy and quieter navigation.
- [Headspace design story](https://developer.apple.com/news/?id=fkfnhq8u): approachable
  imagery and clear, encouraging task framing. No copied brand assets.

Baseline screenshots are in ignored `test-results/design-before/`. Visual and
functional verification uses mocked patient/admin data, never real account edits.

# Design

## Theme

Mixed: light app surfaces, dark session screen (camera + exercise mode).

Mood: "First morning in a greenhouse — pale light through glass, young green shoots emerging from dark soil."

---

## Color

Color strategy: **Restrained** for app shell, **Committed** for the session screen.

Brand seed: `oklch(0.550 0.145 150)` — moss green.

### Light mode (app shell)

```css
:root {
  --bg:        oklch(1.000 0.000 0);       /* pure white — green primary carries the nature feel */
  --surface:   oklch(0.970 0.008 150);     /* barely green-tinted white — cards, panels */
  --ink:       oklch(0.200 0.018 150);     /* near-black, faint green undertone — ≥7:1 vs bg */
  --muted:     oklch(0.530 0.012 150);     /* secondary text — ≥3.5:1 vs bg */
  --primary:   oklch(0.500 0.145 150);     /* moss green — CTAs, tree fill, active states */
  --accent:    oklch(0.780 0.090 85);      /* amber-gold — stars, milestones, badges */
  --border:    oklch(0.920 0.006 150);     /* subtle dividers */
}
```

**Text on fills:**
- `--primary` (L 0.500, saturated mid-tone): **white text** `oklch(1.000 0.000 0)`
- `--accent` (L 0.780, pale): **dark ink text** `var(--ink)`

### Dark session mode (camera + exercise screen)

```css
.session {
  --session-bg:       oklch(0.120 0.020 150);  /* deep forest dark */
  --session-surface:  oklch(0.185 0.025 150);  /* slightly lighter panel */
  --session-ink:      oklch(0.940 0.010 150);  /* near-white text */
  --session-muted:    oklch(0.640 0.015 150);  /* secondary text on dark */
  --session-primary:  oklch(0.640 0.140 150);  /* brighter green for overlays */
  --session-accent:   oklch(0.820 0.085 85);   /* gold highlights on dark */
}
```

---

## Typography

**Display / headings:** [Outfit](https://fonts.google.com/specimen/Outfit) — geometric, clean, contemporary.
**Body:** [DM Sans](https://fonts.google.com/specimen/DM+Sans) — humanist, warm, readable at small sizes.

```css
:root {
  --font-display: 'Outfit', system-ui, sans-serif;
  --font-body:    'DM Sans', system-ui, sans-serif;

  /* Mobile-first fluid scale */
  --text-xs:      clamp(0.75rem,  2vw,   0.875rem);
  --text-sm:      clamp(0.875rem, 2.5vw, 1rem);
  --text-base:    clamp(1rem,     3vw,   1.125rem);
  --text-lg:      clamp(1.125rem, 3.5vw, 1.25rem);
  --text-xl:      clamp(1.25rem,  4vw,   1.5rem);
  --text-2xl:     clamp(1.5rem,   5vw,   2rem);
  --text-3xl:     clamp(2rem,     6vw,   3rem);
  --text-display: clamp(2.5rem,   8vw,   4rem);
}
```

**Rules:**
- Body line length: max 65ch
- h1–h3: `text-wrap: balance`
- Long prose: `text-wrap: pretty`
- Display letter-spacing: `≥ -0.03em`

---

## Spacing

Base unit: 4px. Touch targets: min 48px.

```css
:root {
  --space-1:  0.25rem;
  --space-2:  0.5rem;
  --space-3:  0.75rem;
  --space-4:  1rem;
  --space-6:  1.5rem;
  --space-8:  2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
}
```

---

## Border Radius

```css
:root {
  --radius-sm:   6px;
  --radius-md:   12px;
  --radius-lg:   20px;
  --radius-xl:   28px;
  --radius-full: 9999px;  /* badges, star pills only */
}
```

---

## Motion

Energy: slow & organic — like watching a plant open.

```css
:root {
  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);    /* ease-out-quart — all transitions */
  --ease-grow: cubic-bezier(0.34, 1.2, 0.64, 1); /* gentle overshoot — tree growth only */

  --dur-fast:  200ms;   /* tap feedback */
  --dur-base:  400ms;   /* screen transitions */
  --dur-slow:  800ms;   /* section reveals, progress fills */
  --dur-grow:  1200ms;  /* tree growth animation */
}
```

**Rules:**
- No bounce or elastic except `--ease-grow` on tree growth.
- Every animation: `@media (prefers-reduced-motion: reduce)` fallback (crossfade or instant).
- Reveal animations must not gate content visibility — default state is fully visible.
- Tree growth is the signature animation; give it the most craft.

---

## Z-index Scale

```css
:root {
  --z-base:     0;
  --z-raised:   10;
  --z-dropdown: 100;
  --z-sticky:   200;
  --z-overlay:  300;
  --z-modal:    400;
  --z-toast:    500;
  --z-tooltip:  600;
}
```

---

## Key Components

### Tree progress card
Central hero on the dashboard.
- Full-width, organic tree silhouette illustration
- Background shifts with growth stage (pale soil → sapling → leafing branches)
- Star count (`--accent`) displayed below
- No card border or shadow — tree lives directly on `--bg`

### Star badge
- `--accent` fill, `--ink` text, `--radius-full`
- `--text-sm`, `font-family: --font-display`
- Daily completion rewards and session totals

### Session screen (dark)
- Full-screen, `background: var(--session-bg)`
- Camera feed behind content
- Posture skeleton overlay in `--session-primary`
- Guidance text in `--session-ink` at bottom safe area
- Exit button top-right, ≥48×48px

### Progress ring
- SVG circle, `--primary` stroke, `--surface` track
- Animates on mount with `--dur-slow` + `--ease-out`

### Day strip
- 7-day horizontal scroll, current week
- Done = `--primary`, missed = `--muted`, future = `--border`

---

## Pages (initial scope)

| Route | Theme | Notes |
|---|---|---|
| `/login` | Light | Tree illustration, email/password, minimal |
| `/` (dashboard) | Light | Tree card hero, today's stars, day strip, start CTA |
| `/session` | Dark | Full-screen camera, posture overlay, exercise guidance |
| `/progress` | Light | Streak calendar, star history, milestones |
| `/onboarding` | Light | Camera permission, first exercise intro |

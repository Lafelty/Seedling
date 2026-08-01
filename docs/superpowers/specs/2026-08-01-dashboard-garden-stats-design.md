# Dashboard: garden stats — design

**Date:** 2026-08-01
**Page:** `/dashboard` (`app/dashboard/page.tsx`)

## Problem

`/dashboard` is the one screen in the app that never got the garden treatment. It
renders four flat stat cards, an orange line chart and a slate-grey bar chart —
none of which share a language with `/levels`, `/progress` or the home page. It
also carries three known correctness bugs from `docs/AUDIT_2026-07-25.md`.

## Decisions

Settled with the user before design:

| Question | Decision |
| --- | --- |
| What counts as "finished"? | `completed_at IS NOT NULL`. Matches `/progress` and `app/(dashboard)`. |
| How far back, and how fetched? | Last 12 months, one query on mount; period switching is client-side slicing. |
| How does a signed percentage render on a round gauge? | Signed wheel: gain sweeps clockwise green, loss sweeps counter-clockwise terracotta, magnitude capped at ±100%. |
| Do the charts follow the period toggle? | Yes — one page-level Week/Month control drives every card and both charts. |

## Architecture

```
app/dashboard/page.tsx        presentation + data fetch only
lib/dashboard-stats.ts        all period maths — pure, no React, no Supabase
components/GaugeWheel.tsx     the donut gauge (seed marker, travelling leaf)
components/Sprig.tsx          the pose-sprig leaf, extracted as an SVG component
components/SessionSplitBar.tsx  finished vs unfinished bar
```

The split exists so the period maths can be unit-tested without a DOM. The page
keeps one responsibility: fetch once, hold `{ mode, anchor }`, render.

### `lib/dashboard-stats.ts`

Pure functions over a `SessionRow[]`:

- `Period = { mode: 'week' | 'month'; anchor: Date }` → `resolvePeriod()` returns
  `{ start, end, prevStart, prevEnd, label, isCurrent }`. The previous period is
  always the same length immediately before, which is what every "vs last …"
  caption compares against.
- `bucketByDay(rows, start, end)` returns one entry per **calendar day** in the
  range, zero-filled. The current code does `data.slice(-14)` over days that
  happen to have sessions, so a sparse user's "Last 14 days" axis silently spans
  months (audit **m18**).
- `periodStats(rows, period)` → finished / unfinished counts, average form over
  **finished sessions only** (audit **m16** — abandoned sessions currently
  inflate session counts and drag the form average down), total reps, and
  improvement against the previous period.
- `formatDelta(value, baseline)` returns an absolute delta when the baseline is
  0, because `((3 - 0) / 0)` currently renders as "↑ 0% vs last week"
  (audit **m17**).

Day keys reuse `dayKey()` from `lib/progress.ts` — local calendar days, never
UTC. That distinction already bit this codebase once.

### `components/GaugeWheel.tsx`

A 120×120 SVG donut, `r=44`, `stroke-width 14`, round caps, rotated −90° so 0%
starts at twelve o'clock.

- Track in pale green; arc stroked with a sage → deep-green gradient.
- A **seed** marker is pinned at the twelve o'clock start — a gold disc
  (`--accent`) with a seed shape and a dark-green hairline.
- A **leaf** marker rides the arc's leading tip, positioned by trigonometry,
  carrying the same two-lobe leaf as `pose-sprig`.
- The value sits in the centre in `--font-display`.
- `signed` mode: a gain sweeps clockwise in green; a loss sweeps
  counter-clockwise in terracotta with the leaf tilted down. Magnitude is capped
  at 100% so an unbounded improvement figure can't wrap the ring.
- Growth is animated with `stroke-dashoffset` over `--dur-grow`; the leaf travels
  with the arc. `prefers-reduced-motion` renders the final state directly.
- `role="img"` with an `aria-label`, and the centre number is real text, so the
  value never depends on the drawing.

### `components/Sprig.tsx`

The `pose-sprig` leaf paths, extracted verbatim (same fills, same strokes) with a
`size` prop. The dashboard renders it at 48px against the levels page's 28px.

The sway animation stays page-local in an inline `<style>` block — the same
pattern `app/levels/[groupId]/page.tsx` already uses — so this change cannot
alter the levels page. The cost is one duplicated SVG path set; the benefit is
that a visual regression on levels is structurally impossible.

### `components/SessionSplitBar.tsx`

One rounded track: a deep-sage "finished" segment against a pale, hatched
"unfinished" remainder, with a `12 finished · 3 not finished` legend below.
Hatching, not colour alone, carries the distinction. Width animates in on mount.

## Page composition

**Header** — greeting, then one period control: a `Week | Month` segmented pill
and a `◀ August 2026 ▶` stepper whose forward arrow disables at the current
period. Sign Out moves up here as a ghost pill, matching every other page,
instead of sitting centred at the bottom of the screen.

**Four cards** (`animate-fadeInUp`, `stagger-1..4`):

| Card | Content | Sprig |
| --- | --- | --- |
| Sessions This Week/Month | finished count + `SessionSplitBar` | yes, 48px |
| Form Quality | `GaugeWheel` 0–100 + delta caption | — |
| Total Reps | number + delta caption | — |
| Improvement | `GaugeWheel` signed ± | yes, 48px |

Cards need `position: relative` and visible overflow for the sprig to stand clear
of the top edge.

**Form Quality Trend** — an `AreaChart`: a sage → deep-green line over a green
gradient fading to transparent. Horizontal grid only, very pale. Dots hidden
until hover, where the active dot is a leaf-green ring. Y axis pinned 0–100 with
ticks at 0/50/100 and no axis line.

**Sessions Per Day** — bars **stacked** finished over unfinished, tying back to
the first card. Rounded tops, gradient fill, thin bars with breathing room, and a
faint gold ground line at the baseline.

**Page** — a soft green wash behind the header, skeleton cards in place of the
"Loading your progress..." string, and a charts grid of
`minmax(min(100%, 420px), 1fr)` instead of `minmax(500px, 1fr)`, which overflows
on a tablet.

## Error handling

- A failed fetch sets an error state and renders a retry, rather than leaving the
  page on its loading text forever.
- Every derived statistic guards an empty period: no sessions means the gauges
  read 0 with an "Ready when you are" caption, not `NaN%`.
- The month stepper cannot walk past the current period, and stops 11 months back
  at the edge of the fetched window.

## Testing

`lib/dashboard-stats.test.ts` (vitest, node environment, matching the existing
`lib/__tests__` suites): period resolution across week and month modes, the
zero-fill in `bucketByDay`, finished/unfinished partitioning, the average-form
exclusion of unfinished sessions, and the zero-baseline delta.

Components are verified visually against the running dev server; the project has
no DOM test environment configured and this design does not add one.

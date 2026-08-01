'use client';

// A percentage drawn as something growing.
//
// The ring starts at a seed pinned to twelve o'clock and ends at a leaf that
// rides the arc's leading tip: the further along the patient is, the further the
// leaf has travelled from the seed. It reads as growth rather than as a filled
// container, which is the whole difference between this and a progress bar bent
// into a circle.
//
// `signed` handles the improvement figure, which can be negative and is
// unbounded. A gain sweeps clockwise in green; a loss sweeps counter-clockwise
// in terracotta with the leaf drooping. The magnitude is capped at 100% so a
// freak comparison against a near-zero baseline cannot wrap the ring around
// itself and read as a small gain.

import { useEffect, useId, useRef, useState } from 'react';
import { SprigMark } from './Sprig';

interface GaugeWheelProps {
  /** The number shown in the centre. Negative only makes sense with `signed`. */
  value: number;
  signed?: boolean;
  /** Rendered pixel size; the drawing itself is a 120-unit square. */
  size?: number;
  /** Small line under the number, inside the ring. */
  subLabel?: string;
  ariaLabel: string;
}

const CX = 60;
const CY = 60;
const R = 44;
const STROKE = 14;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Eases the arc, the leaf and the centre number off one animated value, so they
 * cannot drift out of step the way three separate CSS transitions would. On a
 * period change it grows from wherever it was rather than snapping to zero
 * first.
 */
function useGrow(target: number, duration = 800): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    let raf = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - p, 4); // ease-out-quart, matching --ease-out-quart
      const next = from + (target - from) * eased;
      fromRef.current = p < 1 ? next : target;
      setDisplay(p < 1 ? next : target);
      if (p < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

function polar(angleDeg: number, radius = R): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

export default function GaugeWheel({
  value,
  signed = false,
  size = 168,
  subLabel,
  ariaLabel,
}: GaugeWheelProps) {
  const uid = useId().replace(/:/g, '');
  const animated = useGrow(value);

  const negative = signed && animated < 0;
  // Just short of a full turn: an arc whose start and end coincide draws
  // nothing at all, so 100% would render as an empty ring.
  const fraction = Math.min(Math.abs(animated), 100) / 100 * 0.9999;

  const startAngle = -90;
  const endAngle = startAngle + (negative ? -1 : 1) * fraction * 360;
  const [sx, sy] = polar(startAngle);
  const [ex, ey] = polar(endAngle);

  const arc = `M ${sx} ${sy} A ${R} ${R} 0 ${fraction > 0.5 ? 1 : 0} ${negative ? 0 : 1} ${ex} ${ey}`;

  const rounded = Math.round(animated);
  const centre = signed
    ? `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}%`
    : `${rounded}%`;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox="0 0 120 120"
        width="100%"
        height="100%"
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="1">
            {negative ? (
              <>
                <stop offset="0%" stopColor="#E0A472" />
                <stop offset="100%" stopColor="#B4562A" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#8FD08C" />
                <stop offset="100%" stopColor="#2F6B45" />
              </>
            )}
          </linearGradient>
        </defs>

        {/* The unrun part of the ring — present, but never competing with the arc. */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="rgba(124, 199, 134, 0.22)"
          strokeWidth={STROKE}
        />

        {fraction > 0.002 && (
          <path
            d={arc}
            fill="none"
            stroke={`url(#${uid}-arc)`}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}

        {/* Seed: where every ring starts. */}
        <g transform={`translate(${sx} ${sy})`}>
          <circle r="9" fill="#F2E7C4" stroke="#B29E6C" strokeWidth="1.2" />
          <ellipse rx="2.6" ry="3.9" fill="#8A6B3A" transform="rotate(-32)" />
          <path
            d="M1.6 -3.4C3.4 -4.6 4.6 -4.4 5.4 -4.8"
            fill="none"
            stroke="#8A6B3A"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>

        {/* Leaf: where the patient has got to. It droops on a decline, so the
            direction of travel is legible without reading the colour. */}
        <g transform={`translate(${ex} ${ey})`}>
          <circle r="10" fill="#F2E7C4" stroke="#B29E6C" strokeWidth="1.2" />
          <g transform={`rotate(${negative ? 22 : -8}) scale(0.72) translate(-12 -12)`}>
            <SprigMark />
          </g>
        </g>
      </svg>

      {/* Real DOM text, not an SVG label: the value has to survive a font that
          fails to load and be selectable like every other number on the page. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          gap: '2px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: size * 0.2,
            lineHeight: 1,
            fontWeight: 600,
            color: negative ? '#9E4A22' : '#2F6B45',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {centre}
        </span>
        {subLabel && (
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--muted)',
              letterSpacing: '0.02em',
            }}
          >
            {subLabel}
          </span>
        )}
      </div>
    </div>
  );
}

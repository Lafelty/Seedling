'use client';

// How much of the period's practice was actually seen through.
//
// A patient who starts five sessions and finishes two is having a very different
// week from one who starts and finishes two, and the headline count alone cannot
// tell them apart. The unfinished share is hatched rather than merely paler:
// on a bar this thin, two tints of the same green are not a reliable difference,
// and the legend spells both numbers out in words anyway.

import { useEffect, useState } from 'react';

interface SessionSplitBarProps {
  finished: number;
  unfinished: number;
}

const HATCH =
  'repeating-linear-gradient(45deg, rgba(124, 199, 134, 0.55) 0 3px, rgba(124, 199, 134, 0.16) 3px 7px)';

export default function SessionSplitBar({ finished, unfinished }: SessionSplitBarProps) {
  const total = finished + unfinished;
  const [grown, setGrown] = useState(false);

  // Two frames, not one: a width set in the same paint as the element's first
  // appearance has nothing to transition from.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (total === 0) {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div
          style={{
            height: '10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(124, 199, 134, 0.16)',
          }}
        />
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
          Nothing planted yet
        </p>
      </div>
    );
  }

  const finishedPct = (finished / total) * 100;

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          height: '10px',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          background: 'rgba(124, 199, 134, 0.16)',
        }}
        role="img"
        aria-label={`${finished} of ${total} sessions finished`}
      >
        <div
          style={{
            width: grown ? `${finishedPct}%` : 0,
            background: 'linear-gradient(90deg, #7CC786, #2F6B45)',
            transition: 'width var(--dur-grow) var(--ease-out-quart)',
          }}
        />
        <div
          style={{
            flex: 1,
            background: HATCH,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-2)',
          fontSize: 'var(--text-xs)',
          color: 'var(--muted)',
        }}
      >
        <Key swatch="linear-gradient(90deg, #7CC786, #2F6B45)" text={`${finished} finished`} />
        {unfinished > 0 && <Key swatch={HATCH} text={`${unfinished} not finished`} />}
      </div>
    </div>
  );
}

function Key({ swatch, text }: { swatch: string; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '3px',
          background: swatch,
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
}

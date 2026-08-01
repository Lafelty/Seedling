// The garden's one recurring object: a two-leaf sprig on a stem.
//
// It marks where the patient is now — on the current pose's action on
// /levels/[groupId], and on the dashboard cards that answer "how am I doing".
// The paths are the ones the levels page draws: two leaves of different greens,
// both outlined, because an unlined light-green leaf disappears against the pale
// green surfaces it sits on.
//
// Motion is deliberately not here. Each page owns its own sway keyframes, so a
// change to how the sprig moves on one screen cannot reach another.

interface SprigProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The leaf pair alone, in 24×24 user units, for embedding in a larger drawing.
 * Its stem stops at the leaves rather than running past the bottom edge — a
 * marker riding a gauge has nothing to plant itself into.
 */
export function SprigMark() {
  return (
    <g>
      <path d="M12 17.5V12.5" stroke="#2A5F3C" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M12 14c-4.4 0-6.6-2.2-6.6-6.6C9.8 7.4 12 9.6 12 14Z"
        fill="#8FD08C"
        stroke="#2A5F3C"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M12 14c4.4 0 6.6-2.2 6.6-6.6C14.2 7.4 12 9.6 12 14Z"
        fill="#C2EBAA"
        stroke="#2A5F3C"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </g>
  );
}

/**
 * The standalone sprig, stem running past the bottom of the box so it can be
 * planted into whatever it sits on top of.
 */
export default function Sprig({ size = 28, className, style }: SprigProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M12 24V12.5" stroke="#2A5F3C" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M12 14c-4.4 0-6.6-2.2-6.6-6.6C9.8 7.4 12 9.6 12 14Z"
        fill="#8FD08C"
        stroke="#2A5F3C"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M12 14c4.4 0 6.6-2.2 6.6-6.6C14.2 7.4 12 9.6 12 14Z"
        fill="#C2EBAA"
        stroke="#2A5F3C"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

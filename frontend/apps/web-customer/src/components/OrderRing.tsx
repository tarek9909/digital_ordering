import { loadMotion, prefersReducedMotion } from '@dop/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// The call ring (the ticket page's signature, after the brand mark "Almost ready"): a ring around the order number
// that closes as the order moves on, with a dot riding its leading tip. Drawn thin and untinted so the number leads. On Ready it snaps shut, the dot ignites and a
// pulse radiates. It is drawn in the venue's colour (`band`) on light pages, or in the text colour (`current`) on
// the venue-coloured Ready screen, so it reads with any brand colour. Without motion it simply shows the state.

const R = 88;
const CX = 100;

/** Last progress this page showed per ticket, so a re-mounted ring (ticket → Ready) continues from it. */
const shown = new Map<string, number>();
export const lastRingProgress = (token: string) => shown.get(token);

const motionAllowed = () => !prefersReducedMotion() && import.meta.env?.MODE !== 'test';

export function OrderRing({
  token,
  progress,
  ready = false,
  tone = 'band',
  idle = false,
  children,
  className = '',
}: {
  token: string;
  /** 0–1: how far the order has come. Ignored when `ready` (the ring is closed). */
  progress: number;
  ready?: boolean;
  tone?: 'band' | 'current';
  /** A closed-off ticket (cancelled, expired): only the track, no arc or dot. */
  idle?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const target = idle ? 0 : ready ? 1 : Math.max(0, Math.min(1, progress));
  const ref = useRef<SVGSVGElement>(null);
  // Where this ring starts: the last state shown for this ticket (or empty), then it closes toward the target.
  const [from] = useState(() => (motionAllowed() ? (shown.get(token) ?? 0) : target));
  const [tip, setTip] = useState(from);

  useEffect(() => {
    shown.set(token, target);
    let cancelled = false;
    let cleanup: (() => void) | void;
    // Arc and dot close together on one CSS transition, a frame after mount so they start from `from`.
    // (The shared runtime's arc tween rounds the pathLength=1 offset to whole pixels, so it is not used here.)
    const raf = requestAnimationFrame(() => !cancelled && setTip(target));
    // Ready: once the arc has snapped shut, the runtime ignites the dot and sends the pulse out.
    const ignite =
      ready && motionAllowed()
        ? setTimeout(
            () =>
              void loadMotion().then((rt) => {
                const el = ref.current;
                if (!cancelled && rt && el) cleanup = rt.moments.ring(el, { progress: 1, ready: true });
              }),
            from < 1 ? 560 : 0,
          )
        : undefined;
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(ignite);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [token, target, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const stroke = tone === 'band' ? 'var(--brand-band)' : 'currentColor';
  return (
    <div className={`relative grid aspect-square place-items-center ${className}`}>
      <svg ref={ref} viewBox="0 0 200 200" aria-hidden="true" className="ring-svg absolute inset-0 size-full">
        <circle cx={CX} cy={CX} r={R} fill="none" stroke={idle ? 'var(--color-line)' : stroke} strokeOpacity={idle ? 1 : 0.12} strokeWidth="3.5" strokeDasharray={idle ? '0.5 9' : undefined} strokeLinecap="round" />
        {!idle && (
          <>
            <circle data-ring-pulse cx={CX} cy={CX} r={R} fill="none" stroke={stroke} strokeWidth="2.5" opacity="0" />
            <circle
              className="ring-arc"
              data-ready={ready}
              cx={CX}
              cy={CX}
              r={R}
              fill="none"
              stroke={stroke}
              strokeWidth="3.5"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              style={{ strokeDashoffset: 1 - tip }}
              transform={`rotate(-90 ${CX} ${CX})`}
            />
            <g className="ring-tip" data-ready={ready} style={{ transform: `rotate(${tip * 360}deg)` }}>
              <circle data-ring-dot cx={CX} cy={CX - R} r={ready ? 8 : 6} fill={stroke} />
            </g>
          </>
        )}
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

/** Font size for the order number inside the ring: as large as the ring allows for its length (FR-CUS-02). */
export function numberSize(displayNumber: string) {
  const n = displayNumber.length;
  if (n <= 1) return 'min(38vw, 10rem)';
  if (n === 2) return 'min(30vw, 8.5rem)';
  if (n === 3) return 'min(23vw, 6.5rem)';
  if (n === 4) return 'min(18vw, 5rem)';
  return 'min(13vw, 3.75rem)';
}

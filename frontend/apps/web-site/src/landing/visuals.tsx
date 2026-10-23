import { useTranslation } from '@dop/i18n';
import type { ReactNode } from 'react';

// Shared visuals for the landing page: device frames, the alert-ring motif and the
// illustrated "photo" scenes. The scenes stand in for real photography: each carries `data-photo-slot` so a
// photo can replace it later without touching the layout.

/** Soft rings that radiate from a number when it becomes ready: Tanbeeh's alert motif. */
export function AlertRings({ active, className = '' }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 flex items-center justify-center ${className}`}>
      <span className="alert-ring" />
      <span className="alert-ring [animation-delay:0.6s]" />
      <span className="alert-ring [animation-delay:1.2s]" />
    </span>
  );
}

export function PhoneFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative w-[15rem] shrink-0 rounded-[2.4rem] border-[7px] border-ink bg-surface shadow-[var(--shadow-card)] ${className}`}>
      <div aria-hidden="true" className="absolute inset-x-0 top-2 z-10 mx-auto h-5 w-20 rounded-full bg-ink" />
      <div className="relative flex min-h-[25rem] flex-col overflow-hidden rounded-[1.9rem] bg-canvas pt-9">{children}</div>
    </div>
  );
}

export function TabletFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[1.6rem] border-[9px] border-ink bg-ink shadow-[var(--shadow-card)] ${className}`}>
      <div className="overflow-hidden rounded-[0.9rem] bg-ink">{children}</div>
    </div>
  );
}

export function TvFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="w-full rounded-[1rem] border-[10px] border-ink bg-ink shadow-[var(--shadow-card)]">
        <div className="aspect-video overflow-hidden rounded-[0.35rem] bg-surface">{children}</div>
      </div>
      <div aria-hidden="true" className="h-4 w-10 bg-ink" />
      <div aria-hidden="true" className="h-1.5 w-32 rounded-full bg-ink" />
    </div>
  );
}

export type SceneKind = 'service' | 'counter' | 'phone';

/**
 * Illustrated stand-in for a photograph: an evening restaurant in ink, warm bokeh lights in glow and ember, and
 * the subject drawn in simple shapes. Decorative; the section text carries the meaning.
 */
export function Scene({ kind, className = '', children }: { kind: SceneKind; className?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={`scene relative isolate overflow-hidden bg-ink ${className}`} data-photo-slot={kind} role="img" aria-label={t('landing.photoSlot')}>
      <div aria-hidden="true" className="scene-bokeh absolute inset-0" />
      {kind === 'service' && <ServiceArt />}
      {kind === 'counter' && <CounterArt />}
      {kind === 'phone' && <PhoneArt />}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
      {children}
    </div>
  );
}

/** Pendant lamps over a long counter with silhouettes waiting. */
function ServiceArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-glow">
      {[120, 300, 480, 660].map((x) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2="90" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
          <path d={`M${x - 34} 120 Q${x} 70 ${x + 34} 120 Z`} fill="currentColor" fillOpacity="0.9" />
          <ellipse cx={x} cy="128" rx="60" ry="14" fill="currentColor" fillOpacity="0.18" />
        </g>
      ))}
      <rect x="0" y="300" width="800" height="16" fill="currentColor" fillOpacity="0.25" />
      {[90, 170, 520, 610, 700].map((x, i) => (
        <g key={x} fill="currentColor" fillOpacity={0.12 + (i % 2) * 0.06}>
          <circle cx={x} cy={210 - (i % 3) * 8} r="26" />
          <rect x={x - 38} y={238 - (i % 3) * 8} width="76" height="90" rx="30" />
        </g>
      ))}
    </svg>
  );
}

/** A counter with a tablet stand and a cashier's shoulders. */
function CounterArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-glow">
      <circle cx="420" cy="90" r="70" fill="currentColor" fillOpacity="0.16" />
      <path d="M380 0 V60 M460 0 V60" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <g fill="currentColor" fillOpacity="0.2">
        <circle cx="300" cy="230" r="70" />
        <path d="M150 470 Q160 330 300 320 Q440 330 450 470 Z" />
      </g>
      <rect x="0" y="440" width="600" height="160" fill="currentColor" fillOpacity="0.14" />
      <rect x="0" y="436" width="600" height="8" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

/** A hand holding a phone whose screen glows. */
function PhoneArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 400 520" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-glow">
      <path d="M120 520 Q110 380 170 330 L250 300 Q290 300 290 340 L300 520 Z" fill="currentColor" fillOpacity="0.18" />
      <rect x="160" y="120" width="120" height="230" rx="22" fill="currentColor" fillOpacity="0.95" />
      <rect x="172" y="140" width="96" height="190" rx="12" fill="currentColor" className="text-primary" fillOpacity="0.85" />
      <text x="220" y="250" textAnchor="middle" fontSize="54" fontWeight="800" fill="white" fontFamily="Alexandria, sans-serif">
        27
      </text>
      <ellipse cx="220" cy="240" rx="150" ry="150" fill="currentColor" fillOpacity="0.08" />
    </svg>
  );
}

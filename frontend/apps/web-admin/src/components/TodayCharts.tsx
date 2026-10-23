import { useTranslation } from '@dop/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../lib/format';
import type { PaceHour, WaitingTicket } from '../lib/types';
import { Table, Td } from './common';

// The Today charts: the service ring, the pass lane and the kitchen pace line. Colours come from theme tokens;
// every chart has text alternatives (an aria-label, and a table where the numbers matter).

/** Minutes after which an open ticket is flagged on the pass. */
export const LATE_MINUTES = 12;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// ---------------------------------------------------------------- service ring

const polar = (r: number, deg: number): [number, number] => [200 + r * Math.sin((deg * Math.PI) / 180), 200 - r * Math.cos((deg * Math.PI) / 180)];
const f1 = (n: number) => n.toFixed(1);
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${f1(x0)} ${f1(y0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`;
};

/**
 * The Tanbeeh mark's ring as a dial: a bar per hour of new tickets, the arc filled up to now, the ember dot at the tip.
 * The ring runs from the earlier of 08:00 and the first ticket to midnight, leaving a gap at the top like the logo.
 */
export function ServiceRing({ hourly, open, tickets, localMinutes }: { hourly: number[]; open: number; tickets: number; localMinutes?: number }) {
  const { t } = useTranslation();
  const first = hourly.findIndex((n) => n > 0);
  const start = first >= 0 ? Math.min(8, first) : 8;
  const bins = 24 - start;
  const step = 330 / bins;
  const angle = (i: number) => 15 + i * step;
  const max = Math.max(1, ...hourly.slice(start));
  const peakHour = hourly.slice(start).reduce((best, n, i) => (n > (hourly[best] ?? 0) ? start + i : best), start);
  const nowHour = localMinutes === undefined ? -1 : localMinutes / 60;
  const nowAngle = nowHour >= start ? angle(Math.min(bins, nowHour - start)) : 15;
  const bar = (h: number) => {
    const a = angle(h - start + 0.5);
    const [x0, y0] = polar(140, a);
    const [x1, y1] = polar(140 + Math.max(2, ((hourly[h] ?? 0) / max) * 42), a);
    return `M${f1(x0)} ${f1(y0)} L${f1(x1)} ${f1(y1)}`;
  };
  const hours = Array.from({ length: bins }, (_, i) => start + i);
  const currentHour = Math.floor(nowHour);
  const [dx, dy] = polar(118, nowAngle);
  const ticks = hours.filter((h) => (h - start) % 4 === 0);
  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 400 400"
        className="w-full max-w-[24rem]"
        role="img"
        style={{ direction: 'ltr' }}
        aria-label={`${t('today.ringLabel', { tickets, open })} ${t('today.ringBusiest')}: ${t('today.ringBusiestValue', { hour: hh(peakHour), n: hourly[peakHour] ?? 0 })}.`}
      >
        <path d={arc(118, 15, 345)} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" strokeLinecap="round" />
        {nowHour >= start && <path d={arc(118, 15, Math.max(16, nowAngle))} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />}
        {hours.map((h) => {
          const isPeak = h === peakHour && (hourly[h] ?? 0) > 0;
          const isNow = h === currentHour;
          const future = nowHour >= 0 && h > currentHour;
          return (
            <path
              key={h}
              d={bar(h)}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              stroke={isNow ? 'var(--color-glow)' : 'currentColor'}
              strokeOpacity={isNow || isPeak ? 1 : future ? 0.16 : 0.5}
            />
          );
        })}
        <circle cx={f1(dx)} cy={f1(dy)} r="10" fill="var(--color-glow)" stroke="var(--color-ink)" strokeWidth="4" />
        <g fontSize="11" fill="currentColor" fillOpacity="0.6" textAnchor="middle">
          {ticks.map((h) => {
            const [x, y] = polar(96, angle(h - start));
            return (
              <text key={h} x={f1(x)} y={f1(y + 4)}>
                {hh(h)}
              </text>
            );
          })}
        </g>
        <text x="200" y="214" textAnchor="middle" fontWeight="800" fontSize="96" letterSpacing="-3" fill="currentColor" className="num font-display">
          {open}
        </text>
        <text x="200" y="246" textAnchor="middle" fontSize="15" fill="currentColor" fillOpacity="0.75">
          {t('today.ringOpen')}
        </text>
      </svg>
      <dl className="grid w-full grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm opacity-75">{t('today.ringTickets')}</dt>
          <dd className="num font-display text-2xl font-bold">{tickets}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm opacity-75">{t('today.ringBusiest')}</dt>
          <dd className="num font-display text-2xl font-bold">
            {hh(peakHour)} <span className="text-sm font-medium opacity-75">{t('today.passCount', { count: hourly[peakHour] ?? 0 })}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- pass lane

const AXIS_MIN = 25;
const CHIP_W = 62;
const CHIP_H = 34;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Placed {
  id: string;
  number: string;
  minutes: number;
  late: boolean;
  x: number;
  row: number;
}

/** Places chips along the time axis; a chip that would overlap the one before it drops to the next row. */
function place(items: WaitingTicket[], width: number): { chips: Placed[]; rows: number } {
  const usable = Math.max(1, width - CHIP_W);
  const ends: number[] = [];
  const chips = [...items]
    .sort((a, b) => a.waitingSeconds - b.waitingSeconds)
    .map((w) => {
      const minutes = w.waitingSeconds / 60;
      const x = CHIP_W / 2 + Math.min(1, minutes / AXIS_MIN) * usable;
      let row = ends.findIndex((end) => x - CHIP_W / 2 >= end + 4);
      if (row === -1) row = ends.length;
      ends[row] = x + CHIP_W / 2;
      return { id: w.id, number: w.displayNumber, minutes, late: minutes > LATE_MINUTES, x, row };
    });
  return { chips, rows: Math.max(1, ends.length) };
}

function Chip({ c, kind, left }: { c: Placed; kind: 'preparing' | 'ready'; left: number }) {
  const { t } = useTranslation();
  const style = c.late ? 'border-danger bg-danger-bg text-danger' : kind === 'ready' ? 'border-ok bg-ok-bg text-ok' : 'border-ink bg-surface text-ink';
  return (
    <span
      className={`num absolute flex items-center justify-center gap-1 rounded-full border-[1.5px] font-display text-[0.8125rem] font-bold whitespace-nowrap ${style}`}
      style={{ insetInlineStart: left - CHIP_W / 2, top: 8 + c.row * (CHIP_H + 4), width: CHIP_W, height: CHIP_H }}
      title={`${c.number}: ${t('today.passMin', { n: Math.round(c.minutes) })}`}
    >
      {c.late && (
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1 L11 10.5 H1 Z" fill="currentColor" />
        </svg>
      )}
      {c.number}
    </span>
  );
}

function Lane({ kind, items, width }: { kind: 'preparing' | 'ready'; items: WaitingTicket[]; width: number }) {
  const { t } = useTranslation();
  const { chips, rows } = useMemo(() => place(items, width), [items, width]);
  const usable = Math.max(1, width - CHIP_W);
  const lateX = CHIP_W / 2 + (LATE_MINUTES / AXIS_MIN) * usable;
  return (
    <>
      <div className="flex flex-col justify-center text-sm font-semibold">
        {t(kind === 'preparing' ? 'today.passPreparing' : 'today.passReady')}
        <span className="text-xs font-normal text-muted">{t('today.passCount', { count: items.length })}</span>
      </div>
      <div className="relative rounded-input bg-canvas" style={{ height: 16 + rows * (CHIP_H + 4) - 4 }} dir="ltr">
        <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 border-s-[1.5px] border-dashed border-danger" style={{ left: lateX }} />
        {chips.map((c) => (
          <Chip key={c.id} c={c} kind={kind} left={c.x} />
        ))}
      </div>
    </>
  );
}

/** Open tickets on a time axis: how long since each was ordered, with a dashed line where "late" starts. */
export function PassLane({ items }: { items: WaitingTicket[] }) {
  const { t } = useTranslation();
  const [ref, width] = useWidth();
  const preparing = items.filter((w) => w.status !== 'ready');
  const ready = items.filter((w) => w.status === 'ready');
  const lateX = (LATE_MINUTES / AXIS_MIN) * 100;
  const axis = [0, 5, 10, 15, 20, 25];
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2" aria-hidden="true">
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-[1.5px] border-ink" />
          {t('today.passPreparing')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-[1.5px] border-ok bg-ok-bg" />
          {t('today.passReady')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M6 1 L11 10.5 H1 Z" fill="var(--color-danger)" />
          </svg>
          {t('today.passLate', { n: LATE_MINUTES })}
        </li>
      </ul>
      <div ref={ref} className="overflow-x-auto">
        <div className="grid min-w-[30rem] grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          <Lane kind="preparing" items={preparing} width={Math.max(0, width - 116)} />
          <Lane kind="ready" items={ready} width={Math.max(0, width - 116)} />
          <div />
          <div className="relative h-9 text-xs text-muted" dir="ltr" aria-hidden="true">
            {axis.map((m) => (
              <span key={m} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(m / AXIS_MIN) * 100}%`, ...(m === 0 ? { transform: 'none' } : m === AXIS_MIN ? { transform: 'translateX(-100%)' } : {}) }}>
                {m === 0 || m === AXIS_MIN ? t('today.passMin', { n: m }) : m}
              </span>
            ))}
            <span className="num absolute top-3.5 -translate-x-1/2 font-semibold text-danger" style={{ left: `${lateX}%` }}>
              {LATE_MINUTES}
            </span>
          </div>
        </div>
      </div>
      <details>
        <summary className="inline-flex min-h-12 cursor-pointer items-center rounded-control px-2 font-semibold text-ink-2 hover:text-ink">{t('today.showTable')}</summary>
        <Table caption={t('today.longestTitle')} head={[t('today.longestNumber'), t('today.longestStatus'), t('today.longestWaiting')]}>
          {[...items].slice(0, 5).map((w) => (
            <tr key={w.id}>
              <Td>
                <span dir="ltr" className="num font-display text-base font-bold">
                  {w.displayNumber}
                </span>
              </Td>
              <Td>
                <span className={w.status === 'ready' ? 'font-semibold text-ok' : 'text-ink-2'}>{t(`common:status.${w.status}`, { defaultValue: w.status })}</span>
              </Td>
              <Td className="num font-semibold">{formatDuration(w.waitingSeconds)}</Td>
            </tr>
          ))}
        </Table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- pace

/** Median preparation time per hour with a band up to the slowest 10%; a crosshair and tooltip follow the pointer. */
export function PaceChart({ pace, todayMedian }: { pace: PaceHour[]; todayMedian: number | null }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const rows = pace.filter((p) => p.p50 !== null && p.p90 !== null);
  if (rows.length === 0) return <p className="text-muted">{t('reports.empty')}</p>;
  const h0 = Math.min(...rows.map((p) => p.hour));
  const h1 = Math.max(h0 + 3, ...rows.map((p) => p.hour));
  const maxMin = Math.max(5, Math.ceil(Math.max(...rows.map((p) => p.p90!)) / 60 / 5) * 5);
  const L = 44;
  const R = 624;
  const x = (h: number) => L + ((h - h0) / (h1 - h0)) * (R - L);
  const y = (sec: number) => 208 - (sec / 60 / maxMin) * 192;
  const median = rows.map((p) => `${f1(x(p.hour))},${f1(y(p.p50!))}`);
  const band = [...rows.map((p) => `${f1(x(p.hour))},${f1(y(p.p90!))}`), ...rows.map((p) => `${f1(x(p.hour))},${f1(y(p.p50!))}`).reverse()].join(' ');
  const grid = [0, 1, 2, 3, 4].map((i) => (maxMin / 4) * i);
  const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).filter((h, i, all) => all.length <= 8 || (h - h0) % 2 === 0);
  const active = hover === null ? null : rows[hover]!;
  const pointer = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * 640;
    let best = 0;
    rows.forEach((p, i) => {
      if (Math.abs(x(p.hour) - vx) < Math.abs(x(rows[best]!.hour) - vx)) best = i;
    });
    setHover(best);
  };
  const tipLeft = active ? Math.min(x(active.hour) + 12, 640 - 190) : 0;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2" aria-hidden="true">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ink" />
          {t('today.paceMedian')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[3px] bg-ink/10" />
          {t('today.paceSlowest')}
        </li>
        {todayMedian !== null && (
          <li className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-muted" />
            {t('today.paceToday', { value: formatDuration(todayMedian) })}
          </li>
        )}
      </ul>
      <svg
        viewBox="0 0 640 240"
        className="w-full touch-pan-y"
        style={{ direction: 'ltr' }}
        role="img"
        aria-label={t('today.paceLabel')}
        onPointerMove={(e) => pointer(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {grid.map((m) => (
          <g key={m}>
            <path d={`M${L} ${f1(y(m * 60))} H${R}`} stroke="var(--color-line)" strokeWidth="1" />
            <text x={L - 10} y={y(m * 60) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {m}
            </text>
          </g>
        ))}
        {hours.map((h) => (
          <text key={h} x={f1(x(h))} y="230" textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            {hh(h)}
          </text>
        ))}
        <polygon points={band} fill="var(--color-ink)" fillOpacity="0.09" />
        {todayMedian !== null && <path d={`M${L} ${f1(y(todayMedian))} H${R}`} stroke="var(--color-muted)" strokeWidth="1.5" strokeDasharray="5 5" />}
        <polyline points={median.join(' ')} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((p) => (
          <circle key={p.hour} cx={f1(x(p.hour))} cy={f1(y(p.p50!))} r="3" fill="var(--color-ink)" />
        ))}
        {active && (
          <g pointerEvents="none">
            <path d={`M${f1(x(active.hour))} 16 V208`} stroke="var(--color-ink-2)" strokeWidth="1" />
            <circle cx={f1(x(active.hour))} cy={f1(y(active.p50!))} r="5" fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth="2" />
            <rect x={f1(tipLeft)} y="24" width="178" height="70" rx="10" fill="var(--color-ink)" />
            <text x={f1(tipLeft + 14)} y="46" fontSize="13" fontWeight="700" fill="var(--color-surface)" className="font-display">
              {t('today.paceTip', { hour: hh(active.hour), n: active.tickets })}
            </text>
            <text x={f1(tipLeft + 14)} y="66" fontSize="12" fill="var(--color-surface)" fillOpacity="0.8">
              {t('today.paceTipMedian', { value: formatDuration(active.p50) })}
            </text>
            <text x={f1(tipLeft + 14)} y="84" fontSize="12" fill="var(--color-surface)" fillOpacity="0.8">
              {t('today.paceTipSlow', { value: formatDuration(active.p90) })}
            </text>
          </g>
        )}
      </svg>
      <details>
        <summary className="inline-flex min-h-12 cursor-pointer items-center rounded-control px-2 font-semibold text-ink-2 hover:text-ink">{t('today.showTable')}</summary>
        <Table caption={t('today.paceTitle')} head={[t('today.paceHour'), t('today.tickets'), t('today.paceMedian'), t('today.paceSlowest')]}>
          {rows.map((p) => (
            <tr key={p.hour}>
              <Td className="num whitespace-nowrap">{hh(p.hour)}</Td>
              <Td className="num">{p.tickets}</Td>
              <Td className="num">{formatDuration(p.p50)}</Td>
              <Td className="num">{formatDuration(p.p90)}</Td>
            </tr>
          ))}
        </Table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- sparkline

/** Seven days at a glance; the last point (today) is the dark dot. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const pts = values.map((v, i) => [3 + (i * 78) / (values.length - 1), 25 - ((v - lo) / span) * 22] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width="84" height="28" viewBox="0 0 84 28" role="img" aria-label={label} className="shrink-0" style={{ direction: 'ltr' }}>
      <polyline points={pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')} fill="none" stroke="var(--color-muted)" strokeOpacity="0.7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={f1(last[0])} cy={f1(last[1])} r="3.5" fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth="2" />
    </svg>
  );
}

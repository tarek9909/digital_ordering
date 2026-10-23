// Small line icons for the customer app (inline SVG, no icon library: the initial bundle budget is tight).
// They inherit the text colour and are decorative; the text next to them carries the meaning.

type P = { className?: string };
const base = (className = 'size-5') => ({
  className,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
});

export const BellIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const SoundIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a10 10 0 0 1 0 14" />
  </svg>
);

export const CheckIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const CloseIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const ShareIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

export const LinkIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const AlertIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </svg>
);

export const QuestionIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.2a2.5 2.5 0 0 1 4.85.8c0 1.7-2.45 2.2-2.45 3.6M12 17h.01" />
  </svg>
);

export const ClockIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/** Points to the reading end: flips in RTL. */
export const ChevronIcon = ({ className }: P) => (
  <svg {...base(className)} className={`${className ?? 'size-5'} rtl:-scale-x-100`}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const StarIcon = ({ className, filled }: P & { filled?: boolean }) => (
  <svg {...base(className)} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.75}>
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.2 6L12 16.7 6.5 19.6l1.2-6L3.2 9.4l6.1-.8L12 3Z" />
  </svg>
);

/** Points back toward the reading start: flips in RTL. */
export const BackIcon = ({ className }: P) => (
  <svg {...base(className)} className={`${className ?? 'size-5'} rtl:-scale-x-100`}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

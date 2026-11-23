import type { ReactNode } from 'react';
import type { Achievement } from '../domain/achievements';

/** Number drawn inside an icon; part of the accent layer. */
const num = (n: string, y: number, size: number, x = 12) => (
  <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="700" fill="currentColor" stroke="none">
    {n}
  </text>
);

const calendar = (
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </>
);

const speedometer = (n: string): [ReactNode, ReactNode] => [
  <>
    <path d="M4 12a8 8 0 0 1 13.66-5.66" />
    <path d="M12 4.5V6M6.7 6.7l1 1" />
    {num(n, 21.5, n.length > 2 ? 7 : 8)}
  </>,
  <>
    <path d="M17.66 6.34A8 8 0 0 1 20 12M12 12l4-4.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </>,
];

/** [outline, accent]: outline takes the card's text color, accent turns brand green once unlocked. */
const icons: Record<Achievement['icon'], [ReactNode, ReactNode]> = {
  'doc-check': [
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M8.5 8.5h3M8.5 11.5h7" />
    </>,
    <path d="M9.5 16.5l2 2 4-4" />,
  ],
  'docs-10': [
    <>
      <path d="M8 7V4a1 1 0 0 1 1-1h7l3 3v11a1 1 0 0 1-1 1h-2" />
      <path d="M13 7H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10z" />
    </>,
    num('10', 18, 6.5, 10.5),
  ],
  'trophy-100': [
    <>
      <path d="M6 4h12v5a6 6 0 0 1-12 0z" />
      <path d="M6 6H3.5v1A3.5 3.5 0 0 0 6.5 10.5M18 6h2.5v1a3.5 3.5 0 0 1-3 3.5M12 15v3M8 21h8M9.5 18h5" />
    </>,
    <>
      <path d="M12 .8v1.4M8.8 1.4l.6 1.2M15.2 1.4l-.6 1.2" />
      {num('100', 10.2, 5)}
    </>,
  ],
  'speed-50': speedometer('50'),
  'speed-75': speedometer('75'),
  'speed-100': speedometer('100'),
  'target-check': [
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>,
    <path d="M9 12l2 2 4-4" />,
  ],
  'flame-7': [<path d="M12 2c.6 3.5 6.5 6 7.5 11a7.5 7.5 0 1 1-15 .3c0-2.3 1.2-4 2.4-5 .3 1.6 1 2.5 2.1 3C8.5 7 10 4.3 12 2z" />, num('7', 18.8, 8.5)],
  'calendar-30': [calendar, num('30', 18.6, 7.5)],
  crown: [
    <path d="M5 18 3.5 8.5l5 3.5L12 6.5l3.5 5.5 5-3.5L19 18zM5 21h14" />,
    <>
      <circle cx="3.5" cy="7" r="1.3" fill="currentColor" />
      <circle cx="12" cy="4.7" r="1.3" fill="currentColor" />
      <circle cx="20.5" cy="7" r="1.3" fill="currentColor" />
    </>,
  ],
  'calendar-check': [calendar, <path d="M8.5 15.5l2.5 2.5 4.5-4.5" />],
  book: [<path d="M12 7c0-1.7-1.6-3-4-3H3v13M12 7c0-1.7 1.6-3 4-3h5v13M12 7v13.5" />, <path d="M3 17h5.5c2 0 3.5 1.5 3.5 3.5 0-2 1.5-3.5 3.5-3.5H21" />],
  diploma: [
    <>
      <path d="M4.5 6a3.5 3.5 0 0 0 0 7H11M4.5 6H18a3.5 3.5 0 0 1 1.5 6.7" />
      <circle cx="4.5" cy="9.5" r="1.3" />
    </>,
    <>
      <circle cx="15.5" cy="13" r="3" />
      <path d="M13.8 15.5 12.8 21l2.7-1.4 2.7 1.4-1-5.5" />
    </>,
  ],
};

export function AchievementIcon({ icon, size = 20, unlocked = true }: { icon: Achievement['icon']; size?: number; unlocked?: boolean }) {
  const [outline, accent] = icons[icon];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={icon}>
      {outline}
      <g className={unlocked ? 'text-brand' : undefined}>{accent}</g>
    </svg>
  );
}

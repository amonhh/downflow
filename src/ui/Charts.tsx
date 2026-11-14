import type { FileCategory, StatsSummary } from '../shared/types';
import { CATEGORY_LABELS } from '../shared/constants';
import { formatBytes } from '../shared/utilities';

const CATEGORY_COLORS: Record<FileCategory, string> = {
  videos: '#a78bfa',
  audio: '#2dd4bf',
  images: '#f472b6',
  documents: '#60a5fa',
  archives: '#fbbf24',
  software: '#f87171',
  other: '#94a3b8',
};

function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const value = new Date(year, month - 1, date);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(value);
}

export function WeekChart({ days }: { days: StatsSummary['last7Days'] }): React.JSX.Element {
  const max = Math.max(1, ...days.map((day) => day.count));
  const today = days[days.length - 1]?.day;
  return (
    <div className="chart-bars" role="img" aria-label="Downloads in the last seven days">
      {days.map((day) => {
        const height = Math.max(3, (day.count / max) * 100);
        return (
          <div key={day.day} className={`chart-bar-col ${day.day === today ? 'today' : ''}`}>
            <span className="chart-bar-value">{day.count}</span>
            <div
              className="chart-bar-track"
              title={`${day.day}: ${day.count} download${day.count === 1 ? '' : 's'}, ${formatBytes(day.bytes)}`}
            >
              <div className="chart-bar-fill" style={{ height: `${height}%` }} />
            </div>
            <span className="chart-bar-label">{dayLabel(day.day)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CategoryDonut({ counts }: { counts: StatsSummary['categoryCounts'] }): React.JSX.Element {
  const entries = (Object.entries(counts) as Array<[FileCategory, number]>).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 132 132" role="img" aria-label="Downloads by category">
        <circle cx="66" cy="66" r={radius} stroke="rgba(125, 155, 205, 0.12)" />
        {total > 0 &&
          entries.map(([category, count]) => {
            const fraction = count / total;
            const dash = fraction * circumference;
            const circle = (
              <circle
                key={category}
                cx="66"
                cy="66"
                r={radius}
                stroke={CATEGORY_COLORS[category]}
                strokeDasharray={`${Math.max(0.5, dash - 2)} ${circumference}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            );
            offset += dash;
            return circle;
          })}
      </svg>
      <div className="donut-legend">
        {entries.length === 0 ? <span className="muted small">No categorized downloads yet.</span> : null}
        {entries.map(([category, count]) => (
          <div className="legend-row" key={category}>
            <span className="legend-swatch" style={{ background: CATEGORY_COLORS[category] }} />
            <span>{CATEGORY_LABELS[category]}</span>
            <strong>{count}</strong>
            <span className="muted">
              {total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { CATEGORY_COLORS };

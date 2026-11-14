import {
  Activity,
  ArrowDownToLine,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Layers,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import type { ExtensionInfo, FileCategory, StatsSummary } from '../../shared/types';
import { CATEGORY_LABELS } from '../../shared/constants';
import { formatBytes, formatSpeed } from '../../shared/utilities';
import { CategoryDonut, WeekChart } from '../../ui/Charts';

function formatQuota(usage: number, quota: number): string {
  if (!quota) return formatBytes(usage);
  return `${formatBytes(usage)} of ${formatBytes(quota)}`;
}

export function StatisticsPage({
  stats,
  info,
}: {
  stats: StatsSummary;
  info: ExtensionInfo | null;
}): React.JSX.Element {
  const categories = (Object.entries(stats.categoryCounts) as Array<[FileCategory, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const storageUsage = info?.storageEstimate?.usage ?? 0;
  const storageQuota = info?.storageEstimate?.quota ?? 0;
  const quotaPercent = storageQuota > 0 ? Math.min(100, (storageUsage / storageQuota) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Statistics</h1>
          <p>Calculated from the downloads DownFlow has actually stored. No estimates or fabricated history.</p>
        </div>
        <span className="chip">
          <BarChart3 size={12} /> {stats.totalDownloads} records
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-icon"><Activity /></div>
          <span className="stat-label">Active now</span>
          <span className="stat-value">{stats.activeDownloads}</span>
          <span className="stat-hint">{formatSpeed(stats.speedBps)} combined</span>
        </div>
        <div className="stat-card green">
          <div className="stat-icon"><CheckCircle2 /></div>
          <span className="stat-label">Completed</span>
          <span className="stat-value">{stats.completedDownloads}</span>
          <span className="stat-hint">{stats.downloadsToday} added today</span>
        </div>
        <div className="stat-card amber">
          <div className="stat-icon"><PauseCircle /></div>
          <span className="stat-label">Paused / queued</span>
          <span className="stat-value">{stats.pausedDownloads + stats.queuedDownloads}</span>
          <span className="stat-hint">{stats.queuedDownloads} queued · {stats.pausedDownloads} paused</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><XCircle /></div>
          <span className="stat-label">Failed / cancelled</span>
          <span className="stat-value">{stats.failedDownloads}</span>
          <span className="stat-hint">Retries are tracked per file</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><ArrowDownToLine /></div>
          <span className="stat-label">Total downloaded</span>
          <span className="stat-value">{formatBytes(stats.totalDownloadedBytes)}</span>
          <span className="stat-hint">Completed file sizes</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Gauge /></div>
          <span className="stat-label">Average speed</span>
          <span className="stat-value">{formatSpeed(stats.averageSpeedBps)}</span>
          <span className="stat-hint">From real transfer timing</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Clock3 /></div>
          <span className="stat-label">This week / month</span>
          <span className="stat-value">{stats.downloadsThisWeek} / {stats.downloadsThisMonth}</span>
          <span className="stat-hint">Downloads added</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Layers /></div>
          <span className="stat-label">Most common type</span>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {stats.mostCommonType ? CATEGORY_LABELS[stats.mostCommonType.category] : '—'}
          </span>
          <span className="stat-hint">
            {stats.mostCommonType ? `${stats.mostCommonType.count} files` : 'No downloads yet'}
          </span>
        </div>
      </div>

      <div className="overview-grid">
        <div className="stack-gap">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Activity in the last 7 days</h2>
                <p>Downloads added per day, from stored creation timestamps.</p>
              </div>
            </div>
            <div className="panel-body">
              <WeekChart days={stats.last7Days} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Category breakdown</h2>
                <p>Every record, grouped by detected file category.</p>
              </div>
            </div>
            <div className="panel-body">
              <CategoryDonut counts={stats.categoryCounts} />
            </div>
          </section>
        </div>

        <div className="stack-gap">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Highlights</h2>
                <p>Notable numbers from your history.</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="quick-stat-list">
                <div className="quick-stat-row">
                  <span className="muted">Largest completed file</span>
                  <strong className="truncate" title={stats.largestFile?.name}>
                    {stats.largestFile ? `${stats.largestFile.name} · ${formatBytes(stats.largestFile.size)}` : '—'}
                  </strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Downloads today</span>
                  <strong>{stats.downloadsToday}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Downloads this week</span>
                  <strong>{stats.downloadsThisWeek}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Downloads this month</span>
                  <strong>{stats.downloadsThisMonth}</strong>
                </div>
                <div className="quick-stat-row">
                  <span className="muted">Detected media resources</span>
                  <strong>{info?.media ?? 0}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Storage</h2>
                <p>Chrome’s local estimate for this extension origin.</p>
              </div>
              <Database size={15} className="muted" />
            </div>
            <div className="panel-body stack">
              <div className="row-between">
                <span className="muted small">Used</span>
                <strong className="mono small">{formatQuota(storageUsage, storageQuota)}</strong>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(quotaPercent)} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${Math.max(1, quotaPercent)}%` }} />
              </div>
              <p className="muted tiny">
                Metadata and temporary segment data live here. Completed files are saved by Chrome into your Downloads
                folder and are not counted against this quota.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>By file type</h2>
                <p>Record counts per category.</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="quick-stat-list">
                {categories.length === 0 ? <p className="muted small">No categorised downloads yet.</p> : null}
                {categories.map(([category, count]) => (
                  <div className="quick-stat-row" key={category}>
                    <span className="muted">{CATEGORY_LABELS[category]}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

import { useEffect, type ReactNode } from 'react';
import {
  Archive,
  Download,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Music2,
  Package,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { DownloadRecord, DownloadStatus, FileCategory } from '../shared/types';
import { CATEGORY_LABELS, STATUS_LABELS } from '../shared/constants';
import { clamp, getExtension, progressPercent } from '../shared/utilities';

export function Logo({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className="logo">
      <div className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 21h14" />
        </svg>
      </div>
      <div>
        <div className="logo-text">
          Down<em>Flow</em>
        </div>
        {!compact && <div className="logo-sub">Download manager</div>}
      </div>
    </div>
  );
}

const CATEGORY_ICONS: Record<FileCategory, LucideIcon> = {
  documents: FileText,
  videos: Film,
  audio: Music2,
  images: ImageIcon,
  archives: Archive,
  software: Package,
  other: FileIcon,
};

export function FileTile({ record, showExtension = true }: { record: Pick<DownloadRecord, 'filename' | 'category'>; showExtension?: boolean }): React.JSX.Element {
  const Icon = CATEGORY_ICONS[record.category] ?? FileIcon;
  const extension = getExtension(record.filename);
  return (
    <div className="file-tile" data-cat={record.category} title={CATEGORY_LABELS[record.category]}>
      {showExtension && extension ? <span>{extension.slice(0, 5)}</span> : <Icon aria-hidden="true" />}
    </div>
  );
}

export function StatusTag({ status }: { status: DownloadStatus }): React.JSX.Element {
  return (
    <span className={`status-tag ${status}`}>
      <span className={`dot ${status === 'downloading' ? 'pulse' : ''}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ProgressBar({ record }: { record: DownloadRecord }): React.JSX.Element {
  const percent = progressPercent(record);
  const segments = record.segments?.filter((segment) => Number.isFinite(segment.end) && segment.end >= segment.start) ?? [];
  if (segments.length > 1 && (record.kind === 'segmented' || segments.length > 1)) {
    return (
      <div className="segment-strip" aria-label={`${percent.toFixed(0)}% downloaded in ${segments.length} segments`}>
        {segments.map((segment) => {
          const size = Math.max(1, segment.end - segment.start + 1);
          const value = segment.status === 'completed' ? 100 : clamp((segment.downloaded / size) * 100, 0, 100);
          return (
            <div
              key={segment.index}
              className={`segment-piece ${segment.status === 'completed' ? 'done' : segment.status === 'failed' ? 'failed' : ''}`}
              title={`Segment ${segment.index + 1}: ${segment.status}`}
            >
              <span style={{ width: `${value}%` }} />
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="progress-fill"
        style={{
          width: record.status === 'probing' ? '22%' : `${percent}%`,
          opacity: record.status === 'probing' ? 0.65 : 1,
        }}
      />
    </div>
  );
}

export function EmptyState({
  icon: Icon = Download,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="sr-only">{label}</span>
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" style={wide ? { maxWidth: 680 } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

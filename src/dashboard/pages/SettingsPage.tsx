import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  Download,
  Gauge,
  Info,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react';
import type { AppSettings, ExtensionInfo } from '../../shared/types';
import { CATEGORY_LABELS } from '../../shared/constants';
import { formatBytes } from '../../shared/utilities';
import { useSiteHelperStatus } from '../../ui/api';
import { clearHistory, clearSegments, copyText } from '../../ui/download-actions';
import { Switch } from '../../ui/components';
import type { ToastKind } from '../../ui/Toast';

type Section = 'general' | 'downloads' | 'media' | 'video' | 'performance' | 'privacy' | 'about';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'media', label: 'Media & detection', icon: Video },
  { id: 'video', label: 'Video sites', icon: Terminal },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'privacy', label: 'Privacy & data', icon: ShieldCheck },
  { id: 'about', label: 'About', icon: Info },
];

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <div className="setting-title">{title}</div>
        <div className="setting-desc">{description}</div>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function TextSetting({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  width,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  width?: number;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="input"
      style={width ? { minWidth: width } : undefined}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function NumberSetting({
  value,
  min,
  max,
  step = 1,
  suffix,
  onCommit,
  ariaLabel,
  multiplier = 1,
  decimals = 0,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (value: number) => void;
  ariaLabel: string;
  multiplier?: number;
  decimals?: number;
}): React.JSX.Element {
  const display = multiplier === 1 ? String(value) : (value / multiplier).toFixed(decimals);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);

  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(display);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const raw = Math.round(clamped * multiplier);
    setDraft(multiplier === 1 ? String(raw) : (raw / multiplier).toFixed(decimals));
    if (raw !== value) onCommit(raw);
  };

  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        className="input number"
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {suffix ? <span className="small muted">{suffix}</span> : null}
    </div>
  );
}

export function SettingsPage({
  settings,
  save,
  info,
  refreshInfo,
  notify,
}: {
  settings: AppSettings;
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  info: ExtensionInfo | null;
  refreshInfo: () => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
}): React.JSX.Element {
  const [section, setSection] = useState<Section>('general');
  const [busy, setBusy] = useState(false);
  const { status: helper, loading: helperLoading, refresh: refreshHelper } = useSiteHelperStatus(20_000);
  const extensionId = chrome.runtime.id;
  const installCommand = `npm run native:install -- --extension-id=${extensionId}`;
  const ytdlpCommand = `${installCommand} --download-ytdlp`;
  const ffmpegCommand = `${installCommand} --download-ffmpeg`;

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await copyText(text);
      notify(`${label} copied to the clipboard.`, 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not copy to the clipboard.', 'error');
    }
  };

  const toolChip = (available: boolean | undefined, ready: string, missing: string): React.JSX.Element => (
    <span className={`chip ${available ? 'success' : 'warning'}`}>
      {available ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {available ? ready : missing}
    </span>
  );

  const update = async (patch: Partial<AppSettings>, message?: string): Promise<void> => {
    try {
      await save(patch);
      if (message) notify(message, 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not save settings.', 'error');
    }
  };

  const clear = async (kind: 'history' | 'segments'): Promise<void> => {
    const confirmed = window.confirm(
      kind === 'history'
        ? 'Remove finished, failed and cancelled downloads from DownFlow history?\n\nSaved files are not deleted.'
        : 'Delete temporary OPFS segment data for interrupted downloads?\n\nActive downloads are not affected.',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      if (kind === 'history') {
        const result = await clearHistory();
        notify(`Removed ${result.removed} history entries. ${result.kept} active or queued downloads were kept.`, 'success');
      } else {
        await clearSegments();
        notify('Temporary segment data cleared.', 'success');
      }
      await refreshInfo();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'The cleanup action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Every option is stored locally in Chrome and applies without a page reload.</p>
        </div>
        <span className="chip">
          <Database size={12} /> {info ? formatBytes(info.storageEstimate?.usage ?? 0) : 'Local only'}
        </span>
      </div>

      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`settings-tab ${section === item.id ? 'active' : ''}`}
                type="button"
                onClick={() => setSection(item.id)}
              >
                <Icon /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="stack-gap">
          {section === 'general' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Appearance &amp; language</h2>
                    <p>Choose how DownFlow looks on this computer.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow title="Theme" description="Dark is the default. System follows your operating system setting.">
                    <select
                      className="select"
                      value={settings.theme}
                      aria-label="Theme"
                      onChange={(event) => void update({ theme: event.target.value as AppSettings['theme'] }, 'Theme updated.')}
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">Match system</option>
                    </select>
                  </SettingRow>
                  <SettingRow title="Language" description="DownFlow currently ships with English only; the interface is built for future translations.">
                    <select className="select" value={settings.language} disabled aria-label="Language">
                      <option value="en">English</option>
                    </select>
                  </SettingRow>
                  <SettingRow title="Desktop notifications" description="Show a Chrome notification when a download completes or fails.">
                    <Switch
                      checked={settings.notifications}
                      label="Desktop notifications"
                      onChange={(checked) => void update({ notifications: checked }, 'Notification preference saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Confirm before starting" description="Ask before a detected or added download begins.">
                    <Switch
                      checked={settings.confirmBeforeDownload}
                      label="Confirm before starting downloads"
                      onChange={(checked) => void update({ confirmBeforeDownload: checked })}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Save location</h2>
                    <p>Paths are relative to the Downloads folder Chrome manages.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow
                    title="Default folder"
                    description="Chrome controls the base download directory. DownFlow can only choose a relative folder inside it."
                  >
                    <TextSetting
                      value={settings.defaultFolder}
                      ariaLabel="Default download folder"
                      placeholder="DownFlow"
                      width={180}
                      onCommit={(value) => void update({ defaultFolder: value.trim() || 'DownFlow' }, 'Default folder saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Category subfolders" description="Save each file into a folder matching its detected category.">
                    <Switch
                      checked={settings.categorizeFolders}
                      label="Use category subfolders"
                      onChange={(checked) => void update({ categorizeFolders: checked })}
                    />
                  </SettingRow>
                  <SettingRow title="Categorise new downloads" description="Detect the category from the extension and MIME type.">
                    <Switch
                      checked={settings.autoCategorize}
                      label="Categorise new downloads"
                      onChange={(checked) => void update({ autoCategorize: checked })}
                    />
                  </SettingRow>
                  <SettingRow title="Duplicate filenames" description="Controls Chrome’s conflict behaviour when a file already exists.">
                    <select
                      className="select"
                      value={settings.duplicatePolicy}
                      aria-label="Duplicate filename policy"
                      onChange={(event) =>
                        void update(
                          { duplicatePolicy: event.target.value as AppSettings['duplicatePolicy'] },
                          'Duplicate policy saved.',
                        )
                      }
                    >
                      <option value="uniquify">Keep both (add number)</option>
                      <option value="overwrite">Overwrite existing</option>
                      <option value="prompt">Ask Chrome</option>
                    </select>
                  </SettingRow>
                  <SettingRow title="Always ask where to save" description="Show Chrome’s Save As dialog for every new download.">
                    <Switch
                      checked={settings.saveAsOnStart}
                      label="Ask where to save"
                      onChange={(checked) => void update({ saveAsOnStart: checked })}
                    />
                  </SettingRow>
                </div>
              </section>
            </>
          ) : null}

          {section === 'downloads' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Download engine</h2>
                    <p>DownFlow checks Range support and file metadata before segmenting.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow
                    title="Segmented downloads"
                    description="Try parallel HTTP Range requests when a server supports them safely. Otherwise DownFlow automatically uses Chrome’s standard engine."
                  >
                    <Switch
                      checked={settings.segmentedEnabled}
                      label="Enable segmented downloads"
                      onChange={(checked) => void update({ segmentedEnabled: checked }, 'Download engine updated.')}
                    />
                  </SettingRow>
                  <SettingRow
                    title="Connections per file"
                    description="Number of byte-range segments. DownFlow reduces this automatically for small files or limited memory. Maximum 16."
                  >
                    <NumberSetting
                      ariaLabel="Connections per file"
                      value={settings.segmentCount}
                      min={1}
                      max={16}
                      onCommit={(value) => void update({ segmentCount: value }, 'Connection count saved.')}
                    />
                  </SettingRow>
                  <SettingRow
                    title="Maximum connection pool"
                    description="Upper bound used by the segmented engine. Keep it at or above connections per file."
                  >
                    <NumberSetting
                      ariaLabel="Maximum connection pool"
                      value={settings.maxConnections}
                      min={1}
                      max={16}
                      onCommit={(value) => void update({ maxConnections: value }, 'Connection pool saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Concurrent downloads" description="How many files the queue may run at once. Values from 1 to 10.">
                    <NumberSetting
                      ariaLabel="Concurrent downloads"
                      value={settings.maxConcurrent}
                      min={1}
                      max={10}
                      onCommit={(value) => void update({ maxConcurrent: value }, 'Concurrent download limit saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Auto-start queue" description="Start queued downloads automatically when a slot becomes free.">
                    <Switch
                      checked={settings.autoStartQueue}
                      label="Auto-start the queue"
                      onChange={(checked) => void update({ autoStartQueue: checked })}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Reliability</h2>
                    <p>Retries are delayed so a failing server is not hammered.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow title="Automatic retry" description="Retry interrupted transfers after a short delay. Authentication and DRM errors are never retried blindly.">
                    <Switch
                      checked={settings.autoRetry}
                      label="Automatic retry"
                      onChange={(checked) => void update({ autoRetry: checked })}
                    />
                  </SettingRow>
                  <SettingRow title="Maximum retries" description="Per-download retry limit for automatic attempts.">
                    <NumberSetting
                      ariaLabel="Maximum retries"
                      value={settings.maxRetries}
                      min={0}
                      max={10}
                      onCommit={(value) => void update({ maxRetries: value })}
                    />
                  </SettingRow>
                </div>
              </section>
            </>
          ) : null}

          {section === 'media' ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Media &amp; link detection</h2>
                  <p>Detection reads page links and media responses locally. Nothing is uploaded.</p>
                </div>
              </div>
              <div className="panel-body">
                <SettingRow title="Download link detection" description="Show a DownFlow prompt when you click a direct download link.">
                  <Switch
                    checked={settings.detectionEnabled}
                    label="Download link detection"
                    onChange={(checked) => void update({ detectionEnabled: checked })}
                  />
                </SettingRow>
                <SettingRow title="Inspect download clicks" description="Offer “Download with DownFlow” or Chrome’s normal download for supported links.">
                  <Switch
                    checked={settings.interceptClicks}
                    label="Inspect download clicks"
                    onChange={(checked) => void update({ interceptClicks: checked })}
                  />
                </SettingRow>
                <SettingRow title="Detect media" description="Record video and audio files played on pages so they can be downloaded later.">
                  <Switch
                    checked={settings.mediaDetection}
                    label="Detect media"
                    onChange={(checked) => void update({ mediaDetection: checked })}
                  />
                </SettingRow>
                <SettingRow title="HLS playlists" description="Recognise accessible .m3u8 playlists and their variants. DRM is detected and skipped.">
                  <Switch
                    checked={settings.hlsDetection}
                    label="Detect HLS playlists"
                    onChange={(checked) => void update({ hlsDetection: checked })}
                  />
                </SettingRow>
                <SettingRow title="DASH manifests" description="Recognise accessible .mpd manifests with SegmentTemplate or SegmentList metadata.">
                  <Switch
                    checked={settings.dashDetection}
                    label="Detect DASH manifests"
                    onChange={(checked) => void update({ dashDetection: checked })}
                  />
                </SettingRow>
                <SettingRow title="Media notifications" description="Notify when new media is found. Off by default to avoid noise.">
                  <Switch
                    checked={settings.mediaNotifications}
                    label="Media notifications"
                    onChange={(checked) => void update({ mediaNotifications: checked })}
                  />
                </SettingRow>
              </div>
            </section>
          ) : null}

          {section === 'video' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Video site helper</h2>
                    <p>
                      Optional local companion that inspects video pages such as YouTube and downloads the exact quality
                      you choose. It is not required for normal downloads, HLS, DASH or media detection.
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    disabled={helperLoading}
                    onClick={() => void refreshHelper(true)}
                  >
                    {helperLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />}
                    Check again
                  </button>
                </div>
                <div className="panel-body">
                  <div className="quick-stat-list">
                    <div className="quick-stat-row">
                      <span className="muted">Native helper</span>
                      {toolChip(
                        helper?.available,
                        helper?.hostVersion ? `v${helper.hostVersion}` : 'Installed',
                        'Not installed',
                      )}
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">yt-dlp</span>
                      {toolChip(helper?.ytDlp.available, helper?.ytDlp.version ?? 'Ready', 'Not found')}
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">FFmpeg (optional)</span>
                      {toolChip(helper?.ffmpeg.available, helper?.ffmpeg.version ?? 'Ready', 'Not found')}
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">Video output folder</span>
                      <span className="mono tiny" style={{ textAlign: 'right', wordBreak: 'break-all' }}>
                        {helper?.outputDir ?? '—'}
                      </span>
                    </div>
                  </div>
                  {helper?.error ? (
                    <div className="error-box" style={{ marginTop: 12 }} role="alert">
                      {helper.error}
                    </div>
                  ) : null}
                  {!helper?.available ? (
                    <div className="help-box" style={{ marginTop: 12 }}>
                      The helper is optional. DownFlow stays honest when it is missing: video pages are reported as
                      unsupported instead of pretending to download them. Install it below to enable site downloads.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Install on Windows</h2>
                    <p>Run these commands in the DownFlow project folder, then reload the extension.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow
                    title="1. Register the helper"
                    description="Writes the native messaging manifest for this extension ID and the installed Chromium browsers. Nothing runs automatically."
                  >
                    <div className="row" style={{ gap: 6, minWidth: 0 }}>
                      <code
                        className="mono tiny"
                        style={{ maxWidth: 320, overflowX: 'auto', whiteSpace: 'nowrap' }}
                      >
                        {installCommand}
                      </code>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Copy install command"
                        aria-label="Copy install command"
                        onClick={() => void copy(installCommand, 'Install command')}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="2. Install yt-dlp"
                    description="Either add yt-dlp.exe to PATH, or let the installer download the official GitHub release. The helper cannot inspect video pages without it."
                  >
                    <div className="row" style={{ gap: 6, minWidth: 0 }}>
                      <code
                        className="mono tiny"
                        style={{ maxWidth: 320, overflowX: 'auto', whiteSpace: 'nowrap' }}
                      >
                        {ytdlpCommand}
                      </code>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Copy yt-dlp install command"
                        aria-label="Copy yt-dlp install command"
                        onClick={() => void copy(ytdlpCommand, 'yt-dlp install command')}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="3. FFmpeg for high quality"
                    description="Separate 1080p and 4K streams need FFmpeg to merge video with audio. Let the installer fetch an official build, or put ffmpeg.exe on PATH / set DOWNFLOW_FFMPEG."
                  >
                    <div className="row" style={{ gap: 6, minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <code
                        className="mono tiny"
                        style={{ maxWidth: 320, overflowX: 'auto', whiteSpace: 'nowrap' }}
                      >
                        {ffmpegCommand}
                      </code>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Copy FFmpeg install command"
                        aria-label="Copy FFmpeg install command"
                        onClick={() => void copy(ffmpegCommand, 'FFmpeg install command')}
                      >
                        <Copy size={13} />
                      </button>
                      {toolChip(helper?.ffmpeg.available, helper?.ffmpeg.version ?? 'Ready', 'Not found')}
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="4. Reload DownFlow"
                    description="Open chrome://extensions and reload the unpacked DownFlow extension so it picks up the nativeMessaging permission."
                  >
                    <span className="chip">Extension id {extensionId.slice(0, 8)}…</span>
                  </SettingRow>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>What the helper can and cannot do</h2>
                    <p>Site downloads are deliberately limited to what yt-dlp can access without bypassing protection.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="limitation-list">
                    <div className="limitation-item">
                      The helper runs locally, talks to DownFlow over Chrome native messaging, and saves videos to its own
                      output folder. Nothing is uploaded to a DownFlow server.
                    </div>
                    <div className="limitation-item">
                      DRM-protected services such as Netflix, Hulu, Disney+ and Prime Video are not supported. The helper
                      does not bypass DRM, paywalls, logins or region locks.
                    </div>
                    <div className="limitation-item">
                      Live streams are not supported yet. Pages that need an account or cookies may fail even with yt-dlp
                      installed; DownFlow reports the real error instead of claiming success.
                    </div>
                    <div className="limitation-item">
                      Site downloads bypass Chrome’s download manager, so they do not appear in Chrome’s own downloads list.
                      Use DownFlow’s Open or Show in folder buttons instead.
                    </div>
                    <div className="limitation-item">
                      Only download media you have permission to save. You are responsible for complying with each site’s
                      terms and local copyright law.
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {section === 'performance' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Bandwidth</h2>
                    <p>Limits apply to DownFlow’s segmented and media transfers.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow title="Global bandwidth limit" description="0 means unlimited. Chrome’s native Downloads API cannot be throttled, so standard-engine downloads ignore this limit.">
                    <NumberSetting
                      ariaLabel="Global bandwidth limit in kilobytes per second"
                      value={settings.bandwidthLimitBps}
                      min={0}
                      max={1_048_576}
                      multiplier={1024}
                      suffix="KB/s (0 = unlimited)"
                      onCommit={(value) => void update({ bandwidthLimitBps: value }, 'Bandwidth limit saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Default per-download limit" description="Applied to new segmented and media downloads unless you override it. 0 means unlimited.">
                    <NumberSetting
                      ariaLabel="Per-download bandwidth limit in kilobytes per second"
                      value={settings.perDownloadLimitBps}
                      min={0}
                      max={1_048_576}
                      multiplier={1024}
                      suffix="KB/s (0 = unlimited)"
                      onCommit={(value) => void update({ perDownloadLimitBps: value }, 'Per-download limit saved.')}
                    />
                  </SettingRow>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Memory &amp; storage</h2>
                    <p>Segmented writes use the Origin Private File System where supported.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow title="Segment memory budget" description="DownFlow keeps files in bounded chunks and writes directly to OPFS. Increase this only on machines with spare memory.">
                    <NumberSetting
                      ariaLabel="Segment memory budget in megabytes"
                      value={settings.memoryLimitMb}
                      min={64}
                      max={4096}
                      suffix="MB"
                      onCommit={(value) => void update({ memoryLimitMb: value }, 'Memory budget saved.')}
                    />
                  </SettingRow>
                  <SettingRow title="Current engine" description="Segmented transfers need Range support plus a trustworthy size and validator. Otherwise Chrome’s engine is used.">
                    <span className="chip">
                      {settings.segmentedEnabled ? `Up to ${settings.segmentCount} connections` : 'Standard only'}
                    </span>
                  </SettingRow>
                </div>
              </section>
            </>
          ) : null}

          {section === 'privacy' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>History &amp; storage</h2>
                    <p>DownFlow keeps metadata in IndexedDB. Files are saved by Chrome.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <SettingRow title="Keep download history" description="When off, DownFlow can still keep active records, but completed history may be cleaned up by Chrome storage management.">
                    <Switch
                      checked={settings.keepHistory}
                      label="Keep download history"
                      onChange={(checked) => void update({ keepHistory: checked })}
                    />
                  </SettingRow>
                  <SettingRow title="Stored metadata" description={`${info?.downloads ?? 0} downloads · ${info?.media ?? 0} media resources · ${settings.categoryFolders ? Object.keys(CATEGORY_LABELS).length : 0} category folders.`}>
                    <span className="chip">{info ? formatBytes(info.storageEstimate?.usage ?? 0) : 'Loading…'}</span>
                  </SettingRow>
                  <SettingRow title="Clear download history" description="Remove finished, failed and cancelled records. Saved files and active downloads stay untouched.">
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void clear('history')}>
                      <Trash2 size={14} /> Clear history
                    </button>
                  </SettingRow>
                  <SettingRow title="Clear temporary segments" description="Delete partial segment files left by interrupted segmented downloads.">
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void clear('segments')}>
                      <Trash2 size={14} /> Clear segments
                    </button>
                  </SettingRow>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Privacy</h2>
                    <p>DownFlow runs entirely inside Chrome. There is no account and no external server.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="limitation-list">
                    <div className="limitation-item">
                      Download metadata, settings and media discoveries are stored locally in this browser profile.
                    </div>
                    <div className="limitation-item">
                      DownFlow does not upload URLs, cookies, files or history. It does not bypass authentication, DRM or
                      paywalls.
                    </div>
                    <div className="limitation-item">
                      Host access is required to make Range requests and inspect media response headers. Removing the
                      extension deletes extension-managed data.
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {section === 'about' ? (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>DownFlow {info?.version ?? ''}</h2>
                    <p>A local-first download manager built as a Chrome extension.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="quick-stat-list">
                    <div className="quick-stat-row">
                      <span className="muted">Stored downloads</span>
                      <strong>{info?.downloads ?? 0}</strong>
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">Segmented transfers active</span>
                      <strong>{info?.segmentedActive ?? 0}</strong>
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">Detected media</span>
                      <strong>{info?.media ?? 0}</strong>
                    </div>
                    <div className="quick-stat-row">
                      <span className="muted">Storage used</span>
                      <strong>{info ? formatBytes(info.storageEstimate?.usage ?? 0) : '—'}</strong>
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Chrome limitations</h2>
                    <p>These are platform limits, not unfinished features.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="limitation-list">
                    {(info?.limitations ?? []).map((limitation) => (
                      <div className="limitation-item" key={limitation}>{limitation}</div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

import type { ProbeResult } from '../shared/types';
import { formatBytes, formatSpeed, getExtension } from '../shared/utilities';

export interface DetectionPromptOptions {
  filename: string;
  domain: string;
  mime?: string;
  onDownload: () => Promise<void>;
  onNormal: () => void;
  onClose: () => void;
  probe: Promise<ProbeResult | null>;
}

const STYLE = `
  :host { all: initial; }
  .df-card {
    position: fixed; right: 20px; bottom: 20px; width: 360px; max-width: calc(100vw - 32px);
    background: #0c1424; color: #f5f8ff; border: 1px solid rgba(101, 146, 230, .28);
    border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.28);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px; line-height: 1.45; padding: 18px; z-index: 2147483647;
    animation: df-in .24s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes df-in { from { transform: translateY(16px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
  .df-head { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .df-logo { width: 34px; height:34px; border-radius:10px; display:grid; place-items:center;
    background: linear-gradient(145deg,#1b5cff,#22c4d8); box-shadow:0 7px 18px rgba(27,92,255,.35); flex:0 0 auto;}
  .df-logo svg { width:19px; height:19px; }
  .df-title { font-weight:700; font-size:14px; letter-spacing:.01em; }
  .df-sub { color:#8396b5; font-size:11.5px; }
  .df-close { margin-left:auto; width:28px; height:28px; border:0; border-radius:8px; background:transparent;
    color:#8396b5; cursor:pointer; display:grid; place-items:center; font-size:18px; }
  .df-close:hover { background:rgba(255,255,255,.07); color:#fff; }
  .df-file { display:flex; gap:12px; align-items:center; padding:12px; border-radius:13px;
    background:linear-gradient(135deg,rgba(42,102,255,.11),rgba(34,196,216,.055)); border:1px solid rgba(106,151,229,.14); }
  .df-ext { min-width:46px; height:46px; padding:0 8px; border-radius:11px; display:grid; place-items:center;
    background:rgba(28,102,255,.17); color:#71a5ff; font-weight:800; font-size:11px; letter-spacing:.06em; }
  .df-info { min-width:0; }
  .df-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .df-meta { color:#8396b5; font-size:11.5px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .df-error { margin-top:10px; color:#ff9e9e; font-size:11.5px; display:none; }
  .df-actions { display:flex; gap:8px; margin-top:15px; }
  .df-btn { flex:1; border:0; border-radius:10px; padding:10px 12px; font:inherit; font-weight:650; cursor:pointer;
    transition:.15s ease; }
  .df-primary { background:linear-gradient(135deg,#2f75ff,#3e8bff); color:white; box-shadow:0 5px 14px rgba(47,117,255,.25); }
  .df-primary:hover { filter:brightness(1.08); transform:translateY(-1px); }
  .df-primary:disabled { opacity:.65; cursor:wait; transform:none; }
  .df-secondary { background:rgba(255,255,255,.065); color:#c9d7ef; border:1px solid rgba(255,255,255,.08); }
  .df-secondary:hover { background:rgba(255,255,255,.1); }
  .df-foot { margin-top:11px; color:#62728e; font-size:10.5px; text-align:center; }
  .df-spin { width:12px; height:12px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%;
    display:inline-block; vertical-align:-2px; animation:df-spin .7s linear infinite; }
  @keyframes df-spin { to { transform:rotate(360deg); } }
`;

function svgArrow(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 3v13m0 0 5-5m-5 5-5-5M5 21h14');
  svg.append(path);
  return svg;
}

export function showDetectionPrompt(options: DetectionPromptOptions): () => void {
  document.getElementById('downflow-detection-host')?.remove();
  const host = document.createElement('div');
  host.id = 'downflow-detection-host';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const card = document.createElement('div');
  card.className = 'df-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'DownFlow download detected');

  const head = document.createElement('div');
  head.className = 'df-head';
  const logo = document.createElement('div');
  logo.className = 'df-logo';
  logo.append(svgArrow());
  const heading = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'df-title';
  title.textContent = 'Download detected';
  const subtitle = document.createElement('div');
  subtitle.className = 'df-sub';
  subtitle.textContent = 'DownFlow can manage this transfer';
  heading.append(title, subtitle);
  const close = document.createElement('button');
  close.className = 'df-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Continue without DownFlow');
  close.textContent = '×';
  head.append(logo, heading, close);

  const file = document.createElement('div');
  file.className = 'df-file';
  const ext = document.createElement('div');
  ext.className = 'df-ext';
  ext.textContent = (getExtension(options.filename) || 'FILE').toUpperCase().slice(0, 5);
  const info = document.createElement('div');
  info.className = 'df-info';
  const name = document.createElement('div');
  name.className = 'df-name';
  name.textContent = options.filename;
  const meta = document.createElement('div');
  meta.className = 'df-meta';
  meta.textContent = `${options.domain} · Checking size…`;
  info.append(name, meta);
  file.append(ext, info);

  const error = document.createElement('div');
  error.className = 'df-error';
  error.setAttribute('role', 'alert');

  const actions = document.createElement('div');
  actions.className = 'df-actions';
  const normalButton = document.createElement('button');
  normalButton.className = 'df-btn df-secondary';
  normalButton.type = 'button';
  normalButton.textContent = 'Download normally';
  const downloadButton = document.createElement('button');
  downloadButton.className = 'df-btn df-primary';
  downloadButton.type = 'button';
  downloadButton.textContent = 'Download with DownFlow';
  actions.append(normalButton, downloadButton);

  const foot = document.createElement('div');
  foot.className = 'df-foot';
  foot.textContent = 'Managed locally by DownFlow';

  card.append(head, file, error, actions, foot);
  shadow.append(style, card);
  document.documentElement.append(host);

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    host.remove();
  };
  const continueNormally = () => {
    cleanup();
    options.onNormal();
  };
  close.addEventListener('click', continueNormally);
  normalButton.addEventListener('click', continueNormally);
  downloadButton.addEventListener('click', async () => {
    downloadButton.disabled = true;
    normalButton.disabled = true;
    downloadButton.textContent = 'Sending to DownFlow…';
    try {
      await options.onDownload();
      cleanup();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'DownFlow could not start this download.';
      error.style.display = 'block';
      downloadButton.disabled = false;
      normalButton.disabled = false;
      downloadButton.textContent = 'Try DownFlow again';
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', onKey, true);
      continueNormally();
    }
  };
  document.addEventListener('keydown', onKey, true);

  void options.probe
    .then((result) => {
      if (!result) return;
      const parts = [options.domain];
      if (result.totalBytes > 0) parts.push(formatBytes(result.totalBytes));
      const type = result.mime || options.mime;
      if (type) parts.push(type.split(';')[0]);
      if (result.supported) parts.push('segmented ready');
      else if (result.reason) parts.push(result.reason.split('.')[0]);
      meta.textContent = parts.join(' · ');
      if (result.filename && result.filename !== options.filename) {
        name.textContent = result.filename;
        ext.textContent = (getExtension(result.filename) || 'FILE').toUpperCase().slice(0, 5);
      }
      if (result.supported && result.totalBytes > 0) {
        const speed = 0;
        meta.title = `${formatSpeed(speed)} · Resumable`;
      }
    })
    .catch(() => {
      meta.textContent = `${options.domain} · Size unavailable`;
    });

  return cleanup;
}

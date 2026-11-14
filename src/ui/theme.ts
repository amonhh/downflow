import type { AppSettings } from '../shared/types';

/**
 * Applies the saved theme to the document. "system" follows the operating
 * system preference and keeps following it while the page stays open.
 * Returns a cleanup function.
 */
export function applyTheme(theme: AppSettings['theme']): () => void {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: light)');

  const paint = () => {
    const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  };

  paint();
  if (theme !== 'system') return () => undefined;

  media.addEventListener('change', paint);
  return () => media.removeEventListener('change', paint);
}

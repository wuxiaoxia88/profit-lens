import { useEffect, useState } from 'react';
import { DARK, LIGHT, type Theme } from './theme';

export type ThemePref = 'auto' | 'light' | 'dark';

function resolve(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'dark') return DARK;
  if (attr === 'light') return LIGHT;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

export function setThemePref(p: ThemePref) {
  if (p === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = p;
  try { localStorage.setItem('profit-lens:v1:theme', p); } catch { /* ignore */ }
  window.dispatchEvent(new Event('profit-lens-theme'));
}

export function initThemePref(): ThemePref {
  let p: ThemePref = 'auto';
  try { p = (localStorage.getItem('profit-lens:v1:theme') as ThemePref) || 'auto'; } catch { /* ignore */ }
  if (p !== 'auto') document.documentElement.dataset.theme = p;
  return p;
}

export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(resolve);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setT(resolve());
    mq?.addEventListener('change', on);
    window.addEventListener('profit-lens-theme', on);
    return () => { mq?.removeEventListener('change', on); window.removeEventListener('profit-lens-theme', on); };
  }, []);
  return t;
}

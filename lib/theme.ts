export type Theme = 'light' | 'dark';
export const THEME_KEY = 'hacker-times-theme';
export function resolveTheme(saved: string | null, systemDark: boolean): Theme {
  return saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light';
}
export function nextTheme(current: Theme): Theme { return current === 'dark' ? 'light' : 'dark'; }
export const themeInitScript = `(function(){try{var s=localStorage.getItem('hacker-times-theme');var t=s==='dark'||s==='light'?s:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`;

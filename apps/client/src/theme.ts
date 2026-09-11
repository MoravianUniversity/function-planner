/** Matches function-planner-ui localStorage key. */
export const THEME_STORAGE_KEY = 'func-planner-theme';

export const THEME_CHANGE_EVENT = 'func-planner-theme-change';

export type AppTheme = 'light' | 'dark';

export function getStoredTheme(): AppTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function getDocumentTheme(): AppTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Apply theme to the document so shell CSS (and portaled dialogs) follow planner preference. */
export function applyAppTheme(theme: AppTheme): void {
  const root = document.documentElement;
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (changed) {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  }
}

/** Sync document theme from a planner host element (`.func-planner` with optional `.dark-mode`). */
export function syncAppThemeFromPlannerHost(host: Element): void {
  applyAppTheme(host.classList.contains('dark-mode') ? 'dark' : 'light');
}

/**
 * Watch the planner theme FAB (and host class) so shell chrome updates when the user toggles.
 * Returns a cleanup function.
 */
export function watchPlannerTheme(host: HTMLElement): () => void {
  syncAppThemeFromPlannerHost(host);

  const onToggleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
      return;
    }
    if (!target.closest('.theme-toggle')) {
      return;
    }
    applyAppTheme(target.checked ? 'dark' : 'light');
  };

  host.addEventListener('change', onToggleChange);

  const observer = new MutationObserver(() => {
    syncAppThemeFromPlannerHost(host);
  });
  observer.observe(host, { attributes: true, attributeFilter: ['class'] });

  return () => {
    host.removeEventListener('change', onToggleChange);
    observer.disconnect();
  };
}

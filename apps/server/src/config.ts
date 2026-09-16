import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  /** Display name in the client (header / document title). */
  appName: string;
  /**
   * If non-empty, only Google accounts whose email domain is in this list may sign in
   * (e.g. `["moravian.edu"]`). Empty means no domain restriction.
   */
  allowedEmailDomains: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  appName: 'Function Planner',
  allowedEmailDomains: []
};

/** Package root (`apps/server`) whether this file is loaded from `src/` or `dist/src/`. */
function serverPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..'), // src/config.ts → apps/server
    resolve(here, '../..') // dist/src/config.js → apps/server
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'config.example.json'))) {
      return dir;
    }
  }
  return candidates[0]!;
}

function loadConfig(): AppConfig {
  const configPath = resolve(serverPackageRoot(), 'config.json');
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AppConfig>;
    const appName =
      typeof raw.appName === 'string' && raw.appName.trim().length > 0 ? raw.appName.trim() : DEFAULT_CONFIG.appName;
    const domains = Array.isArray(raw.allowedEmailDomains)
      ? raw.allowedEmailDomains
          .filter((d): d is string => typeof d === 'string')
          .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
          .filter(Boolean)
      : [];
    return { appName, allowedEmailDomains: domains };
  } catch (error) {
    console.warn(`Could not load ${configPath}; using defaults.`, error);
    return { ...DEFAULT_CONFIG };
  }
}

export const appConfig: AppConfig = loadConfig();

/** Public subset safe to expose to the browser. */
export function publicAppConfig(): { appName: string; allowedEmailDomains: string[] } {
  return {
    appName: appConfig.appName,
    allowedEmailDomains: appConfig.allowedEmailDomains
  };
}

export function isEmailDomainAllowed(email: string): boolean {
  if (appConfig.allowedEmailDomains.length === 0) {
    return true;
  }
  const at = email.lastIndexOf('@');
  if (at < 0) {
    return false;
  }
  const domain = email.slice(at + 1).toLowerCase();
  return appConfig.allowedEmailDomains.includes(domain);
}

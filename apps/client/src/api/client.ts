const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export const withBaseUrl = (url: string): string => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
};

const maybeRedirectToLogin = (status: number, url: string): void => {
  if (status !== 401) {
    return;
  }

  // /auth/session intentionally returns 401 when logged out; do not start OAuth from that probe.
  if (url.includes('/auth/session')) {
    return;
  }

  if (typeof window !== 'undefined') {
    window.location.href = withBaseUrl('/auth/google');
  }
};

/** Thrown by apiGet/apiSend so callers (e.g. React Query) can see HTTP status and skip retries on 4xx. */
export class ApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Request failed: ${status}`);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

async function parseErrorBody(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { message?: string };
    return typeof data.message === 'string' ? data.message : undefined;
  } catch {
    return undefined;
  }
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(withBaseUrl(url), { credentials: 'include' });
  if (!response.ok) {
    maybeRedirectToLogin(response.status, url);
    const detail = await parseErrorBody(response);
    throw new ApiHttpError(response.status, detail ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(withBaseUrl(url), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    maybeRedirectToLogin(response.status, url);
    const detail = await parseErrorBody(response);
    throw new ApiHttpError(response.status, detail ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

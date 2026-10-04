'use client';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonRecord = { [key: string]: Json };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_URL;

function apiUrl(path: string): string {
  if (!baseUrl) throw new ApiError('NEXT_PUBLIC_API_URL is not configured.', 0);
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function parseBody(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: 'include' });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text) as unknown; } catch { body = text; }
  }
  if (!response.ok) {
    const error = parseBody(body);
    const message = typeof error?.message === 'string'
      ? error.message
      : `Request failed (${response.status}).`;
    if (response.status === 401 && typeof window !== 'undefined' && path !== '/auth/login') {
      window.dispatchEvent(new Event('fernleaf:unauthorized'));
    }
    throw new ApiError(message, response.status, typeof error?.code === 'string' ? error.code : undefined, error?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details)) {
      const detail = error.details.find((value) => typeof value === 'object' && value !== null) as { message?: unknown } | undefined;
      if (typeof detail?.message === 'string') return `${error.message}: ${detail.message}`;
    }
    return error.message;
  }
  return 'Unexpected network error. Please try again.';
}

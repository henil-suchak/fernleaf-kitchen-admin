'use client';

import { useEffect, useState } from 'react';

type HealthState = 'checking' | 'available' | 'unavailable';

interface HealthResponse {
  status: 'ok';
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export function ApiHealthCheck() {
  const [state, setState] = useState<HealthState>(() =>
    apiUrl ? 'checking' : 'unavailable',
  );

  useEffect(() => {
    if (!apiUrl) {
      return;
    }

    const controller = new AbortController();

    async function checkApi(): Promise<void> {
      try {
        const response = await fetch(`${apiUrl}/health`, {
          signal: controller.signal,
        });
        const body: unknown = await response.json();

        if (response.ok && isHealthResponse(body)) {
          setState('available');
          return;
        }

        setState('unavailable');
      } catch {
        if (!controller.signal.aborted) {
          setState('unavailable');
        }
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  const message = {
    checking: 'Checking API connectivity…',
    available: 'API connected',
    unavailable: 'API unavailable — confirm the API server and NEXT_PUBLIC_API_URL.',
  }[state];

  return (
    <section className="health-check" aria-live="polite">
      <p>
        <span>Backend status:</span> {message}
      </p>
    </section>
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok'
  );
}

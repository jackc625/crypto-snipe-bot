import { useState, useEffect, useCallback } from 'react';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Custom hook for authenticated API requests.
 * Uses fetch with credentials: 'include' for cookie-based session auth.
 * Redirects to /login on 401 (session expired).
 */
export function useApi<T>(url: string, options?: RequestInit): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => {
    setTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          credentials: 'include',
          ...options,
        });

        if (response.status === 401) {
          // Session expired. Please sign in again.
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load data. Check that the bot is running and try again.`);
        }

        const json = await response.json() as T;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data. Check that the bot is running and try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [url, trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch };
}

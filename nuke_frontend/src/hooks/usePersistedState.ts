import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * useState backed by localStorage. Reads on mount, writes on change (debounced 300ms).
 * Falls back to defaultValue on parse errors or missing keys.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {
      // corrupt or missing — use default
    }
    return defaultValue;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        // Debounced write to localStorage
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          try {
            localStorage.setItem(key, JSON.stringify(next));
          } catch {
            // quota exceeded — silently ignore
          }
        }, 300);
        return next;
      });
    },
    [key],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [state, setState];
}

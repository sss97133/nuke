import { useCallback } from 'react';
import { toast } from 'react-hot-toast';

interface ToastErrorOptions {
  title?: string;
  duration?: number;
}

/**
 * Wrap a Promise so its rejection surfaces as a token-styled toast.
 *
 * The antidote to silent `.catch(() => {})` patterns. 24 such silent catches
 * exist across the app today, the load-bearing public ones being the worst:
 * users see a blank screen on RPC failure with no signal anything happened.
 *
 * Usage:
 *   const toastError = useToastError();
 *   const { data } = await toastError(
 *     supabase.rpc('foo'),
 *     { title: 'Failed to load segments' }
 *   ).catch(() => ({ data: [] }));   // optional fallback; toast already fired
 *
 * The error is re-thrown so callers can still use try/catch / .catch for
 * control flow. Use `.catch(() => fallback)` after the wrapped call when the
 * UI needs to render something on failure.
 *
 * Toast styling uses CSS variables only (V-01/V-02/V-03 enforce no radius,
 * no shadow, no hex). The global Toaster is mounted at App.tsx; this hook
 * just calls `toast.error()` with token-styled options.
 */
export function useToastError() {
  return useCallback(<T,>(promise: Promise<T>, opts?: ToastErrorOptions): Promise<T> => {
    return promise.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`${opts?.title ?? 'Error'}: ${msg}`, {
        position: 'bottom-right',
        duration: opts?.duration ?? 5000,
        style: {
          background: 'var(--surface)',
          border: '2px solid var(--error)',
          color: 'var(--text)',
          fontFamily: 'var(--font-family)',
          fontSize: 'var(--fs-10)',
          // borderRadius / boxShadow not set — global !important enforces 0/none.
        },
      });
      throw err;
    });
  }, []);
}

export default useToastError;

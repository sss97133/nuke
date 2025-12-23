import { useEffect } from 'react';

interface UseKeyboardShortcutOptions {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  callback: (e: KeyboardEvent) => void;
  enabled?: boolean;
}

export const useKeyboardShortcut = ({
  key,
  ctrl = false,
  meta = false,
  shift = false,
  alt = false,
  callback,
  enabled = true
}: UseKeyboardShortcutOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const keyMatches = e.key.toLowerCase() === key.toLowerCase();
      
      // For meta (Cmd/Ctrl+K), accept either Cmd (Mac) or Ctrl (Windows/Linux)
      let modifierMatches = true;
      if (meta) {
        modifierMatches = e.metaKey || e.ctrlKey;
      } else if (ctrl) {
        modifierMatches = e.ctrlKey && !e.metaKey;
      } else {
        modifierMatches = !e.ctrlKey && !e.metaKey;
      }
      
      const shiftMatches = shift ? e.shiftKey : !e.shiftKey;
      const altMatches = alt ? e.altKey : !e.altKey;

      if (keyMatches && modifierMatches && shiftMatches && altMatches) {
        e.preventDefault();
        callback(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [key, ctrl, meta, shift, alt, callback, enabled]);
};


import React, { useRef, useEffect, useState } from 'react';

export type SearchBarMode = 'inline' | 'expanding' | 'compact' | 'trigger';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  mode?: SearchBarMode;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

const GHOST_PLACEHOLDERS = [
  'Search 1.26M vehicles...',
  'Try "porsche 911"',
  'Paste a BaT URL...',
  'VIN lookup...',
  '"muscle car under $50k"',
  '"1970 chevy camaro red"',
  'Type a make or model...',
];

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  mode = 'inline',
  inputRef: externalRef,
  autoFocus = false,
}) => {
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = externalRef || internalRef;
  const [ghostIndex, setGhostIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);

  // Rotate ghost placeholder every 4s
  useEffect(() => {
    if (isFocused || value) return;
    const interval = setInterval(() => {
      setGhostIndex((i) => (i + 1) % GHOST_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isFocused, value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit(value);
    }
    if (e.key === 'Escape') {
      (ref as React.RefObject<HTMLInputElement>).current?.blur();
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  if (mode === 'trigger') {
    return (
      <button
        className="search-trigger"
        onClick={() => onFocus?.()}
        type="button"
      >
        <span className="search-trigger-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6.5" cy="6.5" r="5.5" />
            <line x1="11" y1="11" x2="15" y2="15" />
          </svg>
        </span>
        <span className="search-trigger-shortcut">
          <kbd>&#8984;K</kbd>
        </span>
      </button>
    );
  }

  return (
    <div className={`search-bar search-bar--${mode}`}>
      <div className="search-bar-inner">
        <svg className="search-bar-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="5.5" />
          <line x1="11" y1="11" x2="15" y2="15" />
        </svg>
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          className="search-bar-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {!value && !isFocused && (
          <span className="search-bar-ghost" aria-hidden="true">
            {GHOST_PLACEHOLDERS[ghostIndex]}
          </span>
        )}
        {value && (
          <button
            className="search-bar-clear"
            onClick={() => {
              onChange('');
              (ref as React.RefObject<HTMLInputElement>).current?.focus();
            }}
            type="button"
            tabIndex={-1}
          >
            &times;
          </button>
        )}
        <kbd className="search-bar-kbd">&#8984;K</kbd>
      </div>
    </div>
  );
};

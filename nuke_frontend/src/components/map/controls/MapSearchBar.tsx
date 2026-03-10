import React, { useState, useCallback, useRef } from 'react';
import { MAP_FONT } from '../constants';

interface Props {
  onSearch: (query: string) => void;
}

export default function MapSearchBar({ onSearch }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  }, [value, onSearch]);

  const handleClear = useCallback(() => {
    setValue('');
    onSearch('');
    inputRef.current?.focus();
  }, [onSearch]);

  return (
    <form onSubmit={handleSubmit} style={{
      position: 'absolute', top: 12, left: 12, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 0,
    }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="SEARCH MAKE, MODEL, YEAR..."
        style={{
          background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)',
          borderRight: 'none', color: 'rgba(255,255,255,0.8)', padding: '6px 10px',
          fontSize: 9, fontFamily: MAP_FONT, width: 200, outline: 'none',
          letterSpacing: '0.3px', textTransform: 'uppercase',
        }}
      />
      {value && (
        <button type="button" onClick={handleClear} style={{
          background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)',
          borderRight: 'none', borderLeft: 'none',
          color: 'rgba(255,255,255,0.4)', padding: '6px 6px',
          fontSize: 9, cursor: 'pointer', fontFamily: MAP_FONT,
        }}>
          X
        </button>
      )}
      <button type="submit" style={{
        background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)',
        color: 'rgba(255,255,255,0.6)', padding: '6px 8px',
        fontSize: 8, fontWeight: 700, cursor: 'pointer', fontFamily: MAP_FONT,
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        GO
      </button>
    </form>
  );
}

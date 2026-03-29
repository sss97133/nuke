/**
 * QI Make Filter — Dropdown to filter question intelligence by vehicle make.
 * Uses question_top_makes() for the dropdown list and question_profile_fast() for filtered data.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';

interface MakeOption {
  make: string;
  question_count: number;
  vehicle_count: number;
}

const fmtK = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

export default function QIMakeFilter() {
  const [params, setParams] = useSearchParams();
  const currentMake = params.get('make');
  const [makes, setMakes] = useState<MakeOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('question_top_makes', { p_limit: 30 });
      if (data) setMakes(data);
    })();
  }, []);

  const selectMake = (make: string | null) => {
    const next = new URLSearchParams(params);
    if (make) {
      next.set('make', make);
    } else {
      next.delete('make');
    }
    // Clear drill-down when changing make
    next.delete('l1');
    next.delete('l2');
    next.delete('field');
    next.delete('author');
    setParams(next);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          border: '2px solid var(--border)',
          background: currentMake ? 'var(--text)' : 'var(--surface)',
          color: currentMake ? 'var(--bg)' : 'var(--text)',
          padding: '4px 12px',
          fontSize: 'var(--fs-9)',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 600,
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {currentMake || 'ALL MAKES'} {open ? '\u25B2' : '\u25BC'}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 100,
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          maxHeight: '320px',
          overflowY: 'auto',
          minWidth: '220px',
          marginTop: '2px',
        }}>
          {/* All Makes option */}
          <div
            onClick={() => selectMake(null)}
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 'var(--fs-9)',
              fontWeight: !currentMake ? 700 : 400,
              background: !currentMake ? 'var(--accent-dim)' : 'transparent',
              borderBottom: '1px solid var(--border)',
            }}
          >
            ALL MAKES
          </div>

          {makes.map(m => (
            <div
              key={m.make}
              onClick={() => selectMake(m.make)}
              style={{
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 'var(--fs-9)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                fontWeight: currentMake === m.make ? 700 : 400,
                background: currentMake === m.make ? 'var(--accent-dim)' : 'transparent',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = currentMake === m.make ? 'var(--accent-dim)' : 'transparent')}
            >
              <span>{m.make}</span>
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 'var(--fs-8)',
                color: 'var(--text-secondary)',
              }}>{fmtK(m.question_count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

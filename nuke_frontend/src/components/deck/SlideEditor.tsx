/**
 * SlideEditor — right-side panel for editing a slide's structured content.
 * Opens when a slide is clicked in edit mode. Fields adapt to slide_type.
 * Non-technical users can edit text, swap images, reorder cards.
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { DeckSlide } from './useDeckData';
import { saveDeckSlide } from './useDeckData';

interface Props {
  slide: DeckSlide;
  onClose: () => void;
  onSaved: () => void;
}

/** Deep clone content for editing without mutating original */
function cloneContent(c: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(c));
}

export default function SlideEditor({ slide, onClose, onSaved }: Props) {
  const [content, setContent] = useState(() => cloneContent(slide.content));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(cloneContent(slide.content));
    setDirty(false);
  }, [slide.id]);

  const update = useCallback((path: string[], value: any) => {
    setContent(prev => {
      const next = cloneContent(prev);
      let obj: any = next;
      for (let i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
      return next;
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const { error } = await saveDeckSlide(slide.id, { content });
    setSaving(false);
    if (error) {
      alert('Save failed: ' + error);
    } else {
      setDirty(false);
      onSaved();
    }
  }, [slide.id, content, onSaved]);

  // Strip html and _revision_count from displayed fields
  const editableKeys = Object.keys(content).filter(k => k !== 'html' && k !== '_revision_count');

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
            Slide {slide.slide_index} · {slide.slide_type}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {content.title ? stripHtml(content.title).slice(0, 50) : `Slide ${slide.slide_index}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dirty && (
            <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
      </div>

      <div style={bodyStyle}>
        {editableKeys.map(key => (
          <FieldEditor
            key={key}
            fieldKey={key}
            value={content[key]}
            onChange={(val) => update([key], val)}
          />
        ))}
      </div>
    </div>
  );
}

/** Renders an editable field based on its type */
function FieldEditor({ fieldKey, value, onChange }: { fieldKey: string; value: any; onChange: (v: any) => void }) {
  if (value === null || value === undefined) return null;

  // String field
  if (typeof value === 'string') {
    const isLong = value.length > 100;
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>{formatLabel(fieldKey)}</label>
        {isLong ? (
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
    );
  }

  // Number / boolean
  if (typeof value === 'number') {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>{formatLabel(fieldKey)}</label>
        <input
          type="number"
          value={value}
          step={value < 1 ? 0.05 : 1}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ ...inputStyle, width: 100 }}
        />
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div style={fieldStyle}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
          {formatLabel(fieldKey)}
        </label>
      </div>
    );
  }

  // Array of strings (body paragraphs, items, logos)
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>{formatLabel(fieldKey)} ({value.length})</label>
        {value.map((item: string, i: number) => (
          <textarea
            key={i}
            value={item}
            onChange={e => {
              const next = [...value];
              next[i] = e.target.value;
              onChange(next);
            }}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 6 }}
            placeholder={`${fieldKey}[${i}]`}
          />
        ))}
      </div>
    );
  }

  // Array of objects (cards, images, stats, partner_cards, etc.)
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>{formatLabel(fieldKey)} ({value.length} items)</label>
        {value.map((item: any, i: number) => (
          <div key={i} style={cardEditorStyle}>
            <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>#{i + 1}</div>
            {Object.entries(item).map(([k, v]) => {
              if (typeof v === 'string') {
                const isUrl = k === 'url' || k === 'avatar' || k === 'src';
                return (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <label style={{ ...labelStyle, fontSize: 9 }}>{k}</label>
                    {isUrl ? (
                      <div>
                        <input
                          type="text"
                          value={v as string}
                          onChange={e => {
                            const next = [...value];
                            next[i] = { ...next[i], [k]: e.target.value };
                            onChange(next);
                          }}
                          style={inputStyle}
                        />
                        {(v as string) && (
                          <img src={v as string} alt="" style={{ maxWidth: '100%', maxHeight: 80, marginTop: 4, objectFit: 'contain' }} />
                        )}
                      </div>
                    ) : (v as string).length > 80 ? (
                      <textarea
                        value={v as string}
                        onChange={e => {
                          const next = [...value];
                          next[i] = { ...next[i], [k]: e.target.value };
                          onChange(next);
                        }}
                        style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={v as string}
                        onChange={e => {
                          const next = [...value];
                          next[i] = { ...next[i], [k]: e.target.value };
                          onChange(next);
                        }}
                        style={inputStyle}
                      />
                    )}
                  </div>
                );
              }
              return null; // skip nested objects/arrays for now
            })}
          </div>
        ))}
      </div>
    );
  }

  // Object (callout, quote, etc.)
  if (typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>{formatLabel(fieldKey)}</label>
        <div style={{ paddingLeft: 12, borderLeft: '2px solid #333' }}>
          {Object.entries(value).map(([k, v]) => (
            <FieldEditor
              key={k}
              fieldKey={k}
              value={v}
              onChange={(newVal) => onChange({ ...value, [k]: newVal })}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function formatLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Styles
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: 420,
  height: '100vh',
  background: '#1a1a2e',
  borderLeft: '1px solid #333',
  zIndex: 200,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: "'Inter', -apple-system, sans-serif",
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid #333',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: 20,
  overflowY: 'auto',
  flex: 1,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: '#888',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#222',
  border: '1px solid #444',
  color: '#ddd',
  fontSize: 13,
  fontFamily: 'inherit',
  borderRadius: 0,
  outline: 'none',
};

const cardEditorStyle: React.CSSProperties = {
  padding: 12,
  background: '#151525',
  border: '1px solid #333',
  marginBottom: 8,
};

const saveBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 11,
  letterSpacing: 2,
  textTransform: 'uppercase',
  background: '#003478',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const closeBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  background: 'transparent',
  color: '#888',
  border: '1px solid #444',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

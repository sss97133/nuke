// src/components/intake/EventForm/fieldRenderers.tsx
//
// Field-level renderers + checklist icon row. First-ship handles only the
// shapes that note.json uses: string, string-with-enum, long string,
// array<string-with-enum>, array<string>. Other shapes show a "not yet
// supported" placeholder so adding a new event type fails loudly, not silently.

import React from 'react';
import type {
  ChecklistAnnotation,
  EventSchemaProperty,
} from '../../../lib/intake/eventRegistry';
import {
  chipStyle,
  errStyle,
  fieldRowStyle,
  helpStyle,
  inputStyle,
  labelStyle,
  textareaStyle,
} from './styles';

// ── Checklist icons ──────────────────────────────────────────────────────────

export function ChecklistIcons({ ann }: { ann?: ChecklistAnnotation }) {
  if (!ann) return null;
  const tag = (label: string, on: boolean, title: string) => (
    <span
      title={title}
      style={{
        fontSize: 9,
        padding: '1px 4px',
        border: '1px solid var(--border, #111)',
        borderRadius: 0,
        opacity: on ? 1 : 0.25,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {label}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {tag('VIS', ann.vision_fillable, 'Vision-fillable: an agent can fill this from a photo')}
      {tag('CTX', ann.context_fillable, 'Context-fillable: an agent can fill this from chat scrollback')}
      {tag('TOOL', ann.tool_fillable, 'Tool-fillable: an agent can ask the system for this')}
    </span>
  );
}

// ── Field renderer ───────────────────────────────────────────────────────────

export interface FieldProps {
  name: string;
  prop: EventSchemaProperty;
  required: boolean;
  ann?: ChecklistAnnotation;
  value: unknown;
  error?: string;
  onChange: (next: unknown) => void;
}

export function Field({ name, prop, required, ann, value, error, onChange }: FieldProps) {
  const label = (
    <label style={labelStyle}>
      <span>
        {name}
        {required ? ' *' : ''}
      </span>
      <ChecklistIcons ann={ann} />
    </label>
  );
  const help = prop.description ? <div style={helpStyle}>{prop.description}</div> : null;
  const errEl = error ? <div style={errStyle}>{error}</div> : null;

  // String with enum → segmented buttons
  if (prop.type === 'string' && prop.enum && prop.enum.length > 0) {
    const v = (value as string) ?? '';
    return (
      <div style={fieldRowStyle}>
        {label}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button type="button" onClick={() => onChange('')} style={chipStyle(v === '')}>
            none
          </button>
          {prop.enum.map((opt) => (
            <button
              type="button"
              key={opt}
              onClick={() => onChange(opt)}
              style={chipStyle(v === opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        {help}
        {errEl}
      </div>
    );
  }

  // String → input or textarea
  if (prop.type === 'string') {
    const isLong = (prop.maxLength ?? 0) > 500 || name === 'narrative';
    return (
      <div style={fieldRowStyle}>
        {label}
        {isLong ? (
          <textarea
            style={textareaStyle}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={prop.maxLength}
            required={required}
          />
        ) : (
          <input
            type="text"
            style={inputStyle}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={prop.maxLength}
            minLength={prop.minLength}
            required={required}
          />
        )}
        {help}
        {errEl}
      </div>
    );
  }

  // Array<string> with enum items → multi-select chips
  if (prop.type === 'array' && prop.items?.type === 'string' && prop.items.enum) {
    const list = (value as string[]) ?? [];
    return (
      <div style={fieldRowStyle}>
        {label}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {prop.items.enum.map((opt) => {
            const on = list.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                onClick={() => onChange(on ? list.filter((x) => x !== opt) : [...list, opt])}
                style={chipStyle(on)}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {help}
        {errEl}
      </div>
    );
  }

  // Array<string> free-form → newline-separated textarea
  if (prop.type === 'array' && prop.items?.type === 'string') {
    const list = (value as string[]) ?? [];
    return (
      <div style={fieldRowStyle}>
        {label}
        <textarea
          style={textareaStyle}
          value={list.join('\n')}
          placeholder="One item per line"
          onChange={(e) => {
            const next = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(next);
          }}
        />
        {help}
        {errEl}
      </div>
    );
  }

  // Fallback
  return (
    <div style={fieldRowStyle}>
      {label}
      <div style={{ ...helpStyle, color: '#a00' }}>
        Field type not yet supported by EventForm first ship: {String(prop.type)}
        {prop.items?.type ? ` of ${String(prop.items.type)}` : ''}
      </div>
      {help}
    </div>
  );
}


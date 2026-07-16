// src/components/intake/EventForm/EventForm.tsx
//
// First-ship form generator (F2). For v1 only `note` is wired.
// Walks the JSON Schema, renders raw HTML inputs styled to
// unified-design-system.css tokens, and submits the v1 envelope
// to POST /v1/events.
//
// Per paper §6: foundation primitives don't exist yet — raw HTML.
// Per paper §F2: every field gets three checklist icons.

import React, { useMemo, useState } from 'react';
import type { EventType, EventSchema, EventChecklist } from '../../../lib/intake/eventRegistry';
import { getEventSchema, getEventChecklist } from '../../../lib/intake/eventRegistry';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../../lib/env';
import { supabase } from '../../../lib/supabase';
import { Field } from './fieldRenderers';
import {
  buttonStyle,
  errStyle,
  fieldRowStyle,
  helpStyle,
  inputStyle,
  labelStyle,
} from './styles';

export interface EventFormProps {
  event_type: EventType;
  /** Optional VIN to attach to vehicle_ref. Required by api-v1-events today. */
  vin?: string;
  onSubmitted?: (
    result: { ok: true; observation_id?: string } | { ok: false; error: string }
  ) => void;
}

interface FormState {
  values: Record<string, unknown>;
  errors: Record<string, string>;
  submitting: boolean;
  serverError: string | null;
}

export function EventForm({ event_type, vin, onSubmitted }: EventFormProps) {
  const schema: EventSchema = useMemo(() => getEventSchema(event_type), [event_type]);
  const checklist: EventChecklist = useMemo(() => getEventChecklist(event_type), [event_type]);

  const [state, setState] = useState<FormState>({
    values: {},
    errors: {},
    submitting: false,
    serverError: null,
  });
  const [vinInput, setVinInput] = useState<string>(vin ?? '');

  const setValue = (name: string, next: unknown) =>
    setState((s) => ({
      ...s,
      values: { ...s.values, [name]: next },
      errors: { ...s.errors, [name]: '' },
    }));

  const validate = (): { ok: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    for (const req of schema.required ?? []) {
      const v = state.values[req];
      if (v === undefined || v === null || v === '') errors[req] = 'Required';
    }
    for (const [name, prop] of Object.entries(schema.properties)) {
      const v = state.values[name];
      if (typeof v === 'string') {
        if (prop.minLength !== undefined && v.length > 0 && v.length < prop.minLength) {
          errors[name] = `Min length ${prop.minLength}`;
        }
        if (prop.maxLength !== undefined && v.length > prop.maxLength) {
          errors[name] = `Max length ${prop.maxLength}`;
        }
      }
    }
    return { ok: Object.keys(errors).length === 0, errors };
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (!v.ok) {
      setState((s) => ({ ...s, errors: v.errors }));
      return;
    }
    setState((s) => ({ ...s, submitting: true, serverError: null }));

    // Strip empties so additionalProperties:false on the server doesn't choke.
    const payload: Record<string, unknown> = {};
    for (const [name] of Object.entries(schema.properties)) {
      const val = state.values[name];
      if (val === undefined || val === null || val === '') continue;
      if (Array.isArray(val) && val.length === 0) continue;
      payload[name] = val;
    }

    const nowIso = new Date().toISOString();
    const envelope = {
      schema_version: '1.0',
      event_type,
      vehicle_ref: { vin: vinInput.trim().toUpperCase() },
      occurred_at: nowIso,
      submitted_at: nowIso,
      agent: { id: 'nuke-web-intake', version: 'first-ship' },
      auth: { scopes: ['events:write:all'] },
      payload,
    };

    // Best-effort auth header. If the user is signed in, send their JWT.
    // Otherwise send the anon key so the function gateway accepts the request
    // (the api-v1-events handler will still apply its own auth check).
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      headers['Authorization'] = `Bearer ${token ?? SUPABASE_ANON_KEY}`;
      headers['apikey'] = SUPABASE_ANON_KEY;
    } catch {
      headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
      headers['apikey'] = SUPABASE_ANON_KEY;
    }

    const url = `${SUPABASE_URL}/functions/v1/api-v1-events`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = (json?.error as string) || `HTTP ${res.status}`;
        setState((s) => ({ ...s, submitting: false, serverError: errMsg }));
        onSubmitted?.({ ok: false, error: errMsg });
        return;
      }
      setState({ values: {}, errors: {}, submitting: false, serverError: null });
      onSubmitted?.({ ok: true, observation_id: json?.observation_id });
    } catch (err: any) {
      const errMsg = err?.message || 'Network error';
      setState((s) => ({ ...s, submitting: false, serverError: errMsg }));
      onSubmitted?.({ ok: false, error: errMsg });
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
      {/* VIN — required by api-v1-events today; surface explicitly. */}
      <div style={fieldRowStyle}>
        <label style={labelStyle}>
          <span>VIN *</span>
        </label>
        <input
          type="text"
          style={inputStyle}
          value={vinInput}
          onChange={(e) => setVinInput(e.target.value)}
          placeholder="Vehicle Identification Number"
          required
        />
        <div style={helpStyle}>Required. The note will attach to this VIN.</div>
      </div>

      {Object.entries(schema.properties).map(([name, prop]) => (
        <Field
          key={name}
          name={name}
          prop={prop}
          required={(schema.required ?? []).includes(name)}
          ann={checklist[name]}
          value={state.values[name]}
          error={state.errors[name]}
          onChange={(next) => setValue(name, next)}
        />
      ))}

      {state.serverError ? (
        <div style={{ ...errStyle, marginBottom: 12 }}>Server: {state.serverError}</div>
      ) : null}

      <button type="submit" style={buttonStyle} disabled={state.submitting}>
        {state.submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}

export default EventForm;

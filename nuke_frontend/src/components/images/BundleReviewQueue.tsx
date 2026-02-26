/**
 * BundleReviewQueue
 *
 * Shows auto-created photo session events that need owner input.
 * Appears in the EVIDENCE tab of VehicleProfile.
 *
 * Speed optimizations:
 *   - Thumbnails loaded in ONE batch query (grouped by timeline_event_id)
 *   - AI suggestions read from metadata.ai_suggestion — no Vision call on load
 *   - Falls back to edge function only for events that pre-date the suggestion cache
 *
 * Save flow writes to proper columns:
 *   - timeline_events.cost_amount, .service_provider_name, .source_type, .confidence_score
 *   - receipts.timeline_event_id (direct FK) + receipt_links
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface AISuggestion {
  title: string;
  event_type: string;
  confidence: number;
  reasoning: string;
}

interface BundleEvent {
  id: string;
  event_date: string;
  title: string;
  event_type: string;
  metadata: {
    needs_input?: boolean;
    bundle_auto_created?: boolean;
    image_count?: number;
    session_start?: string;
    session_end?: string;
    duration_minutes?: number;
    ai_suggestion?: AISuggestion | null;
  };
}

interface BundleReviewQueueProps {
  vehicleId: string;
  onComplete?: () => void;
}

const EVENT_TYPE_OPTIONS = [
  { value: 'other', label: 'General / Documentation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repair', label: 'Repair' },
  { value: 'modification', label: 'Modification' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'service', label: 'Service' },
  { value: 'work_completed', label: 'Work Completed' },
];

export default function BundleReviewQueue({ vehicleId, onComplete }: BundleReviewQueueProps) {
  const [events, setEvents] = useState<BundleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion | null>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string[]>>({});

  const [forms, setForms] = useState<Record<string, {
    title: string;
    event_type: string;
    cost: string;
    vendor: string;
    notes: string;
    saving: boolean;
    saved: boolean;
  }>>({});

  useEffect(() => {
    loadQueue();
  }, [vehicleId]);

  const loadQueue = async () => {
    setLoading(true);

    const { data } = await supabase
      .from('timeline_events')
      .select('id, event_date, title, event_type, metadata')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: true });

    const needsInput = (data || []).filter(
      (e: any) => e.metadata?.needs_input === true || e.metadata?.bundle_auto_created === true
    ) as BundleEvent[];

    setEvents(needsInput);

    // Seed suggestions and form state from metadata — zero extra API calls
    const seedSuggestions: Record<string, AISuggestion | null> = {};
    const initialForms: typeof forms = {};
    const eventsNeedingSuggestion: BundleEvent[] = [];

    for (const ev of needsInput) {
      const cached = ev.metadata?.ai_suggestion ?? null;
      seedSuggestions[ev.id] = cached;
      initialForms[ev.id] = {
        title: cached?.title || ev.title,
        event_type: cached?.event_type || ev.event_type || 'documentation',
        cost: '',
        vendor: '',
        notes: '',
        saving: false,
        saved: false,
      };
      if (!cached) eventsNeedingSuggestion.push(ev);
    }

    setSuggestions(seedSuggestions);
    setForms(initialForms);

    // Batch-load thumbnails in ONE query grouped by timeline_event_id
    if (needsInput.length > 0) {
      const eventIds = needsInput.map(e => e.id);
      const { data: thumbData } = await supabase
        .from('vehicle_images')
        .select('id, thumbnail_url, medium_url, image_url, variants, timeline_event_id')
        .eq('vehicle_id', vehicleId)
        .in('timeline_event_id', eventIds)
        .order('taken_at', { ascending: true });

      if (thumbData) {
        const grouped: Record<string, string[]> = {};
        for (const img of thumbData) {
          const evId = img.timeline_event_id as string;
          if (!evId) continue;
          if (!grouped[evId]) grouped[evId] = [];
          if (grouped[evId].length >= 4) continue;
          const v = img.variants as any;
          const url = v?.thumbnail || img.thumbnail_url || img.medium_url || img.image_url;
          if (url) grouped[evId].push(url);
        }
        setThumbnails(grouped);
      }
    }

    setLoading(false);

    // Fire-and-forget: fetch suggestions for events that predate the cache
    for (const ev of eventsNeedingSuggestion) {
      fetchSuggestionAndCache(ev);
    }
  };

  // Only called for events without metadata.ai_suggestion (legacy or pre-cache events)
  const fetchSuggestionAndCache = async (event: BundleEvent) => {
    const dateStr = event.event_date.split('T')[0];

    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('timeline_event_id', event.id)
      .limit(8);

    if (!images || images.length === 0) return;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(
        `${import.meta.env?.VITE_SUPABASE_URL}/functions/v1/suggest-bundle-label`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token || import.meta.env?.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            vehicle_id: vehicleId,
            bundle_date: dateStr,
            image_ids: images.map(i => i.id),
          }),
        }
      );

      if (!res.ok) return;
      const suggestion: AISuggestion = await res.json();

      setSuggestions(prev => ({ ...prev, [event.id]: suggestion }));

      // Pre-fill form if user hasn't typed anything yet
      setForms(prev => {
        const existing = prev[event.id];
        if (!existing || existing.title === event.title) {
          return {
            ...prev,
            [event.id]: {
              ...existing,
              title: suggestion.title || existing?.title || '',
              event_type: suggestion.event_type || existing?.event_type || 'documentation',
            },
          };
        }
        return prev;
      });

      // Write suggestion back to metadata so next load is instant
      await supabase
        .from('timeline_events')
        .update({
          metadata: {
            ...event.metadata,
            ai_suggestion: {
              title: suggestion.title,
              event_type: suggestion.event_type,
              confidence: suggestion.confidence,
              reasoning: suggestion.reasoning,
            },
          },
        })
        .eq('id', event.id);
    } catch {
      // Suggestion is optional — fail silently
    }
  };

  const updateForm = (eventId: string, field: string, value: string) => {
    setForms(prev => ({
      ...prev,
      [eventId]: { ...prev[eventId], [field]: value },
    }));
  };

  const saveEvent = async (event: BundleEvent) => {
    const form = forms[event.id];
    if (!form) return;

    setForms(prev => ({ ...prev, [event.id]: { ...prev[event.id], saving: true } }));

    const costAmount = form.cost ? parseFloat(form.cost.replace(/[$,]/g, '')) : null;

    // Update timeline event using proper schema columns
    const { error } = await supabase
      .from('timeline_events')
      .update({
        title: form.title,
        event_type: form.event_type,
        description: form.notes || null,
        cost_amount: costAmount ?? null,
        service_provider_name: form.vendor || null,
        source_type: 'user_input',
        confidence_score: 80,
        metadata: {
          ...event.metadata,
          needs_input: false,
          reviewed_at: new Date().toISOString(),
        },
      })
      .eq('id', event.id);

    if (error) {
      console.error('[BundleReviewQueue] save error:', error);
      setForms(prev => ({ ...prev, [event.id]: { ...prev[event.id], saving: false } }));
      return;
    }

    // If cost entered, create receipt with direct timeline_event_id FK
    if (costAmount && costAmount > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: receipt } = await supabase
        .from('receipts')
        .insert({
          scope_type: 'vehicle',
          scope_id: vehicleId,
          vehicle_id: vehicleId,
          vendor_name: form.vendor || null,
          receipt_date: event.event_date.split('T')[0],
          total: costAmount,
          total_amount: costAmount,
          currency: 'USD',
          status: 'processed',
          timeline_event_id: event.id,
          created_by: user?.id ?? null,
          file_url: 'manual_entry',
        })
        .select('id')
        .single();

      if (receipt?.id) {
        await supabase.from('receipt_links').insert({
          receipt_id: receipt.id,
          linked_type: 'timeline_event',
          linked_id: event.id,
        });
      }
    }

    setForms(prev => ({ ...prev, [event.id]: { ...prev[event.id], saving: false, saved: true } }));

    setTimeout(() => {
      setEvents(prev => prev.filter(e => e.id !== event.id));
      setExpanded(null);
      if (events.length <= 1) onComplete?.();
    }, 1200);
  };

  if (loading) return null;
  if (events.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: '16px', border: '1px solid #f59e0b33', background: '#fffbeb' }}>
      {/* Header */}
      <div
        className="card-header"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#92400e' }}>
            Sessions to Review
          </span>
          <span style={{
            background: '#f59e0b',
            color: '#fff',
            borderRadius: '10px',
            padding: '1px 8px',
            fontSize: '11px',
            fontWeight: 600,
          }}>
            {events.length}
          </span>
        </div>
        <span style={{ fontSize: '11px', color: '#92400e', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 0 8px' }}>
          {events.map(event => {
            const form = forms[event.id];
            const suggestion = suggestions[event.id];
            const thumbs = thumbnails[event.id] || [];
            const isExpanded = expanded === event.id;
            const dateLabel = new Date(event.event_date + 'T12:00:00Z').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            });
            const imageCount = event.metadata?.image_count;

            return (
              <div key={event.id} style={{ borderTop: '1px solid #fde68a', padding: '10px 16px' }}>
                {/* Row summary */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                  onClick={() => setExpanded(isExpanded ? null : event.id)}
                >
                  {/* Thumbnails strip */}
                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                    {thumbs.slice(0, 3).map((url, i) => (
                      <img key={i} src={url} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '3px', background: '#e5e7eb' }} alt="" />
                    ))}
                    {thumbs.length === 0 && (
                      <div style={{ width: '36px', height: '36px', background: '#fde68a', borderRadius: '3px' }} />
                    )}
                  </div>

                  {/* Date + count + AI label */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: '#111' }}>
                      {form?.saved ? '✓ ' : ''}{form?.title || event.title}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#6b7280' }}>
                      {dateLabel}{imageCount ? ` · ${imageCount} photos` : ''}
                      {suggestion && !form?.saved && (
                        <span style={{ marginLeft: '8px', color: '#92400e', fontStyle: 'italic' }}>
                          {suggestion.event_type}
                        </span>
                      )}
                    </p>
                  </div>

                  {form?.saved
                    ? <span style={{ fontSize: '12px', color: '#10b981', flexShrink: 0 }}>Saved ✓</span>
                    : <span style={{ fontSize: '11px', color: '#92400e', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                  }
                </div>

                {/* Expanded form */}
                {isExpanded && form && !form.saved && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #fde68a' }}>
                    {/* AI suggestion chip */}
                    {suggestion && (
                      <div style={{ marginBottom: '10px', padding: '8px 10px', background: '#fef3c7', borderRadius: '4px', fontSize: '11px', color: '#92400e', lineHeight: 1.5 }}>
                        <strong>AI:</strong> "{suggestion.title}" · {suggestion.event_type}
                        {suggestion.reasoning ? ` — ${suggestion.reasoning}` : ''}
                        <button
                          onClick={() => setForms(prev => ({
                            ...prev,
                            [event.id]: { ...prev[event.id], title: suggestion.title, event_type: suggestion.event_type },
                          }))}
                          style={{ background: '#f59e0b', border: 'none', borderRadius: '3px', padding: '2px 8px', fontSize: '10px', color: '#fff', cursor: 'pointer', marginLeft: '8px' }}
                        >
                          Accept
                        </button>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '3px' }}>Title</label>
                        <input
                          value={form.title}
                          onChange={e => updateForm(event.id, 'title', e.target.value)}
                          style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '3px', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '3px' }}>Type</label>
                        <select
                          value={form.event_type}
                          onChange={e => updateForm(event.id, 'event_type', e.target.value)}
                          style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '3px', boxSizing: 'border-box' }}
                        >
                          {EVENT_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '3px' }}>Cost</label>
                        <input
                          value={form.cost}
                          onChange={e => updateForm(event.id, 'cost', e.target.value)}
                          placeholder="$0.00"
                          style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '3px', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '3px' }}>Vendor</label>
                        <input
                          value={form.vendor}
                          onChange={e => updateForm(event.id, 'vendor', e.target.value)}
                          placeholder="Shop name..."
                          style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '3px', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '3px' }}>Notes</label>
                      <textarea
                        value={form.notes}
                        onChange={e => updateForm(event.id, 'notes', e.target.value)}
                        placeholder="What happened during this session?"
                        rows={2}
                        style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '3px', boxSizing: 'border-box', resize: 'vertical' }}
                      />
                    </div>
                    <button
                      onClick={() => saveEvent(event)}
                      disabled={form.saving || !form.title}
                      className="button button-primary"
                      style={{ fontSize: '11px', padding: '6px 16px' }}
                    >
                      {form.saving ? 'Saving…' : 'Save Session'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

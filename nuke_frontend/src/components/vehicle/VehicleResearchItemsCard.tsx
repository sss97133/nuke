import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';

type ResearchItemType = 'source' | 'note' | 'question' | 'claim' | 'event';
type ResearchStatus = 'open' | 'resolved' | 'dismissed';
type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

type ResearchItem = {
  id: string;
  item_type: ResearchItemType;
  status: ResearchStatus;
  title: string;
  summary?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  event_date?: string | null;
  date_precision?: DatePrecision | null;
  confidence?: number | null;
  created_at?: string | null;
};

const typeLabel: Record<ResearchItemType, string> = {
  source: 'Source',
  note: 'Note',
  question: 'Question',
  claim: 'Claim',
  event: 'Event'
};

const statusLabel: Record<ResearchStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed'
};

const badgeForStatus = (status: ResearchStatus) => {
  switch (status) {
    case 'resolved':
      return 'badge badge-success';
    case 'dismissed':
      return 'badge badge-secondary';
    default:
      return 'badge badge-warning';
  }
};

const formatDate = (ymd?: string | null, precision?: DatePrecision | null): string => {
  if (!ymd) return 'Date unknown';
  const [year, month, day] = String(ymd).split('-').map((v) => Number(v));
  if (!year) return 'Date unknown';
  if (precision === 'year') return String(year);
  if (precision === 'month' && month) {
    const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short' });
    return `${monthName} ${year}`;
  }
  if (month && day) {
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  return String(year);
};

export default function VehicleResearchItemsCard({ vehicleId }: { vehicleId: string }) {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [itemType, setItemType] = useState<ResearchItemType>('source');
  const [datePrecision, setDatePrecision] = useState<DatePrecision>('unknown');
  const [eventDate, setEventDate] = useState('');

  const loadItems = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_research_items')
        .select('id, item_type, status, title, summary, source_url, source_type, event_date, date_precision, confidence, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      setItems((data as ResearchItem[]) || []);
    } catch (err) {
      console.error('Failed to load research items:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const resetForm = () => {
    setTitle('');
    setSummary('');
    setSourceUrl('');
    setItemType('source');
    setDatePrecision('unknown');
    setEventDate('');
  };

  const handleAdd = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const createdBy = auth?.user?.id || null;
      const eventDateValue = eventDate ? eventDate : null;
      const { error } = await supabase
        .from('vehicle_research_items')
        .insert({
          vehicle_id: vehicleId,
          created_by: createdBy,
          item_type: itemType,
          status: 'open',
          title: title.trim(),
          summary: summary.trim() || null,
          source_url: sourceUrl.trim() || null,
          source_type: sourceUrl.trim() ? itemType : null,
          event_date: eventDateValue,
          date_precision: datePrecision
        });
      if (error) throw error;
      resetForm();
      setShowAdd(false);
      await loadItems();
    } catch (err: any) {
      console.error('Failed to add research item:', err);
      alert(`Failed to add research item: ${err?.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openItems = useMemo(() => items.filter((item) => item.status === 'open'), [items]);

  return (
    <CollapsibleWidget
      title="Research Notes"
      defaultCollapsed={true}
      badge={<span className="badge badge-secondary">{openItems.length}</span>}
      action={
        <button className="button button-small" onClick={(e) => { e.stopPropagation(); setShowAdd((v) => !v); }}>
          {showAdd ? 'Close' : 'Add'}
        </button>
      }
    >
      <div>
        {showAdd && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Title (e.g., 'Radical PDF mentions P/1080 restoration')"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="input"
              placeholder="Summary / open question"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
              <input
                className="input"
                placeholder="Source URL (optional)"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
              <select className="input" value={itemType} onChange={(e) => setItemType(e.target.value as ResearchItemType)}>
                <option value="source">Source</option>
                <option value="note">Note</option>
                <option value="question">Question</option>
                <option value="claim">Claim</option>
                <option value="event">Event</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
              <input
                className="input"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <select className="input" value={datePrecision} onChange={(e) => setDatePrecision(e.target.value as DatePrecision)}>
                <option value="unknown">Date unknown</option>
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
            <button className="button button-primary" onClick={handleAdd} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save research note'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-small text-muted">Loading research notes…</div>
        ) : items.length === 0 ? (
          <div className="text-small text-muted">No research notes yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: 10, background: 'var(--white)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700 }}>{item.title}</div>
                      <span className="badge badge-secondary">{typeLabel[item.item_type]}</span>
                      <span className={badgeForStatus(item.status)}>{statusLabel[item.status]}</span>
                    </div>
                    {item.summary && (
                      <div className="text-small text-muted" style={{ marginTop: 6 }}>
                        {item.summary}
                      </div>
                    )}
                    <div className="text-small text-muted" style={{ marginTop: 6 }}>
                      {formatDate(item.event_date || undefined, item.date_precision)}
                      {typeof item.confidence === 'number' ? ` • ${item.confidence}% confidence` : ''}
                    </div>
                    {item.source_url && (
                      <div style={{ marginTop: 6 }}>
                        <a href={item.source_url} target="_blank" rel="noreferrer" className="text-small">
                          {item.source_url}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
}

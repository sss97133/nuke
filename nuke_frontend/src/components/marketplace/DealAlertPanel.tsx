import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';

type DealAlertStatus = 'active' | 'pending' | 'sold' | 'expired' | 'removed';

type DealAlertSource =
  | 'craigslist'
  | 'facebook_marketplace'
  | 'bring_a_trailer'
  | 'cars_and_bids'
  | 'ebay_motors'
  | 'hemmings'
  | 'autotrader'
  | 'other';

interface DealAlert {
  id: string;
  source: DealAlertSource;
  title: string | null;
  description: string | null;
  listing_url: string;
  asking_price: number | null;
  currency: string | null;
  location: string | null;
  posted_at: string | null;
  first_seen_at: string;
  status: DealAlertStatus;
  sold_at: string | null;
  created_by: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  source: DealAlertSource;
  title: string;
  listingUrl: string;
  askingPrice: string;
  location: string;
  postedAt: string;
  notes: string;
}

const defaultForm: FormState = {
  source: 'craigslist',
  title: '',
  listingUrl: '',
  askingPrice: '',
  location: '',
  postedAt: '',
  notes: ''
};

const sourceOptions: Array<{ value: DealAlertSource; label: string }> = [
  { value: 'craigslist', label: 'Craigslist' },
  { value: 'facebook_marketplace', label: 'Facebook Marketplace' },
  { value: 'bring_a_trailer', label: 'Bring a Trailer' },
  { value: 'cars_and_bids', label: 'Cars & Bids' },
  { value: 'ebay_motors', label: 'eBay Motors' },
  { value: 'hemmings', label: 'Hemmings' },
  { value: 'autotrader', label: 'AutoTrader' },
  { value: 'other', label: 'Other' }
];

const formatDuration = (start: string | null | undefined, end: number): string => {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) return '—';
  const diffMs = Math.max(0, end - startMs);
  const totalMinutes = Math.round(diffMs / 60000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
  }
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (totalDays < 30) {
    return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
  }
  const totalMonths = Math.floor(totalDays / 30);
  const remainingDays = totalDays % 30;
  return remainingDays > 0 ? `${totalMonths}mo ${remainingDays}d` : `${totalMonths}mo`;
};

const DealAlertPanel: React.FC = () => {
  const [formState, setFormState] = useState<FormState>(defaultForm);
  const [alerts, setAlerts] = useState<DealAlert[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState<number>(Date.now());
  const { showToast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUserId(session?.user?.id ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user?.id ?? null);
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const loadAlerts = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const { data, error } = await supabase
        .from('marketplace_deal_alerts')
        .select('*')
        .order('first_seen_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setAlerts((data ?? []) as DealAlert[]);
    } catch (error: any) {
      console.error('Error loading deal alerts:', error);
      showToast(error.message || 'Failed to load deal alerts', 'error');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const handleFormChange = (field: keyof FormState, value: string) => {
    setFormState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormState(defaultForm);
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!sessionUserId) {
      showToast('Sign in to log deal alerts.', 'warning');
      return;
    }

    if (!formState.listingUrl.trim()) {
      showToast('Listing URL is required.', 'warning');
      return;
    }

    setSubmitting(true);

    try {
      const payload: Record<string, any> = {
        source: formState.source,
        title: formState.title.trim() || null,
        listing_url: formState.listingUrl.trim(),
        asking_price: formState.askingPrice ? Number(formState.askingPrice) : null,
        location: formState.location.trim() || null,
        posted_at: formState.postedAt ? new Date(formState.postedAt).toISOString() : null,
        metadata: formState.notes.trim()
          ? { notes: formState.notes.trim() }
          : {},
        created_by: sessionUserId
      };

      const { error } = await supabase
        .from('marketplace_deal_alerts')
        .insert(payload);

      if (error) {
        if (error.code === '23505') {
          showToast('This listing has already been logged.', 'info');
        } else {
          throw error;
        }
      } else {
        showToast('Deal alert logged.', 'success');
        resetForm();
        await loadAlerts();
      }
    } catch (error: any) {
      console.error('Error creating deal alert:', error);
      showToast(error.message || 'Failed to create deal alert.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const markSold = async (alertId: string) => {
    if (!sessionUserId) {
      showToast('Sign in to update deal alerts.', 'warning');
      return;
    }
    try {
      const { error } = await supabase
        .from('marketplace_deal_alerts')
        .update({
          status: 'sold',
          sold_at: new Date().toISOString()
        })
        .eq('id', alertId);
      if (error) throw error;
      showToast('Marked as sold.', 'success');
      await loadAlerts({ silent: true });
    } catch (error: any) {
      console.error('Error marking deal alert sold:', error);
      showToast(error.message || 'Failed to mark as sold.', 'error');
    }
  };

  const archiveAlert = async (alertId: string, status: DealAlertStatus = 'removed') => {
    if (!sessionUserId) {
      showToast('Sign in to update deal alerts.', 'warning');
      return;
    }
    try {
      const { error } = await supabase
        .from('marketplace_deal_alerts')
        .update({
          status,
          sold_at: status === 'sold' ? new Date().toISOString() : null
        })
        .eq('id', alertId);
      if (error) throw error;
      showToast('Deal alert updated.', 'success');
      await loadAlerts({ silent: true });
    } catch (error: any) {
      console.error('Error updating deal alert:', error);
      showToast(error.message || 'Failed to update deal alert.', 'error');
    }
  };

  const stats = useMemo(() => {
    const active = alerts.filter(alert => alert.status === 'active' || alert.status === 'pending');
    const sold = alerts.filter(alert => alert.status === 'sold' && alert.sold_at);

    const averageTimeToSale = sold.length > 0
      ? sold.reduce((acc, alert) => {
          const start = alert.posted_at ?? alert.first_seen_at;
          if (!start || !alert.sold_at) return acc;
          const duration = new Date(alert.sold_at).getTime() - new Date(start).getTime();
          return acc + Math.max(duration, 0);
        }, 0) / sold.length
      : null;

    return {
      activeCount: active.length,
      soldCount: sold.length,
      averageTimeToSale
    };
  }, [alerts]);

  const handleRefresh = async () => {
    await loadAlerts();
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '11pt' }}>Deal Alerts</h3>
        <button
          className="button button-small"
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          style={{ fontSize: '8pt' }}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: '16px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '12px',
          fontSize: '9pt'
        }}>
          <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--background-secondary)' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontSize: '8pt' }}>Active Alerts</div>
            <div style={{ fontWeight: 700, fontSize: '12pt' }}>{stats.activeCount}</div>
          </div>
          <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--background-secondary)' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontSize: '8pt' }}>Closed Deals</div>
            <div style={{ fontWeight: 700, fontSize: '12pt' }}>{stats.soldCount}</div>
          </div>
          <div style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--background-secondary)' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontSize: '8pt' }}>Avg Time to Sale</div>
            <div style={{ fontWeight: 700, fontSize: '12pt' }}>
              {stats.averageTimeToSale
                ? formatDuration(new Date(Date.now() - stats.averageTimeToSale).toISOString(), Date.now())
                : '—'}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '12px', display: 'grid', gap: '12px' }}>
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
              Source
              <select
                value={formState.source}
                onChange={(event) => handleFormChange('source', event.target.value)}
                required
                style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
              >
                {sourceOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
              Asking Price (USD)
              <input
                type="number"
                min="0"
                step="1"
                value={formState.askingPrice}
                onChange={(event) => handleFormChange('askingPrice', event.target.value)}
                placeholder="2500"
                style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
              Posted At
              <input
                type="datetime-local"
                value={formState.postedAt}
                onChange={(event) => handleFormChange('postedAt', event.target.value)}
                style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
              Location
              <input
                type="text"
                value={formState.location}
                onChange={(event) => handleFormChange('location', event.target.value)}
                placeholder="Pahrump, NV"
                style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
              />
            </label>
          </div>

          <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
            Listing URL
            <input
              type="url"
              value={formState.listingUrl}
              onChange={(event) => handleFormChange('listingUrl', event.target.value)}
              placeholder="https://lasvegas.craigslist.org/..."
              required
              style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </label>

  <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
            Title
            <input
              type="text"
              value={formState.title}
              onChange={(event) => handleFormChange('title', event.target.value)}
              placeholder="1967 Chevrolet Camaro"
              style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '4px', fontSize: '8pt', fontWeight: 600 }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) => handleFormChange('notes', event.target.value)}
              placeholder="Original motor and transmission included. No floor or trunk rust."
              rows={3}
              style={{ fontSize: '9pt', padding: '6px', border: '1px solid var(--border)', borderRadius: '4px', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={resetForm}
              disabled={submitting}
              style={{ fontSize: '8pt' }}
            >
              Clear
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={submitting}
              style={{ fontSize: '8pt' }}
            >
              {submitting ? 'Saving...' : 'Log Deal'}
            </button>
          </div>
        </form>

        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={{ fontSize: '9pt', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tracked Listings</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
              Ages update every minute • Sorted by newest first
            </span>
          </div>

          {loading && alerts.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Loading deal alerts...
            </div>
          ) : alerts.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
              No deal alerts logged yet. Add one above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '8pt' }}>
                    <th style={{ padding: '8px' }}>Listing</th>
                    <th style={{ padding: '8px' }}>Source</th>
                    <th style={{ padding: '8px' }}>Asking</th>
                    <th style={{ padding: '8px' }}>Location</th>
                    <th style={{ padding: '8px' }}>Age</th>
                    <th style={{ padding: '8px' }}>Status</th>
                    <th style={{ padding: '8px' }}>Time to Sale</th>
                    <th style={{ padding: '8px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(alert => {
                    const startTimestamp = alert.posted_at ?? alert.first_seen_at;
                    const age = formatDuration(startTimestamp, now);
                    const timeToSale = alert.sold_at
                      ? formatDuration(startTimestamp, new Date(alert.sold_at).getTime())
                      : '—';
                    const notes = alert.metadata?.notes as string | undefined;

                    return (
                      <tr key={alert.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px', maxWidth: '240px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <a
                              href={alert.listing_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', fontWeight: 600 }}
                            >
                              {alert.title || alert.listing_url}
                            </a>
                            {notes && (
                              <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                                {notes}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '8px' }}>
                          {sourceOptions.find(option => option.value === alert.source)?.label ?? alert.source}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {alert.asking_price ? `$${alert.asking_price.toLocaleString()}` : '—'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {alert.location || '—'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ fontWeight: 600 }}>{age}</span>
                          <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                            First seen {new Date(alert.first_seen_at).toLocaleString()}
                          </div>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '12px',
                              border: '1px solid var(--border)',
                              fontSize: '8pt',
                              background: alert.status === 'sold'
                                ? 'rgba(34,197,94,0.1)'
                                : alert.status === 'active'
                                  ? 'rgba(59,130,246,0.1)'
                                  : 'var(--background-secondary)'
                            }}
                          >
                            {alert.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>{timeToSale}</td>
                        <td style={{ padding: '8px' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {alert.status !== 'sold' && (
                              <button
                                className="button button-small"
                                type="button"
                                onClick={() => markSold(alert.id)}
                                style={{ fontSize: '8pt' }}
                              >
                                Mark Sold
                              </button>
                            )}
                            {alert.status === 'sold' ? (
                              <button
                                className="button button-small button-secondary"
                                type="button"
                                onClick={() => archiveAlert(alert.id, 'removed')}
                                style={{ fontSize: '8pt' }}
                              >
                                Archive
                              </button>
                            ) : (
                              <button
                                className="button button-small button-secondary"
                                type="button"
                                onClick={() => archiveAlert(alert.id)}
                                style={{ fontSize: '8pt' }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DealAlertPanel;


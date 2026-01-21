import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { calculateCommissionCents, getCommissionRate } from '../../utils/commission';
import '../../design-system.css';

interface ProxyBidRequest {
  id: string;
  user_id: string;
  platform: string;
  external_auction_url: string;
  max_bid_cents: number;
  bid_strategy: string;
  status: string;
  current_bid_cents: number | null;
  commission_rate?: number | null;
  created_at: string;
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    primary_image_url: string | null;
  } | null;
  external_listing: {
    end_date: string | null;
    current_bid: number | null;
  } | null;
  assignment: {
    id: string;
    status: string;
    assigned_operator_id: string | null;
  } | null;
  user_profile: {
    username: string | null;
    email: string | null;
  } | null;
}

const PLATFORM_NAMES: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  pcarmarket: 'PCarMarket',
  collecting_cars: 'Collecting Cars',
  broad_arrow: 'Broad Arrow',
  rmsothebys: 'RM Sothebys',
  gooding: 'Gooding & Co',
  sbx: 'SBX Cars',
};

export default function ProxyBidOperations() {
  const { user } = useAuth();
  const [bids, setBids] = useState<ProxyBidRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'completed'>('pending');
  const [selectedBid, setSelectedBid] = useState<ProxyBidRequest | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [currentBidInput, setCurrentBidInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadBids();
    // Refresh every 30 seconds
    const interval = setInterval(loadBids, 30000);
    return () => clearInterval(interval);
  }, [filter]);

  const loadBids = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('proxy_bid_requests')
        .select(`
          *,
          vehicle:vehicles (
            id, year, make, model, primary_image_url
          ),
          external_listing:external_listings (
            end_date, current_bid
          ),
          assignment:proxy_bid_assignments (
            id, status, assigned_operator_id
          )
        `)
        .order('created_at', { ascending: false });

      if (filter === 'pending') {
        query = query.in('status', ['pending', 'active', 'winning', 'outbid']);
      } else if (filter === 'active') {
        query = query.in('status', ['active', 'winning', 'outbid']);
      } else if (filter === 'completed') {
        query = query.in('status', ['won', 'lost', 'cancelled', 'expired']);
      }

      const { data, error } = await query.limit(100);

      if (error) throw error;

      // Fetch user profiles separately
      const userIds = [...new Set((data || []).map(b => b.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const enrichedBids = (data || []).map(bid => ({
        ...bid,
        user_profile: profileMap.get(bid.user_id) || null,
        assignment: Array.isArray(bid.assignment) ? bid.assignment[0] : bid.assignment,
      }));

      setBids(enrichedBids);
    } catch (err) {
      console.error('Error loading bids:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return '$0';
    return `$${(cents / 100).toLocaleString()}`;
  };

  const formatTimeUntil = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown';
    const end = new Date(dateStr);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'active': return '#3b82f6';
      case 'winning': return '#10b981';
      case 'outbid': return '#ef4444';
      case 'won': return '#059669';
      case 'lost': return '#6b7280';
      case 'cancelled': return '#9ca3af';
      default: return '#6b7280';
    }
  };

  const handleAssignToSelf = async (bid: ProxyBidRequest) => {
    if (!user) return;
    setActionLoading(true);
    try {
      // Check if assignment exists
      if (bid.assignment?.id) {
        await supabase
          .from('proxy_bid_assignments')
          .update({
            assigned_operator_id: user.id,
            status: 'assigned',
            assigned_at: new Date().toISOString(),
          })
          .eq('id', bid.assignment.id);
      } else {
        await supabase
          .from('proxy_bid_assignments')
          .insert({
            proxy_bid_request_id: bid.id,
            assigned_operator_id: user.id,
            status: 'assigned',
            assigned_at: new Date().toISOString(),
            auction_end_time: bid.external_listing?.end_date || null,
          });
      }
      loadBids();
    } catch (err) {
      console.error('Error assigning bid:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartWorking = async (bid: ProxyBidRequest) => {
    if (!bid.assignment?.id) return;
    setActionLoading(true);
    try {
      await supabase
        .from('proxy_bid_assignments')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('id', bid.assignment.id);
      loadBids();
    } catch (err) {
      console.error('Error starting work:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogAction = async (bid: ProxyBidRequest, action: string) => {
    setActionLoading(true);
    try {
      // Get current execution log
      const { data: current } = await supabase
        .from('proxy_bid_requests')
        .select('execution_log')
        .eq('id', bid.id)
        .single();

      const log = current?.execution_log || [];
      log.push({
        action,
        timestamp: new Date().toISOString(),
        operator_id: user?.id,
        note: actionNote,
        current_bid: currentBidInput ? parseInt(currentBidInput) * 100 : null,
      });

      await supabase
        .from('proxy_bid_requests')
        .update({
          execution_log: log,
          current_bid_cents: currentBidInput ? parseInt(currentBidInput) * 100 : bid.current_bid_cents,
        })
        .eq('id', bid.id);

      setActionNote('');
      setCurrentBidInput('');
      loadBids();
    } catch (err) {
      console.error('Error logging action:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkStatus = async (bid: ProxyBidRequest, newStatus: string) => {
    setActionLoading(true);
    try {
      const updateData: Record<string, any> = { status: newStatus };

      if (newStatus === 'won') {
        const finalBidCents = bid.current_bid_cents ?? bid.max_bid_cents;
        const commissionRate = getCommissionRate(finalBidCents);

        updateData.won_at = new Date().toISOString();
        updateData.final_bid_cents = finalBidCents;
        updateData.commission_rate = Number(commissionRate.toFixed(2));
        updateData.commission_cents = finalBidCents ? calculateCommissionCents(finalBidCents) : null;
      }

      await supabase
        .from('proxy_bid_requests')
        .update(updateData)
        .eq('id', bid.id);

      if (bid.assignment?.id) {
        await supabase
          .from('proxy_bid_assignments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', bid.assignment.id);
      }

      loadBids();
      setSelectedBid(null);
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'var(--space-4)' }}>
        {/* Header */}
        <section className="section">
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>Proxy Bid Operations</h1>
                <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Manage and execute proxy bids for users
                </p>
              </div>
              <button
                className="button button-small"
                onClick={loadBids}
                disabled={loading}
                style={{ fontSize: '8pt' }}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['pending', 'active', 'completed', 'all'] as const).map(f => (
                  <button
                    key={f}
                    className={`button button-small ${filter === f ? 'button-primary' : ''}`}
                    onClick={() => setFilter(f)}
                    style={{ fontSize: '8pt' }}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Bid Queue */}
        <section className="section">
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  Loading bids...
                </div>
              ) : bids.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No proxy bids found
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {bids.map(bid => (
                    <div
                      key={bid.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '12px',
                        background: selectedBid?.id === bid.id ? 'var(--accent-dim)' : 'var(--surface)',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedBid(selectedBid?.id === bid.id ? null : bid)}
                    >
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        {/* Vehicle Image */}
                        {bid.vehicle?.primary_image_url && (
                          <img
                            src={bid.vehicle.primary_image_url}
                            alt=""
                            style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        )}

                        {/* Main Info */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                                {bid.vehicle
                                  ? `${bid.vehicle.year} ${bid.vehicle.make} ${bid.vehicle.model}`
                                  : 'Unknown Vehicle'}
                              </div>
                              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                                {PLATFORM_NAMES[bid.platform] || bid.platform} • {bid.user_profile?.username || 'Unknown User'}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div
                                style={{
                                  background: getStatusColor(bid.status),
                                  color: '#fff',
                                  padding: '2px 8px',
                                  borderRadius: '3px',
                                  fontSize: '7pt',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                }}
                              >
                                {bid.status}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '20px', marginTop: '8px', fontSize: '8pt' }}>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Max Bid:</span>{' '}
                              <strong>{formatCurrency(bid.max_bid_cents)}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Current:</span>{' '}
                              <strong>{formatCurrency(bid.current_bid_cents || bid.external_listing?.current_bid ? (bid.external_listing?.current_bid || 0) * 100 : null)}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Ends:</span>{' '}
                              <strong style={{ color: bid.external_listing?.end_date && new Date(bid.external_listing.end_date).getTime() - Date.now() < 60 * 60 * 1000 ? '#ef4444' : 'inherit' }}>
                                {formatTimeUntil(bid.external_listing?.end_date || null)}
                              </strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Strategy:</span>{' '}
                              {bid.bid_strategy === 'snipe_last_minute' ? 'Snipe' : 'Proxy'}
                            </div>
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {!bid.assignment?.assigned_operator_id && (
                            <button
                              className="button button-small button-primary"
                              onClick={(e) => { e.stopPropagation(); handleAssignToSelf(bid); }}
                              disabled={actionLoading}
                              style={{ fontSize: '7pt' }}
                            >
                              Claim
                            </button>
                          )}
                          <a
                            href={bid.external_auction_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button button-small"
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: '7pt', textAlign: 'center' }}
                          >
                            Open Auction
                          </a>
                        </div>
                      </div>

                      {/* Expanded View */}
                      {selectedBid?.id === bid.id && (
                        <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            {/* Actions */}
                            <div>
                              <h4 style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Actions</h4>

                              {bid.assignment?.assigned_operator_id === user?.id && bid.assignment?.status === 'assigned' && (
                                <button
                                  className="button button-small"
                                  onClick={() => handleStartWorking(bid)}
                                  disabled={actionLoading}
                                  style={{ fontSize: '8pt', marginBottom: '8px' }}
                                >
                                  Start Working
                                </button>
                              )}

                              <div style={{ marginBottom: '8px' }}>
                                <label style={{ display: 'block', fontSize: '7pt', marginBottom: '4px' }}>
                                  Current Bid (our bid amount)
                                </label>
                                <input
                                  type="number"
                                  value={currentBidInput}
                                  onChange={(e) => setCurrentBidInput(e.target.value)}
                                  placeholder="Enter amount"
                                  style={{ width: '100%', padding: '6px', fontSize: '8pt', border: '1px solid var(--border)' }}
                                />
                              </div>

                              <div style={{ marginBottom: '8px' }}>
                                <label style={{ display: 'block', fontSize: '7pt', marginBottom: '4px' }}>
                                  Note
                                </label>
                                <textarea
                                  value={actionNote}
                                  onChange={(e) => setActionNote(e.target.value)}
                                  placeholder="Add a note..."
                                  rows={2}
                                  style={{ width: '100%', padding: '6px', fontSize: '8pt', border: '1px solid var(--border)', resize: 'none' }}
                                />
                              </div>

                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button
                                  className="button button-small"
                                  onClick={() => handleLogAction(bid, 'bid_placed')}
                                  disabled={actionLoading}
                                  style={{ fontSize: '7pt' }}
                                >
                                  Log Bid
                                </button>
                                <button
                                  className="button button-small"
                                  onClick={() => handleLogAction(bid, 'bid_increased')}
                                  disabled={actionLoading}
                                  style={{ fontSize: '7pt' }}
                                >
                                  Bid Increased
                                </button>
                                <button
                                  className="button button-small"
                                  onClick={() => handleLogAction(bid, 'outbid')}
                                  disabled={actionLoading}
                                  style={{ fontSize: '7pt' }}
                                >
                                  Outbid
                                </button>
                              </div>

                              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border)' }}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    className="button button-small"
                                    onClick={() => handleMarkStatus(bid, 'won')}
                                    disabled={actionLoading}
                                    style={{ fontSize: '7pt', background: '#059669', color: '#fff' }}
                                  >
                                    Mark Won
                                  </button>
                                  <button
                                    className="button button-small"
                                    onClick={() => handleMarkStatus(bid, 'lost')}
                                    disabled={actionLoading}
                                    style={{ fontSize: '7pt', background: '#6b7280', color: '#fff' }}
                                  >
                                    Mark Lost
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Execution Log */}
                            <div>
                              <h4 style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>Execution Log</h4>
                              <div style={{
                                background: 'var(--surface-hover)',
                                padding: '8px',
                                borderRadius: '4px',
                                maxHeight: '200px',
                                overflowY: 'auto',
                                fontSize: '7pt'
                              }}>
                                {(bid.execution_log as any[] || []).length === 0 ? (
                                  <div style={{ color: 'var(--text-muted)' }}>No actions yet</div>
                                ) : (
                                  (bid.execution_log as any[]).map((entry, i) => (
                                    <div key={i} style={{ marginBottom: '6px', paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
                                      <div style={{ fontWeight: 600 }}>{entry.action}</div>
                                      <div style={{ color: 'var(--text-muted)' }}>
                                        {new Date(entry.timestamp).toLocaleString()}
                                        {entry.current_bid && ` • ${formatCurrency(entry.current_bid)}`}
                                      </div>
                                      {entry.note && <div>{entry.note}</div>}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

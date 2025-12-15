import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

export type ActivityScope = 'org' | 'vehicle' | 'user';

interface ActivityTimelineProps {
  scope: ActivityScope;
  id: string;
  limit?: number;
}

interface OrgEventItem {
  org_id: string;
  event_id: string;
  event_type: string;
  title: string | null;
  description: string | null;
  event_date: string | null;
  created_at: string;
  vehicle_id?: string | null;
  source_table: string;
  metadata?: any;
}

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 6px',
  background: 'var(--bg)',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  textTransform: 'uppercase'
};

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ scope, id, limit = 200 }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgEvents, setOrgEvents] = useState<OrgEventItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (scope === 'org') {
          const { data, error } = await supabase
            .from('organization_activity_view')
            .select('*')
            .eq('org_id', id)
            .order('created_at', { ascending: false })
            .limit(limit);
          if (error) throw error;
          setOrgEvents((data as any[]) || []);
        } else if (scope === 'vehicle') {
          // Placeholder: adapt to your vehicle activity view/table
          const { data, error } = await supabase
            .from('vehicle_timeline_events')
            .select('*')
            .eq('vehicle_id', id)
            .order('created_at', { ascending: false })
            .limit(limit);
          if (error) throw error;
          // Shape not enforced here; show generic rendering
          setOrgEvents(((data as any[]) || []).map((d: any) => ({
            org_id: d.owner_shop_id || '',
            event_id: d.id,
            event_type: d.event_type || 'event',
            title: d.title || d.event_type || 'Event',
            description: d.description || null,
            event_date: d.event_date || d.created_at,
            created_at: d.created_at,
            vehicle_id: d.vehicle_id,
            source_table: 'vehicle_timeline_events',
            metadata: d
          })));
        } else if (scope === 'user') {
          const { data, error } = await supabase
            .from('user_activity_feed')
            .select('*')
            .eq('user_id', id)
            .order('created_at', { ascending: false })
            .limit(limit);
          if (error) throw error;
          setOrgEvents(((data as any[]) || []).map((d: any) => ({
            org_id: d.org_id || '',
            event_id: d.id,
            event_type: d.activity_type || 'activity',
            title: d.title,
            description: d.description,
            event_date: d.created_at,
            created_at: d.created_at,
            vehicle_id: d.vehicle_id,
            source_table: 'user_activity_feed',
            metadata: d
          })));
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
        setOrgEvents([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [scope, id, limit]);

  if (loading) {
    return <div className="card"><div className="card-body text">Loading activity…</div></div>;
  }
  if (error) {
    return <div className="card"><div className="card-body" style={{ color: '#b91c1c' }}>{error}</div></div>;
  }
  if (orgEvents.length === 0) {
    return <div className="card"><div className="card-body text">No activity yet.</div></div>;
  }

  return (
    <div className="space-y-2">
      {orgEvents.map((e) => (
        <div key={`${e.source_table}_${e.event_id}`} className="card">
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="text text-bold" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={badgeStyle}>{(e.event_type || '').replace(/_/g, ' ') || 'event'}</span>
                <span>{e.title || e.event_type}</span>
              </div>
              {e.description && (
                <div className="text text-small text-muted" style={{ marginTop: 4 }}>{e.description}</div>
              )}
              {e.vehicle_id && (
                <div className="text text-small" style={{ marginTop: 6 }}>
                  Vehicle: <a href={`/vehicle/${e.vehicle_id}`}>view profile</a>
                </div>
              )}
            </div>
            <div className="text text-small text-muted" style={{ whiteSpace: 'nowrap' }}>
              {new Date(e.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ActivityTimeline;

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

export type WorkScope = 'org' | 'vehicle';

interface WorkSessionsPanelProps {
  scope: WorkScope;
  id: string; // orgId or vehicleId
  todayOnly?: boolean;
  limit?: number;
}

interface SessionRow {
  id: string;
  vehicle_id: string;
  user_id: string;
  session_date: string; // YYYY-MM-DD
  start_time: string; // ISO
  end_time: string; // ISO
  duration_minutes: number;
  work_description?: string | null;
}

interface VehicleRow {
  id: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const WorkSessionsPanel: React.FC<WorkSessionsPanelProps> = ({ scope, id, todayOnly = true, limit = 10 }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [vehicles, setVehicles] = useState<Record<string, VehicleRow>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [desc, setDesc] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [currentSession, setCurrentSession] = useState<SessionRow | null>(null);

  const todayKey = useMemo(() => new Date().toISOString().split('T')[0], []);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);

      let filteredSessions: SessionRow[] = [];

      if (scope === 'vehicle') {
        const { data, error } = await supabase
          .from('work_sessions')
          .select('*')
          .eq('vehicle_id', id)
          .order('session_date', { ascending: false })
          .limit(100);
        if (error) throw error;
        filteredSessions = (data as SessionRow[]) || [];
      } else {
        // org scope: load vehicles, then sessions for those vehicles
        const { data: v } = await supabase
          .from('vehicles')
          .select('id, make, model, year, vin')
          .eq('owner_shop_id', id)
          .limit(500);
        const vArr = (v as VehicleRow[]) || [];
        const vehicleIds = vArr.map(x => x.id);
        const vMap: Record<string, VehicleRow> = {};
        vArr.forEach(vr => { vMap[vr.id] = vr; });
        setVehicles(vMap);
        if (!selectedVehicleId && vArr.length > 0) setSelectedVehicleId(vArr[0].id);

        if (vehicleIds.length > 0) {
          const { data: s } = await supabase
            .from('work_sessions')
            .select('*')
            .in('vehicle_id', vehicleIds)
            .order('session_date', { ascending: false })
            .limit(200);
          filteredSessions = (s as SessionRow[]) || [];
        } else {
          filteredSessions = [];
        }
      }

      // Filter to today if requested
      if (todayOnly) {
        filteredSessions = filteredSessions.filter(s => s.session_date === todayKey);
      }

      setSessions(filteredSessions.slice(0, limit));
    } catch (e: any) {
      setError(e?.message || 'Failed to load work sessions');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [scope, id, todayOnly, limit]);

  // Load auth user id
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id || null);
    })();
  }, []);

  const totalMinutes = useMemo(() => sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0), [sessions]);
  const totalHours = useMemo(() => Math.round((totalMinutes / 60) * 100) / 100, [totalMinutes]);

  const startSession = async () => {
    try {
      if (!userId) { setError('Sign in to start a session'); return; }
      const vehicleId = scope === 'vehicle' ? id : selectedVehicleId;
      if (!vehicleId) { setError('Select a vehicle'); return; }
      const now = new Date();
      const sessionDate = now.toISOString().split('T')[0];
      const startIso = now.toISOString();
      const row = {
        vehicle_id: vehicleId,
        user_id: userId,
        session_date: sessionDate,
        start_time: startIso,
        end_time: startIso,
        duration_minutes: 0,
        session_type: 'manual' as const,
        confidence_score: 0.9,
        work_description: desc || null
      };
      const { data, error } = await supabase.from('work_sessions').insert(row).select('*').single();
      if (error) throw error;
      setCurrentSession(data as SessionRow);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to start session');
    }
  };

  const stopSession = async () => {
    if (!currentSession) return;
    try {
      const now = new Date();
      const start = new Date(currentSession.start_time);
      const minutes = Math.max(1, Math.round((now.getTime() - start.getTime()) / 60000));
      const { error } = await supabase
        .from('work_sessions')
        .update({ end_time: now.toISOString(), duration_minutes: minutes, work_description: currentSession.work_description || desc || null })
        .eq('id', currentSession.id);
      if (error) throw error;
      setCurrentSession(null);
      setDesc('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to stop session');
    }
  };

  if (loading) return <div className="text text-small text-muted">Loading work sessions…</div>;
  if (error) return <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="card">
        <div className="card-body" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {scope === 'org' && (
            <select className="form-input" value={selectedVehicleId} onChange={e=>setSelectedVehicleId(e.target.value)}>
              <option value="">Select vehicle…</option>
              {Object.values(vehicles).map(v => (
                <option key={v.id} value={v.id}>{`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || v.id}</option>
              ))}
            </select>
          )}
          <input className="form-input" placeholder="Description (optional)" value={desc} onChange={e=>setDesc(e.target.value)} />
          {!currentSession ? (
            <button className="button button-small" onClick={startSession} disabled={!userId}>Start Session</button>
          ) : (
            <>
              <span className="badge">Started {new Date(currentSession.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <button className="button button-small button-secondary" onClick={stopSession}>Stop Session</button>
            </>
          )}
        </div>
      </div>

      <div className="text text-small text-muted">Total: {totalHours}h ({sessions.length} sessions)</div>
      {sessions.map(s => {
        const v = vehicles[s.vehicle_id];
        const vLabel = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() : s.vehicle_id;
        return (
          <div key={s.id} className="card">
            <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div className="text text-small text-bold">{fmtTime(s.start_time)} – {fmtTime(s.end_time)} • {Math.round(s.duration_minutes)} min</div>
                {scope === 'org' && (
                  <div className="text text-small text-muted">{vLabel}</div>
                )}
                {s.work_description && (
                  <div className="text text-small">{s.work_description}</div>
                )}
              </div>
              <div className="badge">{s.session_date}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WorkSessionsPanel;

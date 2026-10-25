import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { PrefetchLink } from '../components/PrefetchLink';
import ImageTrackingBackfill from '../components/ImageTrackingBackfill';
import './DataDiagnostic.css';

type VehicleSummary = { id?: string; year?: string | number; make?: string; model?: string };
const PAGE_SIZE = 100;
const readableVehicles = (value: unknown): VehicleSummary[] => {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Browser vehicle data is not a readable list. The original data is still retained.');
  }
  return value.map(row => ({
    id: typeof row.id === 'string' ? row.id : undefined,
    year: typeof row.year === 'string' || (typeof row.year === 'number' && Number.isFinite(row.year)) ? row.year : undefined,
    make: typeof row.make === 'string' ? row.make : undefined,
    model: typeof row.model === 'string' ? row.model : undefined,
  }));
};
const vehicleLabel = (row: VehicleSummary) => [row.year, row.make, row.model].filter(Boolean).join(' ') || 'Vehicle details not recorded';

export default function DataDiagnostic() {
  usePageTitle('Data diagnostic');
  const { session } = useAuth();
  const viewerId = session?.user?.id as string | undefined;
  return <DiagnosticView key={viewerId || 'visitor'} viewerId={viewerId} />;
}

function DiagnosticView({ viewerId }: { viewerId?: string }) {
  const [localVehicles, setLocalVehicles] = useState<VehicleSummary[] | null>(null);
  const [savedVehicles, setSavedVehicles] = useState<VehicleSummary[] | null>(null);
  const [rawBackup, setRawBackup] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const pending = useRef(false);

  const read = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setLoading(true); setSavedError(null); setLocalError(null); setBackupError(null);
    setLocalVehicles(null); setSavedVehicles(null); setHasMore(false); setRawBackup(null);
    try {
      const raw = localStorage.getItem('anonymousVehicles');
      setRawBackup(raw);
      setLocalVehicles(readableVehicles(raw === null ? [] : JSON.parse(raw)));
    } catch {
      setLocalError('Browser vehicle data could not be read. The original data has not been changed.');
    }
    try {
      if (!viewerId) return;
      const { data, error } = await supabase.from('vehicles').select('id, year, make, model')
        .eq('user_id', viewerId).order('id').limit(PAGE_SIZE + 1);
      if (request !== generation.current) return;
      if (error || !Array.isArray(data)) throw error || new Error('No readable vehicle result was returned.');
      setSavedVehicles(readableVehicles(data.slice(0, PAGE_SIZE))); setHasMore(data.length > PAGE_SIZE);
    } catch {
      if (request === generation.current) setSavedError('Saved vehicles could not be read. Their count is unknown. Refresh to retry.');
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }, [viewerId]);

  useEffect(() => {
    void read();
    return () => { generation.current++; pending.current = false; };
  }, [read]);

  const downloadBackup = () => {
    if (rawBackup === null) return;
    let url: string | undefined;
    try {
      // JSON escaping preserves even lone UTF-16 surrogates that Blob would replace
      // if the retained string were encoded directly as UTF-8.
      const backup = JSON.stringify({ format: 'nuke-browser-vehicles-backup/v1', storage_key: 'anonymousVehicles', value: rawBackup });
      url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'nuke-browser-vehicles-backup.json';
      document.body.append(link); link.click(); link.remove();
      setBackupError(null);
    } catch {
      setBackupError('The backup download could not start. Your browser data is unchanged.');
    } finally {
      if (url) { const completedUrl = url; setTimeout(() => URL.revokeObjectURL(completedUrl), 0); }
    }
  };

  return <article className="data-diagnostic">
    <header><div><h1>Data diagnostic</h1><p>Compare records retained in this browser with the saved vehicles owned by your account.</p></div>
      <button className="button button-primary" disabled={loading} onClick={() => void read()}>{loading ? 'Reading…' : 'Refresh diagnostic'}</button></header>
    <section className="card"><h2>Account</h2><p>{viewerId ? 'Signed in. Saved vehicle reads use your account and its existing access rules.' : 'Sign in to inspect your saved vehicles.'}</p>
      {!viewerId && <PrefetchLink to="/login?returnUrl=%2Fadmin%2Fdata-diagnostic">Sign in</PrefetchLink>}</section>
    <div className="data-diagnostic-columns">
      <section className="card"><h2>Browser records</h2><p>Stored in this browser for this site. This count does not establish whether the records are also saved online.</p>
        {localError && <p role="alert">{localError}</p>}
        {localVehicles !== null && <><p>{localVehicles.length === 0 ? 'No browser vehicle records were returned.' : `${localVehicles.length} retained browser ${localVehicles.length === 1 ? 'record' : 'records'}.`}</p>
          <ul>{localVehicles.slice(0, PAGE_SIZE).map((row, index) => <li key={index}>{vehicleLabel(row)}</li>)}</ul>
          {localVehicles.length > PAGE_SIZE && <p>Showing the first {PAGE_SIZE}. The backup includes the entire retained value.</p>}</>}
        <button className="button" disabled={rawBackup === null} onClick={downloadBackup}>Download browser backup</button>
        {backupError && <p role="alert">{backupError}</p>}
        {rawBackup !== null && <p>The backup stores the original browser value in a recovery envelope. Downloading does not upload, sync, or delete it.</p>}
      </section>
      <section className="card"><h2>Saved vehicles</h2><p>Existing vehicle records whose user ID matches your account. Shared, uploaded, or contributed vehicles can have different ownership links.</p>
        {loading && viewerId && <p role="status">Reading saved vehicles…</p>}
        {savedError && <p role="alert">{savedError}</p>}
        {!viewerId && <p>Count unknown until you sign in.</p>}
        {savedVehicles !== null && <><p>{hasMore ? `Showing the first ${PAGE_SIZE} matching saved vehicles.` : savedVehicles.length ? `${savedVehicles.length} matching saved ${savedVehicles.length === 1 ? 'vehicle' : 'vehicles'} returned.` : 'No saved vehicles matched this account ownership field.'}</p>
          <ul>{savedVehicles.map((row, index) => <li key={row.id || index}>{row.id ? <PrefetchLink to={`/vehicle/${row.id}`}>{vehicleLabel(row)}</PrefetchLink> : vehicleLabel(row)}</li>)}</ul></>}
        <PrefetchLink to="/vehicle/list">Open vehicle list</PrefetchLink>
      </section>
    </div>
    {localVehicles && localVehicles.length > 0 && <section className="card"><h2>Browser recovery</h2><p>Keep a backup before recovery work. The former browser-to-cloud sync screen is unavailable; opening the vehicle list does not import these records.</p></section>}
    {viewerId && <details className="card"><summary>Advanced image repair tools</summary><p>These existing tools can change image tracking and contribution records when explicitly run.</p><ImageTrackingBackfill /></details>}
  </article>;
}

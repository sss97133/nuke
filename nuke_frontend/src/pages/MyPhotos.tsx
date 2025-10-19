import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useMobileCameraCapture } from '../hooks/useMobileCameraCapture';

interface VehicleSummary {
  id: string;
  title: string;
}

interface MyImage {
  id: string;
  image_url: string;
  vehicle_id: string | null;
  taken_at: string | null;
  file_name?: string | null;
}

const MyPhotos: React.FC = () => {
  const { user } = useAuth();
  const [images, setImages] = useState<MyImage[]>([]);
  const [vehiclesById, setVehiclesById] = useState<Map<string, VehicleSummary>>(new Map());
  const [userVehicles, setUserVehicles] = useState<VehicleSummary[]>([]);
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'by_vehicle'>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { processOfflineQueue, captureImages, state: captureState } = useMobileCameraCapture({
    enableOfflineQueue: true,
    autoProcessing: true,
    batchMode: true,
    maxBatchSize: 8
  });

  const offlineCount = useMemo(() => {
    if (!user) return 0;
    try {
      const raw = localStorage.getItem(`offlineQueue_${user.id}`) || '[]';
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.length : 0;
    } catch {
      return 0;
    }
  }, [user, captureState.queuedCount]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Load my images
        const { data: imgs, error: imgErr } = await supabase
          .from('vehicle_images')
          .select('id, image_url, vehicle_id, taken_at, file_name')
          .eq('user_id', user.id)
          .order('taken_at', { ascending: false })
          .limit(500);
        if (imgErr) throw imgErr;
        const imageList = (imgs || []) as any as MyImage[];
        setImages(imageList);

        // Gather vehicle IDs and load titles
        const ids = Array.from(new Set(imageList.map(i => i.vehicle_id).filter(Boolean))) as string[];
        if (ids.length > 0) {
          const { data: vehs, error: vErr } = await supabase
            .from('vehicles')
            .select('id, year, make, model')
            .in('id', ids);
          if (!vErr && vehs) {
            const map = new Map<string, VehicleSummary>();
            vehs.forEach(v => {
              map.set(v.id, { id: v.id, title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle' });
            });
            setVehiclesById(map);
          }
        }

        // Load the user's own vehicles for reassignment
        const { data: myVehicles } = await supabase
          .from('vehicles')
          .select('id, year, make, model')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        const summaries = (myVehicles || []).map(v => ({ id: v.id, title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle' }));
        setUserVehicles(summaries);
      } catch (e: any) {
        setError(e?.message || 'Failed to load photos');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const filteredImages = useMemo(() => {
    if (filter === 'unassigned') return images.filter(i => !i.vehicle_id);
    if (filter === 'by_vehicle' && vehicleFilter) return images.filter(i => i.vehicle_id === vehicleFilter);
    return images;
  }, [images, filter, vehicleFilter]);

  const groupByDate = useMemo(() => {
    const groups = new Map<string, MyImage[]>();
    filteredImages.forEach(img => {
      const key = img.taken_at ? new Date(img.taken_at).toISOString().slice(0, 10) : 'Unknown Date';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(img);
    });
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filteredImages]);

  const reassignImage = useCallback(async (imageId: string, newVehicleId: string) => {
    const { error } = await supabase
      .from('vehicle_images')
      .update({ vehicle_id: newVehicleId })
      .eq('id', imageId);
    if (!error) {
      setImages(prev => prev.map(img => img.id === imageId ? { ...img, vehicle_id: newVehicleId } : img));
    } else {
      alert(`Reassign failed: ${error.message}`);
    }
  }, []);

  const deleteImage = useCallback(async (imageId: string) => {
    if (!confirm('Delete this image?')) return;
    const { error } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('id', imageId);
    if (!error) {
      setImages(prev => prev.filter(i => i.id !== imageId));
    } else {
      alert(`Delete failed: ${error.message}`);
    }
  }, []);

  if (!user) {
    return (
      <div className="container">
        <div className="main">
          <div className="card"><div className="card-body">
            <h2 className="text font-bold">Sign in required</h2>
            <p className="text">Please sign in to view your private photo album.</p>
          </div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="main">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text font-bold">My Photos</h2>
              <div className="flex items-center gap-2">
                <button className="button button-secondary" onClick={() => fileInputRef.current?.click()}>
                  📷 Capture
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment" style={{ display: 'none' }} onChange={e => { if (e.target.files) captureImages(e.target.files); }} />
                {offlineCount > 0 && (
                  <button className="button" onClick={() => processOfflineQueue()}>
                    Process Offline ({offlineCount})
                  </button>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 mb-3">
              <button className={`button ${filter === 'all' ? 'button-primary' : 'button-secondary'}`} onClick={() => setFilter('all')}>All</button>
              <button className={`button ${filter === 'unassigned' ? 'button-primary' : 'button-secondary'}`} onClick={() => setFilter('unassigned')}>Unassigned</button>
              <button className={`button ${filter === 'by_vehicle' ? 'button-primary' : 'button-secondary'}`} onClick={() => setFilter('by_vehicle')}>By Vehicle</button>
              {filter === 'by_vehicle' && (
                <select className="input" value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}>
                  <option value="">Select vehicle</option>
                  {userVehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.title}</option>
                  ))}
                </select>
              )}
            </div>

            {loading && <div className="text">Loading...</div>}
            {error && <div className="text text-danger">{error}</div>}

            {!loading && groupByDate.length === 0 && (
              <div className="text text-muted">No photos yet.</div>
            )}

            {/* Groups by date */}
            <div className="flex flex-col gap-4">
              {groupByDate.map(([date, list]) => (
                <div key={date}>
                  <div className="text text-bold mb-2">{date}</div>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                    {list.map(img => (
                      <div key={img.id} className="border" style={{ position: 'relative' }}>
                        <img src={img.image_url} alt={img.file_name || ''} style={{ width: '100%', height: '100%', aspectRatio: '1/1', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '10px', padding: '2px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>{img.vehicle_id ? (vehiclesById.get(img.vehicle_id)?.title || 'Vehicle') : 'Unassigned'}</span>
                          <div className="flex items-center gap-1">
                            <select
                              className="input"
                              style={{ fontSize: '10px', padding: '2px' }}
                              value={img.vehicle_id || ''}
                              onChange={e => reassignImage(img.id, e.target.value)}
                            >
                              <option value="">Unassigned</option>
                              {userVehicles.map(v => (
                                <option key={v.id} value={v.id}>{v.title}</option>
                              ))}
                            </select>
                            <button className="button button-secondary" style={{ fontSize: '10px', padding: '2px 6px' }} onClick={() => deleteImage(img.id)}>Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyPhotos;

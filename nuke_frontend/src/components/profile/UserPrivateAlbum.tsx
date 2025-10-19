import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ImageUploadService } from '../../services/imageUploadService';

interface UserPrivateAlbumProps {
  userId: string;
  isOwnProfile: boolean;
}

type QueuedItem = {
  id: string;
  timestamp: string;
  fileName: string;
  base64Data: string;
  aiResult?: any;
  context?: any;
};

type UserImage = {
  id: string;
  image_url: string;
  vehicle_id: string | null;
  taken_at: string | null;
  created_at: string;
  vehicle?: { id: string; year?: number; make?: string; model?: string } | null;
};

const UserPrivateAlbum: React.FC<UserPrivateAlbumProps> = ({ userId, isOwnProfile }) => {
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  const [images, setImages] = useState<UserImage[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; display: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filterVehicle, setFilterVehicle] = useState<string>('');

  const queueKey = useMemo(() => `offlineQueue_${userId}`, [userId]);

  useEffect(() => {
    // Load offline queue from localStorage
    try {
      const raw = localStorage.getItem(queueKey);
      const list: QueuedItem[] = raw ? JSON.parse(raw) : [];
      setQueued(list);
    } catch {}
  }, [queueKey]);

  useEffect(() => {
    // Load user's uploaded images (private to the user via RLS)
    const load = async () => {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, taken_at, created_at, vehicles:vehicle_id(id, year, make, model)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        const mapped = data.map((r: any) => ({
          id: r.id,
          image_url: r.image_url,
          vehicle_id: r.vehicle_id,
          taken_at: r.taken_at,
          created_at: r.created_at,
          vehicle: r.vehicles ? { id: r.vehicles.id, year: r.vehicles.year, make: r.vehicles.make, model: r.vehicles.model } : null
        }));
        setImages(mapped);
      }
    };
    load();
  }, [userId]);

  useEffect(() => {
    // Load user's vehicles for quick assignment
    const loadVehicles = async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        setVehicles(
          (data || []).map((v: any) => ({ id: v.id, display: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() }))
        );
      }
    };
    loadVehicles();
  }, [userId]);

  const clearQueue = () => {
    localStorage.setItem(queueKey, JSON.stringify([]));
    setQueued([]);
  };

  const retryUploadQueued = async () => {
    if (!isOwnProfile) return;
    if (queued.length === 0) return;
    setUploading(true);
    try {
      const processed: string[] = [];
      for (const item of queued) {
        try {
          const resp = await fetch(item.base64Data);
          const blob = await resp.blob();
          const file = new File([blob], item.fileName, { type: blob.type });

          // Try to pick a vehicle: last viewed, or leave for later
          const lastVehicle = localStorage.getItem(`lastVehicle_${userId}`);
          const vehicleId = lastVehicle || null;
          if (!vehicleId) continue; // keep in queue if no context yet

          const result = await ImageUploadService.uploadImage(vehicleId, file, 'general');
          if (result.success) {
            processed.push(item.id);
          }
        } catch {}
      }
      const remaining = queued.filter(q => !processed.includes(q.id));
      localStorage.setItem(queueKey, JSON.stringify(remaining));
      setQueued(remaining);
    } finally {
      setUploading(false);
    }
  };

  const assignImageToVehicle = async (imageId: string, vehicleId: string) => {
    // Move existing image record to selected vehicle
    const { error } = await supabase
      .from('vehicle_images')
      .update({ vehicle_id: vehicleId })
      .eq('id', imageId);
    if (!error) {
      setImages(prev => prev.map(img => (img.id === imageId ? { ...img, vehicle_id: vehicleId } : img)));
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } }));
    }
  };

  const filteredImages = images.filter(img => (filterVehicle ? img.vehicle_id === filterVehicle : true));

  return (
    <div>
      {isOwnProfile && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button className="button button-secondary" onClick={retryUploadQueued} disabled={uploading || queued.length === 0}>
            {uploading ? 'Uploading...' : `Upload Offline Queue (${queued.length})`}
          </button>
          <button className="button button-tertiary" onClick={clearQueue} disabled={queued.length === 0}>
            Clear Offline Queue
          </button>
          <div style={{ marginLeft: 'auto' }}>
            <select className="form-input" value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)}>
              <option value="">All Vehicles</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.display || v.id}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {filteredImages.map(img => (
          <div key={img.id} style={{ position: 'relative', border: '1px solid var(--border-light)', background: '#fff' }}>
            <img src={img.image_url} style={{ width: '100%', height: 120, objectFit: 'cover' }} alt="" />
            <div style={{ padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="text-xs text-muted">
                {img.taken_at ? new Date(img.taken_at).toLocaleDateString() : new Date(img.created_at).toLocaleDateString()}
              </div>
            </div>
            {isOwnProfile && (
              <div style={{ padding: 6 }}>
                <select
                  className="form-input text-small"
                  value={img.vehicle_id || ''}
                  onChange={(e) => assignImageToVehicle(img.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.display || v.id}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
        {filteredImages.length === 0 && (
          <div className="text-small text-muted" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 16 }}>
            No photos yet.
          </div>
        )}
      </div>

      {/* Offline queue preview */}
      {isOwnProfile && queued.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">Offline Queue Preview</div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {queued.slice(0, 6).map(item => (
              <div key={item.id} style={{ border: '1px solid var(--border-light)', background: '#fff' }}>
                <img src={item.base64Data} style={{ width: '100%', height: 100, objectFit: 'cover' }} alt="queued" />
                <div className="text-2xs text-muted" style={{ padding: 6 }}>{new Date(item.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserPrivateAlbum;

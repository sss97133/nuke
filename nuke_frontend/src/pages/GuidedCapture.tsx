import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import { uploadQueue } from '../services/globalUploadQueue';
import EnhancedImageTagger from '../components/image/EnhancedImageTagger';

interface VehicleOption {
  id: string;
  displayName: string;
}

interface VehicleImage {
  id: string;
  image_url: string;
  created_at?: string;
}

const GuidedCapture: React.FC = () => {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [selectedVehicleName, setSelectedVehicleName] = useState<string>('');
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);

  // Load user's vehicles
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false });
      if (!error && data) {
        setVehicles(
          data.map((v: any) => ({
            id: v.id,
            displayName: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || v.id
          }))
        );
      }
    })();
  }, []);

  // Subscribe to upload queue to refresh images after uploads complete
  useEffect(() => {
    const unsubscribe = uploadQueue.subscribe(() => {
      setQueueVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);

  // Load recent images for the selected vehicle
  useEffect(() => {
    if (!selectedVehicleId) return;
    loadRecentImages(selectedVehicleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, queueVersion]);

  const loadRecentImages = async (vehicleId: string) => {
    setLoadingImages(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(48);
      if (!error && data) {
        setImages(data as VehicleImage[]);
      }
    } finally {
      setLoadingImages(false);
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedVehicleId) return;
    const selected = vehicles.find(v => v.id === selectedVehicleId);
    const name = selected?.displayName || 'Vehicle';
    uploadQueue.addFiles(selectedVehicleId, name, Array.from(files));
  };

  const analyzeTagWeb = async () => {
    if (!selectedVehicleId) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-tags', {
        body: { vehicle_id: selectedVehicleId }
      });
      if (!error) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  };

  const optimizeTraining = async () => {
    if (!selectedVehicleId) return;
    setOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('optimize-rekognition-training', {
        body: { vehicle_id: selectedVehicleId, system_focus: 'general', optimization_goal: 'automotive_focus' }
      });
      if (!error) setAnalysis(data);
    } finally {
      setOptimizing(false);
    }
  };

  const selectedVehicle = useMemo(
    () => vehicles.find(v => v.id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );

  useEffect(() => {
    setSelectedVehicleName(selectedVehicle?.displayName || '');
  }, [selectedVehicle]);

  return (
    <AppLayout title="Guided Capture" showBackButton={true}>
      <div className="container">
        {/* Vehicle selector */}
        <section className="section">
          <div className="card">
            <div className="card-header">Select Vehicle</div>
            <div className="card-body">
              <div className="flex items-center gap-2">
                <select
                  className="form-select"
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                >
                  <option value="">Choose a vehicle...</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.displayName}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Capture/Upload */}
        <section className="section">
          <div className="card">
            <div className="card-header">Capture or Upload Photos</div>
            <div className="card-body">
              <div className="flex flex-col md:flex-row gap-4 items-start">
                <label className="cursor-pointer inline-flex flex-col items-center justify-center border-2 border-dashed rounded p-6 w-full md:w-1/2 text-sm text-muted">
                  <span className="mb-2 font-medium">Tap to open camera or photo library</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                  />
                </label>
                <div className="text-xs text-muted md:w-1/2">
                  <div className="mb-2">Tips:</div>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Walk around and capture each area once: exterior, wheels, engine bay, interior.</li>
                    <li>AI runs after each upload; review and correct tags below.</li>
                    <li>Sessions are auto-detected from timestamps; timeline events are created.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Recent images and review */}
        {selectedVehicleId && (
          <section className="section">
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <span>Review AI Tags for {selectedVehicleName || 'Vehicle'}</span>
                <div className="flex gap-2">
                  <button className="button button-small" onClick={analyzeTagWeb} disabled={analyzing}>
                    {analyzing ? 'Analyzing…' : 'Analyze Tag Web'}
                  </button>
                  <button className="button button-small button-secondary" onClick={optimizeTraining} disabled={optimizing}>
                    {optimizing ? 'Optimizing…' : 'Optimize Training'}
                  </button>
                </div>
              </div>
              <div className="card-body">
                {loadingImages ? (
                  <div className="text-small text-muted">Loading images…</div>
                ) : images.length === 0 ? (
                  <div className="text-small text-muted">No photos yet. Upload to begin.</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {images.map(img => (
                      <button
                        key={img.id}
                        className="rounded overflow-hidden border hover:border-primary"
                        onClick={() => setSelectedImageUrl(img.image_url)}
                        title={img.created_at || ''}
                      >
                        <img src={img.image_url} alt="Vehicle" style={{ width: '100%', height: 120, objectFit: 'cover' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Tagger modal */}
        {selectedImageUrl && selectedVehicleId && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg max-w-4xl w-full mx-2">
              <div className="p-2 flex items-center justify-between border-b">
                <div className="text-sm font-medium">AI Review</div>
                <button className="text-xs" onClick={() => setSelectedImageUrl(null)}>Close</button>
              </div>
              <div className="p-2">
                <EnhancedImageTagger imageUrl={selectedImageUrl} vehicleId={selectedVehicleId} onTagsUpdate={() => { /* no-op */ }} />
              </div>
            </div>
          </div>
        )}

        {/* Insights panel */}
        {analysis && (
          <section className="section">
            <div className="card">
              <div className="card-header">Insights</div>
              <div className="card-body text-small">
                <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(analysis, null, 2)}</pre>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
};

export default GuidedCapture;

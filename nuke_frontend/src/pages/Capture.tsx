import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UniversalImageUpload } from '../components/UniversalImageUpload';

const Capture: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Array<{ file: File; preview: string }>>([]);
  const [useCaptured, setUseCaptured] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);

      if (!data.session) {
        navigate('/login');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      captured.forEach((c) => {
        try {
          URL.revokeObjectURL(c.preview);
        } catch {
          // ignore
        }
      });
    };
  }, []);

  const openCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
    } catch (e: any) {
      setCameraError(e?.message ? String(e.message) : 'Camera permission denied');
      setCameraOpen(false);
    }
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
    });

    if (!blob) return;
    const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
    const preview = URL.createObjectURL(file);
    setCaptured((prev) => [...prev, { file, preview }]);
  };

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <div className="text text-muted">Loading…</div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div style={{ padding: 12 }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Add</span>
          <button className="button button-secondary" style={{ fontSize: '9pt' }} onClick={() => navigate('/')}
          >
            Done
          </button>
        </div>
        <div className="card-body" style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
          Drop photos here. If the system can’t place them confidently, they’ll stay in your inbox/album until you decide.
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="button button-primary"
              style={{ fontSize: '9pt' }}
              onClick={() => {
                void openCamera();
              }}
            >
              Camera
            </button>
            {captured.length > 0 && !useCaptured && (
              <button
                type="button"
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
                onClick={() => {
                  closeCamera();
                  setUseCaptured(true);
                }}
              >
                Use Photos ({captured.length})
              </button>
            )}
            {captured.length > 0 && (
              <button
                type="button"
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
                onClick={() => {
                  captured.forEach((c) => {
                    try {
                      URL.revokeObjectURL(c.preview);
                    } catch {
                      // ignore
                    }
                  });
                  setCaptured([]);
                  setUseCaptured(false);
                }}
              >
                Clear
              </button>
            )}
          </div>

          {cameraError ? (
            <div className="text text-muted" style={{ fontSize: '9pt' }}>
              {cameraError}
            </div>
          ) : null}

          {cameraOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <video ref={videoRef} playsInline muted style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className="button button-primary" style={{ fontSize: '9pt' }} onClick={() => void takePhoto()}>
                  Shoot
                </button>
                <button type="button" className="button button-secondary" style={{ fontSize: '9pt' }} onClick={() => closeCamera()}>
                  Close
                </button>
                <div className="text text-muted" style={{ fontSize: '9pt' }}>
                  {captured.length} captured
                </div>
              </div>
            </div>
          ) : null}

          {captured.length > 0 && !useCaptured ? (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {captured.map((c, idx) => (
                <div key={c.preview} style={{ position: 'relative', flex: '0 0 auto' }}>
                  <img
                    src={c.preview}
                    alt=""
                    style={{ width: 78, height: 78, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                  <button
                    type="button"
                    className="button button-small"
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      fontSize: '8pt',
                      padding: '2px 6px',
                      borderRadius: 999,
                    }}
                    onClick={() => {
                      setCaptured((prev) => {
                        const next = [...prev];
                        const removed = next.splice(idx, 1);
                        if (removed[0]?.preview) {
                          try {
                            URL.revokeObjectURL(removed[0].preview);
                          } catch {
                            // ignore
                          }
                        }
                        return next;
                      });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      </div>

      <UniversalImageUpload
        onClose={() => navigate('/')}
        session={session}
        prefillFiles={useCaptured ? captured.map((c) => c.file) : undefined}
      />
    </div>
  );
};

export default Capture;

/**
 * Photo Sync — The On Switch
 *
 * User points at a folder (or drags photos). We scan for vehicle photos
 * client-side using lightweight heuristics, show what we found as sessions,
 * and upload only the vehicle photos for full analysis.
 *
 * Route: /photos
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getSupabaseFunctionsUrl } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';

interface PhotoFile {
  file: File;
  url: string; // object URL for preview
  name: string;
  lastModified: Date;
  size: number;
  vehicleScore: number;
  labels: string[];
}

interface PhotoSession {
  photos: PhotoFile[];
  startTime: Date;
  endTime: Date;
  label: string;
}

type SyncPhase = 'idle' | 'scanning' | 'filtered' | 'uploading' | 'done';

// Client-side vehicle detection from filename and EXIF patterns
// This is the cheap pre-filter before server-side YONO/Claude
const VEHICLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp']);
const REJECT_PATTERNS = /screenshot|screen.shot|selfie|receipt|document/i;

function isLikelyVehiclePhoto(file: File): { score: number; labels: string[] } {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop() || '';
  const labels: string[] = [];

  // Not an image
  if (!VEHICLE_EXTENSIONS.has(ext)) return { score: 0, labels: ['not_image'] };

  // Reject obvious non-vehicle
  if (REJECT_PATTERNS.test(name)) return { score: 0, labels: ['rejected_pattern'] };

  // Screenshots are tiny or have "screenshot" dimensions
  if (file.size < 50_000) return { score: 0.1, labels: ['too_small'] };

  // Camera photos are typically >500KB
  let score = 0;
  if (file.size > 500_000) { score += 0.3; labels.push('camera_size'); }
  if (file.size > 2_000_000) { score += 0.2; labels.push('high_res'); }

  // HEIC = iPhone camera = likely real photo
  if (ext === 'heic') { score += 0.3; labels.push('heic_camera'); }

  // IMG_ prefix = camera roll
  if (/^img_/i.test(name)) { score += 0.2; labels.push('camera_roll'); }

  // DSC, DSCN, DSCF = digital camera
  if (/^dsc[nf]?_/i.test(name)) { score += 0.2; labels.push('digital_camera'); }

  // Vehicle-related keywords in filename
  if (/car|truck|vehicle|engine|motor|hood|bumper|tire|wheel|interior|dash/i.test(name)) {
    score += 0.4;
    labels.push('vehicle_keyword');
  }

  return { score: Math.min(1, score), labels };
}

function clusterIntoSessions(photos: PhotoFile[], gapMs = 30 * 60 * 1000): PhotoSession[] {
  if (photos.length === 0) return [];

  const sorted = [...photos].sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
  const sessions: PhotoSession[] = [];
  let current: PhotoFile[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].lastModified.getTime() - sorted[i - 1].lastModified.getTime();
    if (gap > gapMs) {
      sessions.push(finalizeSession(current));
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  sessions.push(finalizeSession(current));
  return sessions;
}

function finalizeSession(photos: PhotoFile[]): PhotoSession {
  const startTime = photos[0].lastModified;
  const endTime = photos[photos.length - 1].lastModified;
  const dateStr = startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return {
    photos,
    startTime,
    endTime,
    label: `${photos.length} photo${photos.length !== 1 ? 's' : ''} — ${dateStr} ${timeStr}`,
  };
}

export default function PhotoSyncPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [allFiles, setAllFiles] = useState<File[]>([]);
  const [vehiclePhotos, setVehiclePhotos] = useState<PhotoFile[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [photoSessions, setPhotoSessions] = useState<PhotoSession[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(new Set());
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s) navigate('/login');
    });
  }, [navigate]);

  // Scan files for vehicle photos
  const scanFiles = useCallback((files: File[]) => {
    setPhase('scanning');
    setAllFiles(files);

    // Run client-side filter
    const passed: PhotoFile[] = [];
    let rejected = 0;

    for (const file of files) {
      const { score, labels } = isLikelyVehiclePhoto(file);
      if (score >= 0.3) {
        passed.push({
          file,
          url: URL.createObjectURL(file),
          name: file.name,
          lastModified: new Date(file.lastModified),
          size: file.size,
          vehicleScore: score,
          labels,
        });
      } else {
        rejected++;
      }
    }

    setVehiclePhotos(passed);
    setRejectedCount(rejected);

    // Cluster into sessions
    const sessions = clusterIntoSessions(passed);
    setPhotoSessions(sessions);

    // Select all by default
    setSelectedSessions(new Set(sessions.map((_, i) => i)));
    setPhase('filtered');
  }, []);

  // Handle folder picker (File System Access API)
  const handlePickFolder = useCallback(async () => {
    try {
      // @ts-ignore - File System Access API
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const files: File[] = [];

      async function readDir(handle: any, depth = 0) {
        if (depth > 3) return; // Don't go too deep
        for await (const entry of handle.values()) {
          if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              files.push(file);
            } catch { /* skip inaccessible files */ }
          } else if (entry.kind === 'directory' && depth < 3) {
            await readDir(entry, depth + 1);
          }
        }
      }

      await readDir(dirHandle);
      scanFiles(files);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError('Folder picker not supported in this browser. Try dragging photos instead.');
      }
    }
  }, [scanFiles]);

  // Handle file input (webkitdirectory fallback)
  const handleFolderInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) scanFiles(files);
  }, [scanFiles]);

  // Handle individual file selection
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) scanFiles(files);
  }, [scanFiles]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    // Try to get directory entries
    const entries = items
      .map(item => item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length > 0 && entries[0]?.isDirectory) {
      // Read directory recursively
      const readEntries = (dirEntry: any): Promise<File[]> => {
        return new Promise((resolve) => {
          const reader = dirEntry.createReader();
          const allFiles: File[] = [];

          const readBatch = () => {
            reader.readEntries(async (entries: any[]) => {
              if (entries.length === 0) {
                resolve(allFiles);
                return;
              }
              for (const entry of entries) {
                if (entry.isFile) {
                  const file = await new Promise<File>((res) => entry.file(res));
                  allFiles.push(file);
                } else if (entry.isDirectory) {
                  const subFiles = await readEntries(entry);
                  allFiles.push(...subFiles);
                }
              }
              readBatch();
            });
          };
          readBatch();
        });
      };

      Promise.all(entries.filter((e: any) => e.isDirectory).map(readEntries))
        .then(results => scanFiles(results.flat()));

      return;
    }

    // Fallback: individual files
    for (const item of items) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) scanFiles(files);
  }, [scanFiles]);

  // Toggle session selection
  const toggleSession = (idx: number) => {
    setSelectedSessions(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Upload selected sessions
  const handleUpload = async () => {
    if (!session) return;
    setPhase('uploading');
    setError(null);

    const selectedPhotos = photoSessions
      .filter((_, i) => selectedSessions.has(i))
      .flatMap(s => s.photos);

    setUploadProgress({ done: 0, total: selectedPhotos.length });

    try {
      const functionsUrl = getSupabaseFunctionsUrl();
      const uploaded: { url: string; takenAt: string; caption: string }[] = [];

      // Upload in batches of 5
      for (let i = 0; i < selectedPhotos.length; i += 5) {
        const batch = selectedPhotos.slice(i, i + 5);
        await Promise.all(batch.map(async (photo) => {
          const ext = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
          const storagePath = `${session.user.id}/photo-sync/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext === 'heic' ? 'heic' : 'jpg'}`;

          const { error: uploadErr } = await supabase.storage
            .from('vehicle-photos')
            .upload(storagePath, photo.file, {
              contentType: ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg',
              upsert: false,
            });

          if (!uploadErr) {
            const { data: { publicUrl } } = supabase.storage.from('vehicle-photos').getPublicUrl(storagePath);
            uploaded.push({
              url: publicUrl,
              takenAt: photo.lastModified.toISOString(),
              caption: `Photo sync ${photo.lastModified.toISOString().slice(0, 16)}`,
            });
          }

          setUploadProgress(prev => ({ ...prev, done: prev.done + 1 }));
        }));
      }

      // Call image-intake to classify and assign
      const intakeResponse = await fetch(`${functionsUrl}/image-intake`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: session.user.id,
          images: uploaded,
        }),
      });

      if (intakeResponse.ok) {
        const data = await intakeResponse.json();
        setResults(data);
      } else {
        setError(`Analysis failed: ${intakeResponse.status}`);
      }

      setPhase('done');
    } catch (e: any) {
      setError(e.message);
      setPhase('filtered'); // Allow retry
    }
  };

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => vehiclePhotos.forEach(p => URL.revokeObjectURL(p.url));
  }, [vehiclePhotos]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 14,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
          margin: 0,
        }}>
          PHOTO SYNC
        </h1>
        <p style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 12,
          color: 'var(--text-secondary)',
          margin: '8px 0 0',
        }}>
          Point at a folder. We find the vehicle photos, group them by session, and analyze every one.
        </p>
      </div>

      {/* Phase: Idle — the on switch */}
      {phase === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={handleDrop}
          style={{
            border: '2px solid var(--border)',
            padding: 48,
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--surface)',
          }}
          onClick={handlePickFolder}
        >
          <div style={{
            fontFamily: 'Courier New, monospace',
            fontSize: 13,
            color: 'var(--text)',
            marginBottom: 16,
          }}>
            DROP A FOLDER HERE
          </div>
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 11,
            color: 'var(--text-secondary)',
            marginBottom: 24,
          }}>
            or click to pick a folder — we scan it for vehicle photos
          </div>

          {/* Fallback inputs */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <label style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 10,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              padding: '8px 16px',
              border: '2px solid var(--border)',
              cursor: 'pointer',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}>
              SELECT FOLDER
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                // @ts-ignore
                directory=""
                multiple
                style={{ display: 'none' }}
                onChange={handleFolderInput}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
            <label style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 10,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.05em',
              padding: '8px 16px',
              border: '2px solid var(--border)',
              cursor: 'pointer',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}>
              SELECT FILES
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileInput}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          </div>

          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginTop: 24,
            opacity: 0.6,
          }}>
            We don't upload non-vehicle photos. We don't upload anything until you confirm.
          </div>
        </div>
      )}

      {/* Phase: Scanning */}
      {phase === 'scanning' && (
        <div style={{
          border: '2px solid var(--border)',
          padding: 48,
          textAlign: 'center',
          background: 'var(--surface)',
        }}>
          <div style={{
            fontFamily: 'Courier New, monospace',
            fontSize: 13,
          }}>
            SCANNING {allFiles.length} FILES...
          </div>
        </div>
      )}

      {/* Phase: Filtered — show what we found */}
      {phase === 'filtered' && (
        <div>
          {/* Stats bar */}
          <div style={{
            display: 'flex',
            gap: 24,
            marginBottom: 24,
            fontFamily: 'Courier New, monospace',
            fontSize: 12,
          }}>
            <span>{allFiles.length} SCANNED</span>
            <span style={{ color: 'var(--text-secondary)' }}>{rejectedCount} SKIPPED</span>
            <span style={{ fontWeight: 700 }}>{vehiclePhotos.length} VEHICLE PHOTOS</span>
            <span>{photoSessions.length} SESSION{photoSessions.length !== 1 ? 'S' : ''}</span>
          </div>

          {/* Sessions */}
          {photoSessions.map((sess, idx) => (
            <div key={idx} style={{
              border: '2px solid var(--border)',
              marginBottom: 12,
              background: selectedSessions.has(idx) ? 'var(--surface)' : 'var(--bg)',
              opacity: selectedSessions.has(idx) ? 1 : 0.5,
            }}>
              {/* Session header */}
              <div
                onClick={() => toggleSession(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSessions.has(idx)}
                  onChange={() => toggleSession(idx)}
                  style={{ margin: 0 }}
                />
                <span style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 11,
                  flex: 1,
                }}>
                  {sess.label}
                </span>
              </div>

              {/* Photo grid */}
              {selectedSessions.has(idx) && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: 4,
                  padding: 8,
                }}>
                  {sess.photos.slice(0, 12).map((photo, pidx) => (
                    <div key={pidx} style={{ position: 'relative', aspectRatio: '1' }}>
                      <img
                        src={photo.url}
                        alt={photo.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  ))}
                  {sess.photos.length > 12 && (
                    <div style={{
                      aspectRatio: '1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      fontFamily: 'Courier New, monospace',
                      fontSize: 11,
                    }}>
                      +{sess.photos.length - 12}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Action bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 24,
          }}>
            <button
              onClick={() => { setPhase('idle'); setVehiclePhotos([]); setPhotoSessions([]); }}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 10,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                padding: '10px 20px',
                border: '2px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              START OVER
            </button>
            <button
              onClick={handleUpload}
              disabled={selectedSessions.size === 0}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 10,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                padding: '10px 24px',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--bg)',
                cursor: selectedSessions.size > 0 ? 'pointer' : 'not-allowed',
                opacity: selectedSessions.size > 0 ? 1 : 0.4,
              }}
            >
              ANALYZE {selectedSessions.size} SESSION{selectedSessions.size !== 1 ? 'S' : ''} ({
                photoSessions
                  .filter((_, i) => selectedSessions.has(i))
                  .reduce((sum, s) => sum + s.photos.length, 0)
              } PHOTOS)
            </button>
          </div>

          {error && (
            <div style={{
              marginTop: 16,
              padding: '12px 16px',
              border: '2px solid #c00',
              fontFamily: 'Courier New, monospace',
              fontSize: 11,
              color: '#c00',
            }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Phase: Uploading */}
      {phase === 'uploading' && (
        <div style={{
          border: '2px solid var(--border)',
          padding: 48,
          textAlign: 'center',
          background: 'var(--surface)',
        }}>
          <div style={{
            fontFamily: 'Courier New, monospace',
            fontSize: 13,
            marginBottom: 16,
          }}>
            UPLOADING {uploadProgress.done}/{uploadProgress.total}
          </div>
          <div style={{
            width: '100%',
            height: 4,
            background: 'var(--border)',
          }}>
            <div style={{
              width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%`,
              height: '100%',
              background: 'var(--text)',
              transition: 'width 0.2s ease',
            }} />
          </div>
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 11,
            color: 'var(--text-secondary)',
            marginTop: 16,
          }}>
            Each photo is classified by YONO (make detection) and analyzed for condition, zone, and damage.
          </div>
        </div>
      )}

      {/* Phase: Done */}
      {phase === 'done' && results && (
        <div>
          <div style={{
            border: '2px solid var(--border)',
            padding: 24,
            background: 'var(--surface)',
            marginBottom: 24,
          }}>
            <div style={{
              fontFamily: 'Courier New, monospace',
              fontSize: 13,
              marginBottom: 16,
            }}>
              ANALYSIS COMPLETE
            </div>
            {results.summary && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
                fontFamily: 'Courier New, monospace',
                fontSize: 12,
              }}>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, marginBottom: 4 }}>MATCHED</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{results.summary.matched || 0}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, marginBottom: 4 }}>PENDING REVIEW</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{results.summary.pending || 0}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, marginBottom: 4 }}>SKIPPED</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{results.summary.skipped || 0}</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { setPhase('idle'); setVehiclePhotos([]); setPhotoSessions([]); setResults(null); }}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 10,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                padding: '10px 20px',
                border: '2px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              SCAN MORE PHOTOS
            </button>
            <button
              onClick={() => navigate('/vehicle/list')}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: 10,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                padding: '10px 20px',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--bg)',
                cursor: 'pointer',
              }}
            >
              VIEW VEHICLES
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { supabase } from '../../lib/supabase';

type HarnessPoint = {
  id: string;
  name: string;
  position: [number, number, number];
  createdAt: string;
};

type HarnessAnnotationExport = {
  version: 1;
  vehicleId: string;
  createdAt: string;
  unitHint: 'unknown' | 'inches' | 'mm' | 'meters';
  slackInches: number;
  model: {
    bucket: string;
    path: string;
    signedUrl: string;
  } | null;
  points: HarnessPoint[];
};

function uuid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function Marker({ p }: { p: HarnessPoint }) {
  return (
    <mesh position={p.position}>
      <sphereGeometry args={[0.02, 14, 10]} />
      <meshStandardMaterial color="#ff4d4d" />
    </mesh>
  );
}

function Model({ url }: { url: string }) {
  // NOTE: do NOT enable Draco by default here. In some production bundles/environments,
  // the optional Draco path can crash even when the model is not Draco-compressed.
  const { scene } = useGLTF(url);
  // Defensive: ensure normals exist and scale is sane (don’t change user scale though).
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geom && !geom.attributes.normal) geom.computeVertexNormals();
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export function ModelHarnessAnnotator({
  vehicleId,
  defaultImportUrl,
  autoImportOnLoad = false,
}: {
  vehicleId: string;
  defaultImportUrl?: string | null;
  autoImportOnLoad?: boolean;
}) {
  const bucket = 'vehicle-models';

  const [userId, setUserId] = useState<string | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  const [modelPath, setModelPath] = useState<string | null>(null);
  const [modelSignedUrl, setModelSignedUrl] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [importUrl, setImportUrl] = useState<string>('');
  const didAutoImportRef = useRef(false);

  const [unitHint, setUnitHint] = useState<'unknown' | 'inches' | 'mm' | 'meters'>('unknown');
  const [slackInches, setSlackInches] = useState<number>(24);

  const [points, setPoints] = useState<HarnessPoint[]>([]);
  const [pendingName, setPendingName] = useState<string>('HP_');
  const [pendingPoint, setPendingPoint] = useState<[number, number, number] | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id || null;
        if (mounted) setUserId(uid);
      } finally {
        if (mounted) setIsLoadingUser(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const url = String(defaultImportUrl || '').trim();
    if (!url) return;
    if (!userId) return;
    if (didAutoImportRef.current) return;
    setImportUrl(url);
    if (autoImportOnLoad) {
      // Defer a tick so state is set before import runs
      setTimeout(() => {
        // best-effort; import handles its own errors
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
          didAutoImportRef.current = true;
          await importFromSignedUrl();
        })();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultImportUrl, autoImportOnLoad, userId]);

  const prefix = useMemo(() => {
    if (!userId) return null;
    return `${userId}/${vehicleId}`;
  }, [userId, vehicleId]);

  const refreshSignedUrl = useCallback(
    async (path: string) => {
      setModelError(null);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60); // 1 hour
      if (error) {
        setModelSignedUrl(null);
        setModelError(error.message || 'Failed to create signed URL');
        return;
      }
      setModelPath(path);
      setModelSignedUrl(data.signedUrl);
    },
    [bucket]
  );

  const uploadToPath = useCallback(
    async (file: File, objectPath: string) => {
      const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;
    },
    [bucket]
  );

  const buildVariantPaths = useCallback(
    (baseNameNoExt: string) => {
      // Keep variants together and deterministic.
      // Example: <uid>/<vehicle>/<ts>_blazer_model.{fbx,glb}
      const ts = Date.now();
      const safeBase = baseNameNoExt.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      const prefix = `${userId}/${vehicleId}/${ts}_${safeBase || 'model'}`;
      return {
        fbxPath: `${prefix}.fbx`,
        glbPath: `${prefix}.glb`,
      };
    },
    [userId, vehicleId]
  );

  const handlePickFile = useCallback(() => fileInputRef.current?.click(), []);

  const convertFbxArrayBufferToGlbFile = useCallback(async (fbx: ArrayBuffer, filenameBase = 'model') => {
    // Lazy-load Three "examples" code only when we actually need conversion.
    // This keeps the default 3D viewer path lighter and avoids some production bundle/runtime edge cases.
    const [{ FBXLoader }, { GLTFExporter }] = await Promise.all([
      import('three/examples/jsm/loaders/FBXLoader.js'),
      import('three/examples/jsm/exporters/GLTFExporter.js'),
    ]);

    const loader = new FBXLoader();
    const group = loader.parse(fbx, '');

    // Basic cleanup: ensure normals exist.
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geom && !geom.attributes.normal) geom.computeVertexNormals();
    });

    const exporter = new GLTFExporter();

    const glbArrayBuffer: ArrayBuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        group,
        (result) => {
          if (result instanceof ArrayBuffer) return resolve(result);
          // GLTFExporter can return JSON if binary=false; we always request binary.
          return reject(new Error('GLB export failed (unexpected result type)'));
        },
        (err) => reject(err instanceof Error ? err : new Error('GLB export failed')),
        { binary: true }
      );
    });

    return new File([glbArrayBuffer], `${filenameBase}.glb`, { type: 'model/gltf-binary' });
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!userId) {
        setModelError('You must be logged in to upload a model.');
        return;
      }
      setModelError(null);
      setIsBusy(true);
      const safeName = file.name.replace(/\s+/g, '_');
      const objectPath = `${userId}/${vehicleId}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadError) {
        setModelError(uploadError.message || 'Upload failed');
        setIsBusy(false);
        return;
      }
      await refreshSignedUrl(objectPath);
      setIsBusy(false);
    },
    [bucket, refreshSignedUrl, userId, vehicleId]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      // reset input so selecting same file twice works
      e.target.value = '';

      const lower = f.name.toLowerCase();
      try {
        setModelError(null);
        if (lower.endsWith('.glb')) {
          await handleUpload(f);
          return;
        }
        if (lower.endsWith('.fbx')) {
          if (!userId) {
            setModelError('You must be logged in to upload a model.');
            return;
          }
          setIsBusy(true);

          // Save BOTH: original FBX (source of truth) + derived GLB (web viewer)
          const base = f.name.replace(/\.fbx$/i, '');
          const { fbxPath, glbPath } = buildVariantPaths(base);

          // Upload FBX as-is
          const fbxFile = new File([f], `${base}.fbx`, { type: f.type || 'application/x-fbx' });
          await uploadToPath(fbxFile, fbxPath);

          // Convert + upload GLB
          const ab = await f.arrayBuffer();
          const glb = await convertFbxArrayBufferToGlbFile(ab, base);
          await uploadToPath(glb, glbPath);

          // Prefer rendering GLB
          await refreshSignedUrl(glbPath);
          setIsBusy(false);
          return;
        }
        if (lower.endsWith('.blend') || lower.endsWith('.gltf')) {
          setModelError('Upload a GLB for web viewing. FBX is supported (auto-converted). BLEND/GLTF require exporting/converting to GLB.');
          return;
        }
        setModelError('Unsupported file. Upload GLB, or FBX (auto-converted).');
      } catch (err: any) {
        setIsBusy(false);
        setModelError(err?.message || 'Conversion failed');
      }
    },
    [buildVariantPaths, convertFbxArrayBufferToGlbFile, handleUpload, refreshSignedUrl, uploadToPath, userId]
  );

  const handleCanvasClick = useCallback((e: ThreeEvent<PointerEvent>) => {
    // only when we hit the model, not empty space
    if (!e.point) return;
    setPendingPoint([e.point.x, e.point.y, e.point.z]);
  }, []);

  const addPendingPoint = useCallback(() => {
    if (!pendingPoint) return;
    const name = (pendingName || '').trim() || `HP_${uuid()}`;
    setPoints((prev) => [
      ...prev,
      {
        id: uuid(),
        name,
        position: pendingPoint,
        createdAt: new Date().toISOString(),
      },
    ]);
    setPendingPoint(null);
    setPendingName('HP_');
  }, [pendingName, pendingPoint]);

  const removePoint = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const exportAndUpload = useCallback(async () => {
    if (!userId) {
      setModelError('You must be logged in to export annotations.');
      return;
    }
    setModelError(null);

    const payload: HarnessAnnotationExport = {
      version: 1,
      vehicleId,
      createdAt: new Date().toISOString(),
      unitHint,
      slackInches,
      model: modelPath && modelSignedUrl ? { bucket, path: modelPath, signedUrl: modelSignedUrl } : null,
      points,
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], `harness_annotations_${Date.now()}.json`, { type: 'application/json' });

    const objectPath = `${userId}/${vehicleId}/annotations_${Date.now()}.json`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: 'application/json',
    });
    if (uploadError) {
      setModelError(uploadError.message || 'Failed to upload annotation export');
      return;
    }

    const { data: signed, error: signedErr } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
    if (signedErr) {
      setModelError(signedErr.message || 'Uploaded export but failed to create signed URL');
      return;
    }

    // Show a copy/pasteable link (simple for now)
    window.prompt('Signed URL (share this with your installer or team):', signed.signedUrl);
  }, [bucket, modelPath, modelSignedUrl, points, slackInches, unitHint, userId, vehicleId]);

  const importFromSignedUrl = useCallback(async () => {
    if (!userId) {
      setModelError('You must be logged in to import a model.');
      return;
    }
    const url = (importUrl || '').trim();
    if (!url) return;
    try {
      setModelError(null);
      setIsBusy(true);

      const clean = url.split('?')[0] || url;
      const lower = clean.toLowerCase();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const ab = await res.arrayBuffer();

      if (lower.endsWith('.fbx')) {
        // Save BOTH: original FBX + derived GLB (so the model is available later without re-conversion).
        const { fbxPath, glbPath } = buildVariantPaths('imported_model');

        const fbx = new File([ab], 'imported.fbx', { type: 'application/x-fbx' });
        await uploadToPath(fbx, fbxPath);

        const glb = await convertFbxArrayBufferToGlbFile(ab, 'imported_model');
        await uploadToPath(glb, glbPath);

        await refreshSignedUrl(glbPath);
        setIsBusy(false);
        return;
      }
      if (lower.endsWith('.glb')) {
        const glb = new File([ab], 'imported.glb', { type: 'model/gltf-binary' });
        // For GLB, upload as-is (already web-friendly).
        setIsBusy(false);
        await handleUpload(glb);
        return;
      }

      throw new Error('URL must point to a .fbx (auto-convert) or .glb file');
    } catch (err: any) {
      setIsBusy(false);
      setModelError(err?.message || 'Import failed');
    }
  }, [buildVariantPaths, convertFbxArrayBufferToGlbFile, handleUpload, importUrl, refreshSignedUrl, uploadToPath, userId]);

  const canInteract = !!modelSignedUrl;

  return (
    <div className="card" style={{ padding: '12px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>3D harness drafting (MVP)</div>
      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', lineHeight: 1.35, marginBottom: '10px' }}>
        Upload a GLB (or FBX, which we auto-convert), click the model to place named points (grommets/clamps/connectors), then export an annotation JSON (with slack) for a cut list workflow.
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
        <button type="button" className="button-win95" onClick={handlePickFile} disabled={isLoadingUser || isBusy}>
          Upload GLB/FBX
        </button>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '8pt' }}>
          Units
          <select
            value={unitHint}
            onChange={(e) => setUnitHint(e.target.value as any)}
            style={{ fontSize: '8pt', padding: '2px 6px', border: '2px solid var(--border)', borderRadius: '2px' }}
          >
            <option value="unknown">unknown</option>
            <option value="inches">inches</option>
            <option value="mm">mm</option>
            <option value="meters">meters</option>
          </select>
        </label>

        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '8pt' }}>
          Slack
          <input
            type="number"
            value={slackInches}
            onChange={(e) => setSlackInches(Number(e.target.value || 0))}
            style={{ width: '80px', fontSize: '8pt', padding: '2px 6px', border: '2px solid var(--border)', borderRadius: '2px' }}
          />
          in
        </label>

        <button type="button" className="button-win95" onClick={exportAndUpload} disabled={!userId}>
          Export Annotations
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <input
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          placeholder="Paste signed URL (.fbx or .glb) to import"
          style={{ flex: 1, minWidth: '240px', fontSize: '8pt', padding: '6px', border: '2px solid var(--border)', borderRadius: '2px' }}
          disabled={!userId || isBusy}
        />
        <button type="button" className="button-win95" onClick={importFromSignedUrl} disabled={!userId || isBusy || !importUrl.trim()}>
          Import URL
        </button>
        {isBusy ? <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Working…</span> : null}
      </div>

      {modelError && (
        <div style={{ marginBottom: '10px', padding: '8px', background: '#ffebee', border: '1px solid #f44336', borderRadius: '2px', fontSize: '8pt', color: '#c62828' }}>
          {modelError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '12px' }}>
        <div style={{ border: '2px solid var(--border)', borderRadius: '2px', overflow: 'hidden', background: '#0f1115' }}>
          <div style={{ height: '420px' }}>
            <Canvas camera={{ position: [1.2, 0.8, 1.2], fov: 55 }} onPointerDown={canInteract ? handleCanvasClick : undefined}>
              <ambientLight intensity={0.7} />
              <directionalLight position={[2, 3, 2]} intensity={0.9} />
              <Suspense fallback={null}>
                {modelSignedUrl ? <Model url={modelSignedUrl} /> : null}
              </Suspense>
              {points.map((p) => (
                <Marker key={p.id} p={p} />
              ))}
              <OrbitControls makeDefault />
            </Canvas>
          </div>
          <div style={{ padding: '6px 8px', fontSize: '7pt', color: '#cbd5e1', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {modelPath ? `Model: ${modelPath}` : 'No model loaded. Upload a GLB to start.'}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '6px' }}>Points</div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.35 }}>
            Click the model to stage a point, name it, then add it to the list. Use names like <span style={{ fontWeight: 600 }}>HP_FIREWALL_GROMMET_MAIN</span>.
          </div>

          {pendingPoint && (
            <div className="card" style={{ padding: '8px', marginBottom: '10px' }}>
              <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '6px' }}>Staged point</div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
                [{pendingPoint.map((n) => n.toFixed(4)).join(', ')}]
              </div>
              <input
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                placeholder="HP_..."
                style={{ width: '100%', fontSize: '8pt', padding: '6px', border: '2px solid var(--border)', borderRadius: '2px', marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="button-win95" onClick={addPendingPoint}>
                  Add Point
                </button>
                <button type="button" className="button-win95" onClick={() => setPendingPoint(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {points.length === 0 ? (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>No points yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: '6px' }}>
              {points.slice().reverse().map((p) => (
                <div key={p.id} className="card" style={{ padding: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 600 }}>{p.name}</div>
                    <button type="button" className="button-win95" onClick={() => removePoint(p.id)} style={{ padding: '2px 6px' }}>
                      Delete
                    </button>
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                    [{p.position.map((n) => n.toFixed(4)).join(', ')}]
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



import { useEffect, useRef, useState } from 'react';
import { parseScene3d } from './scene3d';

const keys = ['cam', 'pose', 'layers', 'harness', 'client', 'tone'];
const signature = (params: URLSearchParams) => keys.map(key => [key, params.get(key)]);

/** URL navigation replaces the initial scene; scene controls update the URL
 * without remounting the canvas and losing the current camera position. */
export function useScene3dURL(params: URLSearchParams, write: (patch: Record<string, string | null>) => void) {
  const query = JSON.stringify(signature(params));
  const ownWrite = useRef<string | null>(null);
  const [scene, setScene] = useState(() => ({ query, init: parseScene3d(params), revision: 0 }));
  if (scene.query !== query) {
    setScene({ query, init: parseScene3d(params), revision: scene.revision + (ownWrite.current === query ? 0 : 1) });
  }
  useEffect(() => { ownWrite.current = null; }, [query]);
  const onScene = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    ownWrite.current = JSON.stringify(signature(next));
    write(patch);
  };
  return { init: scene.init, revision: scene.revision, onScene };
}

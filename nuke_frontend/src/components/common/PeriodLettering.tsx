import { useEffect, useRef, useState, type ReactNode } from 'react';
import manifest from '../../../public/fonts/period/manifest.json';
import './PeriodLettering.css';

// Each face is added on first use by an identity that matches (no global @font-face, no preload). The family is the
// file's base name, which MakeIdentity.css keys each font's metrics and material on.
const periodFaces = new Map<string, Promise<boolean>>();
const loadedFaces = new Set<string>();
const periodFamily = (file: string) => file.slice(file.lastIndexOf('/') + 1).replace(/\.woff2$/, '');
function loadPeriodFace(file: string) {
  let pending = periodFaces.get(file);
  if (!pending) {
    pending = typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts
      ? Promise.resolve(false)
      : new FontFace(periodFamily(file), `url("/fonts/period/${file}") format("woff2")`).load()
        .then(face => { document.fonts.add(face); loadedFaces.add(file); return true; }, () => false);
    periodFaces.set(file, pending);
  }
  return pending;
}

type Family = { files: string[]; chars: string };
const families: Record<string, Family | undefined> = manifest;
const none: Family = { files: [], chars: '' };

/** Period lettering as type in the cutout's box and cap band. Until every face it needs has loaded, if any fails, and
 *  for any word with a character the family does not draw, the raster cutout (fallback) stands. Chrome and decal
 *  colour need 24 px; smaller sizes take the text colour. */
export default function PeriodLettering({ family, role, tone, lettering, fallback }: { family: string; role: string; tone?: string;
  lettering: string; fallback: ReactNode }) {
  const known = families[family];
  const font = known && [...lettering].every(char => known.chars.includes(char)) ? known : none;
  const [ready, setReady] = useState(() => font.files.length > 0 && font.files.every(file => loadedFaces.has(file)));
  const [plain, setPlain] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ready || !font.files.length) return;
    let live = true;
    Promise.all(font.files.map(loadPeriodFace)).then(loaded => { if (live && loaded.every(Boolean)) setReady(true); });
    return () => { live = false; };
  }, [ready, font]);
  useEffect(() => {
    const node = ref.current;
    if (!ready || !node) return;
    const measure = () => setPlain(parseFloat(getComputedStyle(node).fontSize) < 24);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);
  if (!ready || !font.files.length) return <>{fallback}</>;
  return <span ref={ref} className="vehicle-identity__art vehicle-identity__art--cutout vehicle-identity__art--type"
    data-role={role} data-font={periodFamily(font.files[0])} data-material={plain ? 'plain' : tone}>
    <span className="vehicle-identity__type" data-text={lettering}>{lettering}</span>
  </span>;
}

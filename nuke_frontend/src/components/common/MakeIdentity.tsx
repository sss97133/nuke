import { useState } from 'react';
import artwork from '../../../public/stacks/makes/wordmarks.json';
import './MakeIdentity.css';

// Sourced vector artwork, not downloaded fonts or inferred vehicle-era lettering.
// Provenance and unmodified upstream hashes: /stacks/makes/wordmarks.json.
const legacyEmblems: Record<string, string> = {
  chevrolet: 'chevrolet.svg', porsche: 'porsche-emblem.svg', toyota: 'toyota.svg',
  bmw: 'bmw.svg', ford: 'ford.svg', 'mercedes-benz': 'mercedes-benz.svg',
};
const aliases: Record<string, string> = {
  landrover: 'land-rover', 'mercedes-benz': 'mercedes-benz', mercedes: 'mercedes-benz',
};
const keyFor = (make: string) => {
  const key = make.trim().toLowerCase().replace(/\s+/g, '-');
  return aliases[key] ?? key;
};
// One catalogue drives every consumer; registering artwork needs no page edits.
const wordmarks = new Map(artwork.filter(a => (a.role === 'wordmark' || a.role === 'lettered lockup') && !a.file.endsWith('-dark.svg')).map(a => [keyFor(a.brand), a.file]));
const darkWordmarks = new Map(artwork.filter(a => a.role === 'wordmark' && a.file.endsWith('-dark.svg')).map(a => [keyFor(a.brand), a.file]));
const emblems = new Map([...Object.entries(legacyEmblems), ...artwork.filter(a => a.role === 'emblem').map(a => [keyFor(a.brand), a.file] as [string, string])]);

/** Decorative emblem only; its adjacent descriptive label names the vehicle. */
export function MakeLogo({ make }: { make: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const file = emblems.get(keyFor(make));
  return file && failed !== file
    ? <img className="sx-make-logo" src={`/stacks/makes/${file}`} alt="" width="24" height="24" onError={() => setFailed(file)} />
    : null;
}

/** Brand label artwork. Unknown or failed assets always leave a readable brand name. */
export function MakeIdentity({ make, inverse = false }: { make: string; inverse?: boolean }) {
  const key = keyFor(make);
  const [failed, setFailed] = useState<string | null>(null);
  const file = wordmarks.get(key);
  const darkFile = darkWordmarks.get(key);
  if (!file || failed === key) return <span className="make-identity" data-inverse={inverse}><MakeLogo make={make} /><strong>{make}</strong></span>;
  return <span className="make-identity" data-inverse={inverse}>
    <img className={`sx-make-wordmark${darkFile ? ' sx-make-wordmark-light' : ' sx-make-wordmark-monochrome'}`}
      src={`/stacks/makes/${file}`} alt="" width="104" height="24" onError={() => setFailed(key)} />
    {darkFile && <img className="sx-make-wordmark sx-make-wordmark-dark"
      src={`/stacks/makes/${darkFile}`} alt="" width="104" height="24" onError={() => setFailed(key)} />}
    <span className="sr-only">{make}</span>
  </span>;
}

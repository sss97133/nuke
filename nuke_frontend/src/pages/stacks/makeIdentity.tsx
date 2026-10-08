import { useState } from 'react';

// Sourced vector artwork, not downloaded fonts or inferred vehicle-era lettering.
// Provenance and unmodified upstream hashes: /stacks/makes/wordmarks.json.
const wordmarks = new Set([
  'acura', 'alfa-romeo', 'aston-martin', 'audi', 'bentley', 'buick', 'cadillac',
  'chevrolet', 'chrysler', 'dodge', 'ferrari', 'ford', 'gmc', 'honda', 'hummer',
  'jaguar', 'jeep', 'land-rover', 'lexus', 'lincoln', 'lotus', 'maserati', 'mazda',
  'mercedes-benz', 'mini', 'mitsubishi', 'nissan', 'porsche', 'rolls-royce',
  'subaru', 'tesla', 'toyota', 'volkswagen', 'volvo',
]);
const monochrome = new Set([
  'acura', 'alfa-romeo', 'aston-martin', 'bentley', 'buick', 'cadillac',
  'chevrolet', 'chrysler', 'dodge', 'ferrari', 'gmc', 'hummer', 'land-rover',
  'lexus', 'lincoln', 'lotus', 'maserati', 'mercedes-benz', 'mini', 'mitsubishi',
  'porsche', 'rolls-royce',
]);
const emblems: Record<string, string> = {
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

/** Decorative emblem only; its adjacent descriptive label names the vehicle. */
export function MakeLogo({ make }: { make: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const file = emblems[keyFor(make)];
  return file && failed !== file
    ? <img className="sx-make-logo" src={`/stacks/makes/${file}`} alt="" width="24" height="24" onError={() => setFailed(file)} />
    : null;
}

/** Brand label artwork. Unknown or failed assets always leave a readable brand name. */
export function MakeIdentity({ make }: { make: string }) {
  const key = keyFor(make);
  const [failed, setFailed] = useState<string | null>(null);
  if (!wordmarks.has(key) || failed === key) return <><MakeLogo make={make} /><strong>{make}</strong></>;
  return <>
    <img className={`sx-make-wordmark${monochrome.has(key) ? ' sx-make-wordmark-monochrome' : ' sx-make-wordmark-light'}`}
      src={`/stacks/makes/${key}-wordmark.svg`} alt="" width="104" height="24" onError={() => setFailed(key)} />
    {!monochrome.has(key) && <img className="sx-make-wordmark sx-make-wordmark-dark"
      src={`/stacks/makes/${key}-wordmark-dark.svg`} alt="" width="104" height="24" onError={() => setFailed(key)} />}
    <span className="sr-only">{make}</span>
  </>;
}

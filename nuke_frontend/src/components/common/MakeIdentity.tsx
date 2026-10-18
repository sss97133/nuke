import { useState } from 'react';
import type { VehicleIdentityToken } from '../../utils/vehicleIdentity';
import artwork from '../../../public/stacks/makes/wordmarks.json';
import vehicleArtwork from '../../../public/stacks/makes/vehicle-identities.json';
import './MakeIdentity.css';

// Sourced identity artwork; period matches require explicit catalogued year ranges.
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
const labelPresentations = new Map(artwork.filter(a => a.labelPresentation).map(a => [keyFor(a.brand), a.labelPresentation]));

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
  const presentation = labelPresentations.get(key);
  if (presentation) return <span className="make-identity" data-inverse={inverse}>
    {presentation === 'emblem-and-name' && <MakeLogo make={make} />}<strong>{make}</strong>
  </span>;
  if (!file || failed === key) return <span className="make-identity" data-inverse={inverse}><MakeLogo make={make} /><strong>{make}</strong></span>;
  return <span className="make-identity" data-inverse={inverse}>
    <img className={`sx-make-wordmark${darkFile ? ' sx-make-wordmark-light' : ' sx-make-wordmark-monochrome'}`}
      src={`/stacks/makes/${file}`} alt="" width="104" height="24" onError={() => setFailed(key)} />
    {darkFile && <img className="sx-make-wordmark sx-make-wordmark-dark"
      src={`/stacks/makes/${darkFile}`} alt="" width="104" height="24" onError={() => setFailed(key)} />}
    <span className="sr-only">{make}</span>
  </span>;
}

type VehicleIdentityProps = { make: string; model: string; year?: number | string | null; variants?: VehicleIdentityToken[] };
type VehicleArtwork = (typeof vehicleArtwork)[number];

/** Match structured identity only. Unknown years/models never inherit another era's badge. */
export function resolveVehicleArtwork({ make, model, year, variants = [] }: VehicleIdentityProps) {
  const numericYear = /^\d{4}$/.test(String(year)) ? Number(year) : null;
  if (numericYear === null) return [];
  // Match the complete recorded designation: Turbo + S must never inherit Turbo artwork.
  const variant = variants.filter(token => token.kind === 'series' || token.kind === 'trim').map(token => token.value).join(' ');
  return vehicleArtwork.filter(asset => keyFor(asset.make) === keyFor(make)
    && numericYear >= asset.years[0] && numericYear <= asset.years[1]
    && (!asset.models.length || asset.models.some(value => keyFor(value) === keyFor(model)))
    && (!asset.variants?.length || asset.variants.some(value => keyFor(value) === keyFor(variant))));
}

function VehicleArtworkImage({ asset, fallback }: { asset: VehicleArtwork; fallback?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback ? <span>{fallback}</span> : null;
  // A source viewport preserves the photographed metal and lettering without redrawing it.
  // The complete, unmodified source file and its hash remain in the attributed catalogue.
  return <span className={`vehicle-identity__art vehicle-identity__art--${asset.role}`}>
    <svg viewBox={asset.viewport} width={asset.width} height={asset.height} aria-hidden="true" focusable="false">
      <image href={`/stacks/makes/${asset.file}`} width={asset.sourceWidth} height={asset.sourceHeight}
        onError={() => setFailed(true)} />
    </svg>
  </span>;
}

/** The vehicle's own nameplate, selected by year/make/model, with a readable fallback. */
export function VehicleIdentity({ make, model, year, variants = [] }: VehicleIdentityProps) {
  const assets = resolveVehicleArtwork({ make, model, year, variants });
  const maker = assets.find(asset => asset.role === 'make');
  const script = assets.find(asset => asset.role === 'model');
  const emblem = assets.find(asset => asset.role === 'emblem');
  const variantScript = assets.find(asset => asset.role === 'variant');
  const variantName = variants.filter(token => token.kind === 'series' || token.kind === 'trim').map(token => token.value).join(' ');
  return <span className="vehicle-identity" data-period-artwork={assets.length > 0} data-variant-artwork={!!variantScript}>
    <span className="vehicle-identity__maker" aria-hidden="true">
      {maker ? <VehicleArtworkImage key={maker.file} asset={maker} fallback={make} /> : <span>{make}</span>}
      <span className="vehicle-identity__year">{year}{variantScript && <>{year ? ' · ' : ''}<span className="vehicle-identity__model">{model}</span></>}</span>
    </span>
    {emblem && <VehicleArtworkImage key={emblem.file} asset={emblem} />}
    <span className="vehicle-identity__name">
      {!variantScript && <span className="vehicle-identity__model" aria-hidden="true">
        {script ? <VehicleArtworkImage key={script.file} asset={script} fallback={model} /> : model}
      </span>}
      {variantScript && <span className="vehicle-identity__variant" aria-hidden="true"><VehicleArtworkImage key={variantScript.file} asset={variantScript} fallback={variantName} /></span>}
      {variants.filter(token => !variantScript || (token.kind !== 'series' && token.kind !== 'trim')).map(token =>
        <span key={token.kind} className="vehicle-identity__variant" aria-hidden="true">{token.value}</span>)}
    </span>
    <span className="sr-only">{[year, make, model, ...variants.map(token => token.value)].filter(Boolean).join(' ')}</span>
  </span>;
}

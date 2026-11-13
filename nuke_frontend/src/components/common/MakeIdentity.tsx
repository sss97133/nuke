import { lazy, Suspense, useState } from 'react';
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
export function MakeIdentity({ make, inverse = false, compact = false }: { make: string; inverse?: boolean; compact?: boolean }) {
  const key = keyFor(make);
  const [failed, setFailed] = useState<string | null>(null);
  const file = wordmarks.get(key);
  const darkFile = darkWordmarks.get(key);
  const presentation = compact ? labelPresentations.get(key) : null;
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

export type ModelIdentityArtwork = { path: string; width: number; height: number; description: string };
type VehicleIdentityProps = { make: string; model: string; year?: number | string | null; variants?: VehicleIdentityToken[]; compact?: boolean; onExplore?: (field: string, value: string) => void;
  /** The profile's vehicle: lettering cut from this car's own photographs (catalogue vehicleIds) applies to it alone. */
  vehicleId?: string;
  /** What pressing a part does, when it is not the profile's explore dialog (the live board re-scopes in place). */
  exploreLabel?: (field: string, value: string) => string; modelArtwork?: ModelIdentityArtwork | null;
  /** False keeps text where the catalogue's headline-scale lettering would be illegible. */
  artwork?: boolean;
  /** 'text' sets the identity inside a line of text (a live board row): only vector lettering the catalogue sizes for
   *  text (textScale), its capitals matched to the title's, one colour, no panel; anything else stays text. */
  scale?: 'headline' | 'text' };
type VehicleArtwork = (typeof vehicleArtwork)[number];

/** Match structured identity only. Unknown years/models never inherit another era's badge. */
export function resolveVehicleArtwork({ make, model, year, variants = [], vehicleId }: VehicleIdentityProps) {
  const numericYear = /^\d{4}$/.test(String(year)) ? Number(year) : null;
  if (numericYear === null) return [];
  // Match the complete recorded designation: Turbo + S must never inherit Turbo artwork.
  const variant = variants.filter(token => token.kind === 'series' || token.kind === 'trim').map(token => token.value).join(' ');
  return vehicleArtwork.filter(asset => keyFor(asset.make) === keyFor(make)
    // Lettering from one car's own photograph never stands for another car.
    && (!asset.vehicleIds?.length || (!!vehicleId && asset.vehicleIds.includes(vehicleId)))
    && numericYear >= asset.years[0] && numericYear <= asset.years[1]
    && (!asset.models.length || asset.models.some(value => keyFor(value) === keyFor(model)))
    && (!asset.variants?.length || asset.variants.some(value => keyFor(value) === keyFor(variant)))
    // A badge documented "except <trim>" (the 1970-73 fender bird is not a Trans Am part) stays off that trim.
    && !asset.exceptVariants?.some(value => keyFor(value) === keyFor(variant)));
}

/** What the recorded designation adds to the lettering it shows: a tribute's "Trans Am-Style" keeps "-Style". */
function variantQualifier(asset: VehicleArtwork, name: string) {
  const label = asset.label?.trim();
  if (!label || !name.toLowerCase().startsWith(label.toLowerCase())) return '';
  return name.slice(label.length).trim();
}

// Period fonts drawn from the same sources as the cutouts (public/fonts/period/README.md). A catalogue entry's `font`
// names its family in the font build's manifest. The loader is its own chunk, fetched only when an identity with a font
// matches, so no other vehicle's route carries it; the raster stands until the faces load.
const PeriodLettering = lazy(() => import('./PeriodLettering'));

function VehicleArtworkImage({ asset, fallback, text = false, lettering }: { asset: VehicleArtwork; fallback?: string; text?: boolean;
  /** The words the catalogue's period font sets in place of the raster (the recorded make, model, year or label). */
  lettering?: string }) {
  const [failed, setFailed] = useState(false);
  if (asset.font && lettering && !text && !failed) {
    const raster = <VehicleArtworkImage asset={asset} fallback={fallback} />;
    return <Suspense fallback={raster}><PeriodLettering family={asset.font} role={asset.role} tone={asset.tone} lettering={lettering} fallback={raster} /></Suspense>;
  }
  if (failed) return fallback ? <span>{fallback}</span> : null;
  // A cutout (no background) sits on the page surface: a single-colour print is a mask in the text colour; photographed
  // chrome and the car's own decal keep their colour. Its catalogue capMetrics (where its capitals sit in the file) let
  // every mark share one cap height and baseline.
  if (asset.cutout && !text) {
    const src = `/stacks/makes/${asset.file}`;
    const style = { '--art-ratio': asset.sourceWidth / asset.sourceHeight, '--art-src': `url("${src}")`,
      ...(asset.capMetrics ? { '--art-cap': asset.capMetrics.capHeight, '--art-base': asset.capMetrics.baseline } : {}) } as React.CSSProperties;
    return asset.tone === 'monochrome'
      ? <span className="vehicle-identity__art vehicle-identity__art--cutout vehicle-identity__art--mask" data-role={asset.role} style={style}>
        <img src={src} alt="" hidden onError={() => setFailed(true)} />
      </span>
      : <span className="vehicle-identity__art vehicle-identity__art--cutout" data-role={asset.role} style={style}>
        <img src={src} alt="" width={asset.width} height={asset.height} onError={() => setFailed(true)} />
      </span>;
  }
  // In a line of text the lettering's capitals take the text's cap height and its baseline sits on the text's.
  const [, , vw, vh] = asset.viewport.split(' ').map(Number);
  const fit = text && asset.textScale ? { '--art-cap': asset.textScale.capHeight, '--art-base': asset.textScale.baseline, '--art-ratio': vw / vh } as React.CSSProperties : undefined;
  if (fit) return <span className="vehicle-identity__art vehicle-identity__art--text" style={fit}>
    <svg viewBox={asset.viewport} aria-hidden="true" focusable="false" preserveAspectRatio="xMinYMid meet">
      <image href={`/stacks/makes/${asset.file}`} width={asset.sourceWidth} height={asset.sourceHeight}
        onError={() => setFailed(true)} />
    </svg>
  </span>;
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
export function VehicleIdentity({ make, model, year, variants = [], compact = false, onExplore, exploreLabel, modelArtwork, artwork = true, scale = 'headline', vehicleId }: VehicleIdentityProps) {
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const text = scale === 'text';
  const sourcedModel = artwork && !text && modelArtwork && failedArtwork !== modelArtwork.path ? modelArtwork : null;
  // Photographed badges, emblems and variant scripts are headline art; a line of text takes vector lettering only.
  // Library-only entries (boxed or shadowed crops) are kept for reference and never set a headline.
  const assets = artwork ? resolveVehicleArtwork({ make, model, year, variants, vehicleId })
    .filter(asset => asset.headline !== 'library')
    .filter(asset => !text || (asset.textScale && asset.file.endsWith('.svg') && (asset.role === 'make' || asset.role === 'model'))) : [];
  const maker = assets.find(asset => asset.role === 'make');
  const script = assets.find(asset => asset.role === 'model');
  const emblem = assets.find(asset => asset.role === 'emblem');
  const variantScript = assets.find(asset => asset.role === 'variant');
  // Printed period years only (catalogue role "year"); there is no numeral set, so other years stay text.
  const yearArt = assets.find(asset => asset.role === 'year');
  const variantName = variants.filter(token => token.kind === 'series' || token.kind === 'trim').map(token => token.value).join(' ');
  const qualifier = variantScript ? variantQualifier(variantScript, variantName) : '';
  // Every mark shown is a cutout: no nameplate panel, the lettering sits on the page surface.
  const shown = [maker, emblem, variantScript, yearArt, (!variantScript || compact) && !sourcedModel ? script : undefined].filter(Boolean);
  const inline = shown.length > 0 && !sourcedModel && shown.every(asset => asset?.cutout);
  const yearContent = yearArt && year ? <VehicleArtworkImage key={yearArt.file + yearArt.viewport} asset={yearArt} fallback={String(year)} lettering={String(year)} /> : year;
  const part = (field: string, value: string, content: React.ReactNode) => onExplore
    ? <button type="button" className="vehicle-identity__explore" aria-haspopup={exploreLabel ? undefined : 'dialog'}
      aria-label={exploreLabel ? exploreLabel(field, value) : `Explore ${value} in this profile`} title={exploreLabel?.(field, value)}
      onClick={() => onExplore(field, value)}>{content}</button>
    : content;
  return <span className={`vehicle-identity${compact ? ' vehicle-identity--compact' : ''}${text ? ' vehicle-identity--text' : ''}`} data-period-artwork={assets.length > 0 || !!sourcedModel} data-variant-artwork={!!variantScript} data-inline-artwork={inline || undefined}>
    {compact && year && <span className="vehicle-identity__year" aria-hidden={onExplore ? undefined : true}>{part('year', String(year), yearContent)}</span>}
    <span className="vehicle-identity__maker" aria-hidden={onExplore ? undefined : true}>
      {part('make', make, <>
      {maker ? <VehicleArtworkImage key={maker.file} asset={maker} fallback={make} text={text} lettering={make} /> : <span>{make}</span>}
      {!compact && <span className="vehicle-identity__year">{yearContent}{variantScript && <>{year ? ' · ' : ''}<span className="vehicle-identity__model">{model}</span></>}</span>}
      </>)}
    </span>
    {emblem && <VehicleArtworkImage key={emblem.file} asset={emblem} />}
    <span className="vehicle-identity__name">
      {(!variantScript || compact) && <span className="vehicle-identity__model" aria-hidden={onExplore ? undefined : true}>{part('model', model, <>
        {sourcedModel ? <span className="vehicle-identity__art vehicle-identity__art--model"><img src={sourcedModel.path}
          width={sourcedModel.width} height={sourcedModel.height} alt="" title={sourcedModel.description}
          onError={() => setFailedArtwork(sourcedModel.path)} /></span>
          : script ? <VehicleArtworkImage key={script.file} asset={script} fallback={model} text={text} lettering={model} /> : model}
      </>)}</span>}
      {variantScript && <span className="vehicle-identity__variant" aria-hidden={onExplore ? undefined : true}>{part('trim', variantName, <>
        <VehicleArtworkImage key={variantScript.file + variantScript.viewport} asset={variantScript} fallback={qualifier ? variantName.slice(0, -qualifier.length).trim() : variantName} lettering={variantScript.label} />
        {qualifier && <span className="vehicle-identity__qualifier">{qualifier}</span>}
      </>)}</span>}
      {variants.filter(token => !variantScript || (token.kind !== 'series' && token.kind !== 'trim')).map(token =>
        <span key={token.kind} className="vehicle-identity__variant" aria-hidden={onExplore ? undefined : true}>{part(token.kind, token.value, token.value)}</span>)}
    </span>
    <span className="sr-only">{[year, make, model, ...variants.map(token => token.value)].filter(Boolean).join(' ')}</span>
  </span>;
}

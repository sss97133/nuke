// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MakeIdentity, resolveVehicleArtwork, VehicleIdentity } from './MakeIdentity';

it('selects the documented script and nose emblem independently across model years', () => {
  const roles = (year: number) => resolveVehicleArtwork({ year, make: 'Chevrolet', model: 'Corvette' }).map(a => a.role);
  expect(roles(1963)).toEqual(['make', 'model', 'emblem']);
  expect(roles(1964)).toEqual(['model', 'emblem']);
  expect(roles(1965)).toEqual(['model']);
  for (const year of [1962, 1966, 1967, 1968, 2026]) expect(roles(year)).toEqual([]);
});

it('does not give another model Corvette artwork or guess an absent/invalid year', () => {
  expect(resolveVehicleArtwork({ year: 1963, make: 'Chevrolet', model: 'Impala' }).map(a => a.role)).toEqual(['make']);
  expect(resolveVehicleArtwork({ year: 1963, make: 'Ford', model: 'Corvette' })).toEqual([]);
  for (const year of [undefined, null, '', '1963 replica', '1963.5']) {
    expect(resolveVehicleArtwork({ year, make: 'Chevrolet', model: 'Corvette' })).toEqual([]);
  }
  expect(resolveVehicleArtwork({ year: '1963', make: ' chevrolet ', model: 'Corvette Sting Ray' })).toHaveLength(3);
});

it('uses the original 993 script only for the complete recorded Turbo designation and documented years', () => {
  const subject = { make: 'Porsche', model: '911', variants: [{ kind: 'series' as const, value: 'Turbo' }] };
  const script = (year: number, variants = subject.variants) => resolveVehicleArtwork({ ...subject, year, variants }).find(a => a.role === 'variant');
  for (const year of [1995, 1996, 1997, 1998]) expect(script(year)?.file).toBe('porsche-turbo-script-1995-1998.jpg');
  for (const year of [1994, 1999, 2001, 2026]) expect(script(year)).toBeUndefined();
  for (const value of ['Carrera', 'Turbo S', 'Turbo-look', 'GT2']) expect(script(1997, [{ kind: 'series', value }])).toBeUndefined();
  expect(resolveVehicleArtwork({ ...subject, year: 1997, variants: [...subject.variants, { kind: 'trim', value: 'S' }] }).some(a => a.role === 'variant')).toBe(false);
  expect(script(1997, [])).toBeUndefined();
  expect(resolveVehicleArtwork({ ...subject, year: 1997, model: 'Boxster' })).toEqual([]);
});

it('keeps the recorded name readable when source artwork fails and when identity changes', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<VehicleIdentity year={1963} make="Chevrolet" model="Corvette" />));
    expect(host.querySelector('.sr-only')?.textContent).toBe('1963 Chevrolet Corvette');
    await act(async () => host.querySelectorAll('image').forEach(image => image.dispatchEvent(new Event('error'))));
    expect(host.querySelector('.vehicle-identity__maker')?.textContent).toContain('Chevrolet');
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('Corvette');
    await act(async () => root.render(<VehicleIdentity year={1997} make="Porsche" model="911" variants={[{ kind: 'series', value: 'Turbo' }]} />));
    // The 993 crest and Turbo script; the Cardog wordmark measured against the 1996-98 covers did not match (2026-11-08).
    expect(host.querySelectorAll('image')).toHaveLength(2);
    expect(host.querySelector('.sr-only')?.textContent).toBe('1997 Porsche 911 Turbo');
    await act(async () => host.querySelectorAll('image').forEach(image => image.dispatchEvent(new Event('error'))));
    expect(host.querySelector('.vehicle-identity__variant')?.textContent).toBe('Turbo');
    expect(host.querySelector('.vehicle-identity__maker')?.textContent).toContain('Porsche');
    await act(async () => root.render(<VehicleIdentity year={2023} make="Porsche" model="911" variants={[{ kind: 'series', value: 'Turbo' }]} />));
    expect(host.querySelector('image')).toBeNull();
    expect(host.textContent).toContain('911Turbo');
    expect(host.querySelector('.sr-only')?.textContent).toBe('2023 Porsche 911 Turbo');
  } finally { await act(async () => root.unmount()); }
});


it('uses catalogue label choices for Chevrolet and Dodge while retaining other wordmarks and accessible fallbacks', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<MakeIdentity make="Chevrolet" inverse compact />));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/stacks/makes/chevrolet.svg');
    expect(host.querySelector('strong')?.textContent).toBe('Chevrolet');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.textContent).toBe('Chevrolet');
    await act(async () => root.render(<MakeIdentity make="Dodge" inverse compact />));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe('Dodge');
    await act(async () => root.render(<MakeIdentity make="Chevrolet" />));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/stacks/makes/chevrolet-wordmark.svg');
    await act(async () => root.render(<MakeIdentity make="Ferrari" inverse compact />));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/stacks/makes/ferrari-wordmark.svg');
    expect(host.querySelector('.sr-only')?.textContent).toBe('Ferrari');
  } finally { await act(async () => root.unmount()); }
});

it('renders a compact identity once with original sourced artwork or text when the year/model has no asset', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<VehicleIdentity compact year={1980} make="Chevrolet" model="K5 Blazer" />));
    expect(host.querySelector('.sr-only')?.textContent).toBe('1980 Chevrolet K5 Blazer');
    expect(host.querySelector('svg')).toBeNull();
    const visible = host.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.sr-only').forEach(node => node.remove());
    expect(visible.textContent).toBe('1980ChevroletK5 Blazer');
    await act(async () => root.render(<VehicleIdentity compact year={1963} make="Chevrolet" model="Corvette" />));
    expect([...host.querySelectorAll('image')].map(node => node.getAttribute('href'))).toEqual([
      '/stacks/makes/chevrolet-corvette-brochure-1963.jpg', '/stacks/makes/corvette-nose-1963-1964.png', '/stacks/makes/corvette-script-1963-1965.png',
    ]);
    expect(host.querySelector('svg text')).toBeNull();
    await act(async () => root.render(<VehicleIdentity compact year={1987} make="Chevrolet" model="Corvette" />));
    expect(host.querySelector('image')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('uses the photographed K5 emblem only for the supplier documented full-size model and years', async () => {
  for (const year of [1981, 1987, 1988]) expect(resolveVehicleArtwork({ year, make: 'Chevrolet', model: 'K5 Blazer' }).map(asset => asset.file)).toEqual(['chevrolet-k5-blazer-emblem-1981-1988.jpg']);
  for (const year of [1980, 1989, 1991, null]) expect(resolveVehicleArtwork({ year, make: 'Chevrolet', model: 'K5 Blazer' })).toEqual([]);
  for (const model of ['S10 Blazer', 'S-10 Blazer', 'Blazer', 'Suburban']) expect(resolveVehicleArtwork({ year: 1987, make: 'Chevrolet', model })).toEqual([]);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<VehicleIdentity compact year={1987} make="Chevrolet" model="K5 Blazer" />));
    expect(host.querySelector('image')?.getAttribute('href')).toBe('/stacks/makes/chevrolet-k5-blazer-emblem-1981-1988.jpg');
    expect(host.querySelector('.sr-only')?.textContent).toBe('1987 Chevrolet K5 Blazer');
    expect(host.querySelector('svg text')).toBeNull();
    await act(async () => host.querySelector('image')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('K5 Blazer');
  } finally { await act(async () => root.unmount()); }
});

it('sets make lettering inside a line of text only for its evidenced years, and keeps photographed badges out of it', async () => {
  const lettering = (make: string, year: number) => resolveVehicleArtwork({ year, make, model: 'Any' }).filter(a => a.textScale).map(a => a.file);
  for (const year of [2006, 2014, 2022]) expect(lettering('Porsche', year)).toEqual(['porsche-lettering-commons.svg']);
  for (const year of [1997, 2005, 2023, 2026]) expect(lettering('Porsche', year)).toEqual([]);
  for (const year of [2010, 2021, 2026]) expect(lettering('Mercedes-Benz', year)).toEqual(['mercedes-benz-wordmark.svg']);
  for (const year of [2009, 2027]) expect(lettering('Mercedes-Benz', year)).toEqual([]);
  for (const year of [1977, 1993, 2003]) expect(lettering('Ford', year)).toEqual(['ford-oval-print-commons.svg']);
  for (const year of [1967, 2004]) expect(lettering('Ford', year)).toEqual([]);
  for (const year of [2015, 2020]) expect(lettering('Chevrolet', year)).toEqual(['chevrolet-wordmark.svg']);
  // 1963 keeps its photographed brochure mark (headline art only); 2012 covers print a different, serif lettering.
  for (const year of [1963, 2012, 2014, 2021]) expect(lettering('Chevrolet', year)).toEqual([]);
  expect(lettering('Toyota', 1989)).toEqual([]);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    // A free-text board model still gets the make's lettering; the full title stays the accessible name.
    await act(async () => root.render(<VehicleIdentity compact scale="text" year={2016} make="Porsche" model="911 Carrera 4S Coupe 7-Speed" />));
    expect([...host.querySelectorAll('image')].map(node => node.getAttribute('href'))).toEqual(['/stacks/makes/porsche-lettering-commons.svg']);
    expect(host.querySelector('.vehicle-identity__art--text')).not.toBeNull();
    expect(host.querySelector('.sr-only')?.textContent).toBe('2016 Porsche 911 Carrera 4S Coupe 7-Speed');
    expect(host.querySelector('.vehicle-identity__model')?.textContent).toBe('911 Carrera 4S Coupe 7-Speed');
    await act(async () => host.querySelector('image')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('.vehicle-identity__maker')?.textContent).toBe('Porsche');
    // The 1963 brochure scan, nose emblem and Corvette script are headline art: a row keeps text.
    await act(async () => root.render(<VehicleIdentity compact scale="text" year={1963} make="Chevrolet" model="Corvette" />));
    expect(host.querySelector('image')).toBeNull();
    expect(host.querySelector('.vehicle-identity')?.getAttribute('data-period-artwork')).toBe('false');
  } finally { await act(async () => root.unmount()); }
});

it('keeps a library of sourced 1973 Pontiac lettering, each version inside its documented years and models', () => {
  const CAR = '20d21fb0-4651-4469-a0ba-e751309a1e54';
  const files = (year: number, model = 'Firebird', variants: { kind: 'trim'; value: string }[] = [], vehicleId?: string) =>
    Object.fromEntries(['year', 'make', 'emblem', 'model', 'variant'].map(role => [role,
      resolveVehicleArtwork({ year, make: 'Pontiac', model, variants, vehicleId }).filter(a => a.role === role).map(a => a.file)]));
  const tribute = files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am-Style' }]);
  // Several versions per mark; the first headline-eligible one is what the headline renders.
  // The heavy full-line cover numeral leads; the hairline Accessorizer year stays in the library order behind it.
  expect(tribute.year).toEqual(['pontiac-1973-full-line-year-cut.png', 'pontiac-1973-accessorizer-year-cut.png', 'pontiac-firebird-1973-canada-73-cut.png']);
  expect(tribute.make).toEqual(['pontiac-firebird-tail-letters-1970-1973-cut.png', 'pontiac-1973-accessorizer-pontiac-cut.png',
    'pontiac-1973-full-line-pontiac-cut.png', 'pontiac-firebird-1973-canada-pontiac-cut.png']);
  expect(tribute.model).toEqual(['pontiac-firebird-fender-script-1971-1981-cut.png', 'pontiac-1973-full-line-firebird-cut.png',
    'pontiac-firebird-1973-us-foldout-firebird-cut.png', 'pontiac-firebird-1973-canada-firebird-cut.png']);
  expect(tribute.variant).toEqual(['pontiac-firebird-1973-canada-trans-am-cut.png', 'pontiac-trans-am-names-1973-1975.png', 'pontiac-trans-am-names-1973-1975.png']);
  // The car's own decal, cut from its own photograph, leads for that vehicle only.
  expect(files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am-Style' }], CAR).variant[0]).toBe('pontiac-firebird-trans-am-style-owner-decal-cut.png');
  expect(files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am-Style' }], '00000000-0000-4000-8000-000000000000').variant).toEqual(tribute.variant);
  // Every cutout names its committed original, the crop and the command that made it; boxed or shadowed crops stay library-only.
  const all = resolveVehicleArtwork({ year: 1973, make: 'Pontiac', model: 'Firebird', variants: [{ kind: 'trim', value: 'Trans Am-Style' }], vehicleId: CAR });
  for (const asset of all) {
    if (asset.cutout) {
      expect(asset.viewport).toBe(`0 0 ${asset.sourceWidth} ${asset.sourceHeight}`);
      expect(asset.cutout.command).toContain(`nuke_frontend/public/stacks/makes/${asset.file}`);
      expect(asset.localSha256Base64).toBeTruthy();
      expect(['monochrome', 'chrome', 'color']).toContain(asset.tone);
      // Where its capitals sit in the file, measured on a named reference glyph's columns, so every mark shares one cap
      // height and baseline. Top-level, so the build's provenance projection keeps it.
      const { capHeight, baseline, glyph, columns } = asset.capMetrics!;
      expect(capHeight).toBeGreaterThan(0.8);
      expect(capHeight + baseline).toBeLessThanOrEqual(1);
      expect(glyph).toBeTruthy();
      const [c0, c1] = columns.split('-').map(Number);
      expect(c0).toBeGreaterThanOrEqual(0);
      expect(c1).toBeLessThan(asset.sourceWidth);
    } else expect(asset.headline).toBe('library');
  }
  expect(all.filter(a => a.headline === 'library').map(a => [a.role, a.viewport])).toEqual([
    ['emblem', '237 280 91 93'], ['emblem', '0 0 800 738'], ['variant', '386 72 284 32'], ['variant', '31 351 296 42']]);
  // The 1970-73 fender bird is documented "except Trans Am"; a tribute's base Firebird body is not a Trans Am.
  expect(tribute.emblem).toEqual(['pontiac-1973-accessorizer-cover.jpg', 'pontiac-firebird-fender-bird-1970-1973.jpg']);
  const genuine = files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(genuine.variant).toEqual(tribute.variant);
  expect(genuine.emblem).toEqual(['pontiac-1973-accessorizer-cover.jpg']);
  // A plain Firebird gets no Trans Am lettering; other trims never inherit it.
  expect(files(1973).variant).toEqual([]);
  expect(files(1973, 'Firebird', [], CAR).variant).toEqual([]);
  for (const value of ['Formula', 'Esprit', 'Trans Am SD-455']) expect(files(1973, 'Firebird', [{ kind: 'trim', value }]).variant).toEqual([]);
  // Printed years stand only for 1973; neighbouring years keep only the ranged on-car parts.
  const y1972 = files(1972, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }], CAR);
  expect(y1972).toEqual({ year: [], make: ['pontiac-firebird-tail-letters-1970-1973-cut.png'], emblem: [],
    model: ['pontiac-firebird-fender-script-1971-1981-cut.png'], variant: [] });
  const y1974 = files(1974, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(y1974).toEqual({ year: [], make: [], emblem: [], model: ['pontiac-firebird-fender-script-1971-1981-cut.png'],
    variant: ['pontiac-trans-am-names-1973-1975.png'] });
  expect(files(1976, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]).variant).toEqual([]);
  // Another 1973 Pontiac gets only the make-wide literature: no Firebird letters, script, bird or decal.
  const grandPrix = files(1973, 'Grand Prix', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(grandPrix).toEqual({ year: ['pontiac-1973-full-line-year-cut.png', 'pontiac-1973-accessorizer-year-cut.png'],
    make: ['pontiac-1973-accessorizer-pontiac-cut.png', 'pontiac-1973-full-line-pontiac-cut.png'], emblem: ['pontiac-1973-accessorizer-cover.jpg'], model: [], variant: [] });
  expect(resolveVehicleArtwork({ year: 1973, make: 'Chevrolet', model: 'Firebird' })).toEqual([]);
});

it('sets the 1973 tribute headline in cutout lettering on the page surface, keeps "-Style" visible and falls back to text', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const CAR = '20d21fb0-4651-4469-a0ba-e751309a1e54';
  const host = document.createElement('div'), root = createRoot(host);
  const marks = () => [...host.querySelectorAll<HTMLElement>('.vehicle-identity__art')].map(node =>
    [node.dataset.role, node.classList.contains('vehicle-identity__art--mask') ? 'mask' : 'image', node.querySelector('img')?.getAttribute('src')]);
  try {
    await act(async () => root.render(<VehicleIdentity compact year={1973} make="Pontiac" model="Firebird" vehicleId={CAR}
      variants={[{ kind: 'trim', value: 'Trans Am-Style' }]} onExplore={() => {}} />));
    // Printed single-colour lettering is a mask in the text colour; chrome and the car's own decal keep their colour.
    expect(marks()).toEqual([
      ['year', 'mask', '/stacks/makes/pontiac-1973-full-line-year-cut.png'],
      ['make', 'image', '/stacks/makes/pontiac-firebird-tail-letters-1970-1973-cut.png'],
      ['model', 'image', '/stacks/makes/pontiac-firebird-fender-script-1971-1981-cut.png'],
      ['variant', 'image', '/stacks/makes/pontiac-firebird-trans-am-style-owner-decal-cut.png'],
    ]);
    // Each mark carries its catalogue cap metrics, which the stylesheet turns into one shared cap band.
    expect([...host.querySelectorAll<HTMLElement>('.vehicle-identity__art')].map(node =>
      [node.style.getPropertyValue('--art-cap'), node.style.getPropertyValue('--art-base')])).toEqual([
      ['0.936', '0.029'], ['0.954', '0.023'], ['0.974', '0.018'], ['0.913', '0.029']]);
    // No arrowhead box, no shadowed decal photograph, no nameplate panel.
    expect(host.querySelector('image')).toBeNull();
    expect(host.querySelector('.vehicle-identity')?.getAttribute('data-inline-artwork')).toBe('true');
    // The decal is lettering on a tribute, not factory trim: the record's qualifier stays on screen.
    expect(host.querySelector('.vehicle-identity__qualifier')?.textContent).toBe('-Style');
    expect(host.querySelector('.sr-only')?.textContent).toBe('1973 Pontiac Firebird Trans Am-Style');
    expect(host.querySelector('[aria-label="Explore Trans Am-Style in this profile"]')).not.toBeNull();
    await act(async () => host.querySelectorAll('.vehicle-identity__art img').forEach(image => image.dispatchEvent(new Event('error'))));
    const visible = host.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.sr-only').forEach(node => node.remove());
    expect(visible.textContent).toBe('1973PontiacFirebirdTrans Am-Style');
    // Another car (no vehicle id): brochure "TRANS AM" as a mask; a genuine Trans Am shows it with no qualifier.
    await act(async () => root.render(<span />));
    await act(async () => root.render(<VehicleIdentity compact year={1973} make="Pontiac" model="Firebird" variants={[{ kind: 'trim', value: 'Trans Am' }]} />));
    expect(host.querySelector('.vehicle-identity__qualifier')).toBeNull();
    expect(marks().at(-1)).toEqual(['variant', 'mask', '/stacks/makes/pontiac-firebird-1973-canada-trans-am-cut.png']);
  } finally { await act(async () => root.unmount()); }
});

it('sets the 1973 lettering in its period fonts once they load, injected on match only, raster until then', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const CAR = '20d21fb0-4651-4469-a0ba-e751309a1e54';
  const requested: string[] = [], added: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('FontFace', class {
    family: string;
    constructor(family: string, source: string) { this.family = family; requested.push(source); }
    load() { return gate.then(() => this); }
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (face: { family: string }) => added.push(face.family) } });
  vi.resetModules();
  const { VehicleIdentity: Fresh } = await import('./MakeIdentity');
  const host = document.createElement('div'), root = createRoot(host);
  try {
    // A make with no period font requests nothing.
    await act(async () => root.render(<Fresh year={1963} make="Chevrolet" model="Corvette" />));
    expect(requested).toEqual([]);
    await act(async () => root.render(<Fresh compact year={1973} make="Pontiac" model="Firebird" vehicleId={CAR}
      variants={[{ kind: 'trim', value: 'Trans Am-Style' }]} onExplore={() => {}} />));
    // The loader is a lazy chunk: let it resolve.
    await act(async () => { await import('./PeriodLettering'); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(requested).toEqual([
      'url("/fonts/period/pontiac-1973-brochure-numerals/Pontiac1973BrochureNumerals-Regular.woff2") format("woff2")',
      'url("/fonts/period/pontiac-1973-block/Pontiac1973Block-Regular.woff2") format("woff2")',
      'url("/fonts/period/pontiac-1973-block/Pontiac1973Block-Face.woff2") format("woff2")',
      'url("/fonts/period/firebird-1971-script/Firebird1971Script-Regular.woff2") format("woff2")',
      'url("/fonts/period/trans-am-1973-decal/TransAm1973Decal-Regular.woff2") format("woff2")',
    ]);
    // Until the faces load, the raster cutouts stand.
    expect(host.querySelectorAll('.vehicle-identity__art img')).toHaveLength(4);
    expect(host.querySelector('.vehicle-identity__type')).toBeNull();
    await act(async () => { release(); await gate; });
    expect(added).toEqual(['Pontiac1973BrochureNumerals-Regular', 'Pontiac1973Block-Regular', 'Pontiac1973Block-Face',
      'Firebird1971Script-Regular', 'TransAm1973Decal-Regular']);
    const set = [...host.querySelectorAll<HTMLElement>('.vehicle-identity__art--type')].map(node =>
      [node.dataset.role, node.dataset.font, node.textContent]);
    expect(set).toEqual([
      ['year', 'Pontiac1973BrochureNumerals-Regular', '1973'],
      ['make', 'Pontiac1973Block-Regular', 'Pontiac'],
      ['model', 'Firebird1971Script-Regular', 'Firebird'],
      ['variant', 'TransAm1973Decal-Regular', 'Trans Am'],
    ]);
    expect(host.querySelector('.vehicle-identity__art img')).toBeNull();
    // "-Style" is Nuke's qualifier, set in the UI face beside the decal, never in a period font.
    expect(host.querySelector('.vehicle-identity__qualifier')?.closest('.vehicle-identity__art--type')).toBeNull();
    expect(host.querySelector('.vehicle-identity__qualifier')?.textContent).toBe('-Style');
    expect(host.querySelector('.sr-only')?.textContent).toBe('1973 Pontiac Firebird Trans Am-Style');
    // Faces already loaded set the type on first render, with no raster flash and no second request.
    await act(async () => root.render(<span />));
    await act(async () => root.render(<Fresh compact year={1973} make="Pontiac" model="Firebird" vehicleId={CAR}
      variants={[{ kind: 'trim', value: 'Trans Am-Style' }]} />));
    expect(host.querySelectorAll('.vehicle-identity__art--type')).toHaveLength(4);
    expect(requested).toHaveLength(5);
    // A word with a character its family does not draw (the script has no figures) keeps the raster; so does an
    // unknown family.
    const { default: Period } = await import('./PeriodLettering');
    await act(async () => root.render(<>
      <Period family="firebird-1971-script" role="model" tone="chrome" lettering="Firebird 400" fallback={<i>raster</i>} />
      <Period family="no-such-family" role="model" lettering="Firebird" fallback={<i>raster</i>} />
    </>));
    expect(host.innerHTML).toBe('<i>raster</i><i>raster</i>');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    delete (document as any).fonts;
  }
});

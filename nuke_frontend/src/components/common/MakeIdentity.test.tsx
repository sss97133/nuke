// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
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
  const files = (year: number, model = 'Firebird', variants: { kind: 'trim'; value: string }[] = []) =>
    Object.fromEntries(['year', 'make', 'emblem', 'model', 'variant'].map(role => [role,
      resolveVehicleArtwork({ year, make: 'Pontiac', model, variants }).filter(a => a.role === role).map(a => a.file)]));
  const tribute = files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am-Style' }]);
  // Several versions per mark; the first is what the headline renders.
  expect(tribute.year).toEqual(['pontiac-1973-accessorizer-cover.jpg', 'pontiac-1973-full-line-cover.jpg', 'pontiac-firebird-1973-canada-cover.jpg']);
  expect(tribute.make).toEqual(['pontiac-firebird-tail-letters-1970-1973.jpg', 'pontiac-1973-accessorizer-cover.jpg',
    'pontiac-1973-full-line-cover.jpg', 'pontiac-firebird-1973-canada-cover.jpg']);
  expect(tribute.model).toEqual(['pontiac-firebird-fender-script-1971-1981.jpg', 'pontiac-1973-full-line-firebird-spread.jpg',
    'pontiac-firebird-1973-us-foldout-cover.jpg', 'pontiac-firebird-1973-canada-cover.jpg']);
  expect(tribute.variant).toEqual(['pontiac-trans-am-names-1973-1975.png', 'pontiac-trans-am-names-1973-1975.png', 'pontiac-firebird-1973-canada-cover.jpg']);
  // The 1973-75 spoiler name (Blue) leads; the 1973-only Green fender name is a library alternative from the same photograph.
  const decals = resolveVehicleArtwork({ year: 1973, make: 'Pontiac', model: 'Firebird', variants: [{ kind: 'trim', value: 'Trans Am-Style' }] })
    .filter(a => a.role === 'variant').map(a => [a.years.join('-'), a.viewport]);
  expect(decals.slice(0, 2)).toEqual([['1973-1975', '386 72 284 32'], ['1973-1973', '31 351 296 42']]);
  // The 1970-73 fender bird is documented "except Trans Am"; a tribute's base Firebird body is not a Trans Am.
  expect(tribute.emblem).toEqual(['pontiac-1973-accessorizer-cover.jpg', 'pontiac-firebird-fender-bird-1970-1973.jpg']);
  const genuine = files(1973, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(genuine.variant).toEqual(tribute.variant);
  expect(genuine.emblem).toEqual(['pontiac-1973-accessorizer-cover.jpg']);
  // A plain Firebird gets no Trans Am lettering; other trims never inherit it.
  expect(files(1973).variant).toEqual([]);
  for (const value of ['Formula', 'Esprit', 'Trans Am SD-455']) expect(files(1973, 'Firebird', [{ kind: 'trim', value }]).variant).toEqual([]);
  // Printed years stand only for 1973; neighbouring years keep only the ranged on-car parts.
  const y1972 = files(1972, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(y1972).toEqual({ year: [], make: ['pontiac-firebird-tail-letters-1970-1973.jpg'], emblem: [],
    model: ['pontiac-firebird-fender-script-1971-1981.jpg'], variant: [] });
  const y1974 = files(1974, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(y1974).toEqual({ year: [], make: [], emblem: [], model: ['pontiac-firebird-fender-script-1971-1981.jpg'],
    variant: ['pontiac-trans-am-names-1973-1975.png'] });
  expect(files(1976, 'Firebird', [{ kind: 'trim', value: 'Trans Am' }]).variant).toEqual([]);
  // Another 1973 Pontiac gets only the make-wide literature: no Firebird letters, script, bird or decal.
  const grandPrix = files(1973, 'Grand Prix', [{ kind: 'trim', value: 'Trans Am' }]);
  expect(grandPrix).toEqual({ year: ['pontiac-1973-accessorizer-cover.jpg', 'pontiac-1973-full-line-cover.jpg'],
    // The 26 KB Accessorizer cover (already the year and arrowhead) leads other 1973 Pontiacs, not the 548 KB full-line scan.
    make: ['pontiac-1973-accessorizer-cover.jpg', 'pontiac-1973-full-line-cover.jpg'], emblem: ['pontiac-1973-accessorizer-cover.jpg'], model: [], variant: [] });
  expect(resolveVehicleArtwork({ year: 1973, make: 'Chevrolet', model: 'Firebird' })).toEqual([]);
});

it('renders the 1973 tribute headline in sourced lettering, keeps "-Style" visible and falls back to text', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<VehicleIdentity compact year={1973} make="Pontiac" model="Firebird"
      variants={[{ kind: 'trim', value: 'Trans Am-Style' }]} onExplore={() => {}} />));
    expect([...host.querySelectorAll('image')].map(node => node.getAttribute('href'))).toEqual([
      '/stacks/makes/pontiac-1973-accessorizer-cover.jpg', '/stacks/makes/pontiac-firebird-tail-letters-1970-1973.jpg',
      '/stacks/makes/pontiac-1973-accessorizer-cover.jpg', '/stacks/makes/pontiac-firebird-fender-script-1971-1981.jpg',
      '/stacks/makes/pontiac-trans-am-names-1973-1975.png',
    ]);
    // The decal is lettering on a tribute, not factory trim: the record's qualifier stays on screen.
    expect(host.querySelector('.vehicle-identity__qualifier')?.textContent).toBe('-Style');
    expect(host.querySelector('.sr-only')?.textContent).toBe('1973 Pontiac Firebird Trans Am-Style');
    expect(host.querySelector('[aria-label="Explore Trans Am-Style in this profile"]')).not.toBeNull();
    await act(async () => host.querySelectorAll('image').forEach(image => image.dispatchEvent(new Event('error'))));
    const visible = host.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.sr-only').forEach(node => node.remove());
    expect(visible.textContent).toBe('1973PontiacFirebirdTrans Am-Style');
    // A genuine Trans Am shows the lettering with no qualifier (fresh mount: the failures above stay failed).
    await act(async () => root.render(<span />));
    await act(async () => root.render(<VehicleIdentity compact year={1973} make="Pontiac" model="Firebird" variants={[{ kind: 'trim', value: 'Trans Am' }]} />));
    expect(host.querySelector('.vehicle-identity__qualifier')).toBeNull();
    expect(host.querySelectorAll('image')).toHaveLength(5);
  } finally { await act(async () => root.unmount()); }
});

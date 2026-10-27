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
    expect(host.querySelectorAll('image')).toHaveLength(3);
    expect(host.querySelector('.sr-only')?.textContent).toBe('1997 Porsche 911 Turbo');
    await act(async () => host.querySelectorAll('image').forEach(image => image.dispatchEvent(new Event('error'))));
    expect(host.querySelector('.vehicle-identity__variant')?.textContent).toBe('Turbo');
    expect(host.querySelector('.vehicle-identity__maker')?.textContent).toContain('Porsche');
    await act(async () => root.render(<VehicleIdentity year={2006} make="Porsche" model="911" variants={[{ kind: 'series', value: 'Turbo' }]} />));
    expect(host.querySelector('image')).toBeNull();
    expect(host.textContent).toContain('911Turbo');
    expect(host.querySelector('.sr-only')?.textContent).toBe('2006 Porsche 911 Turbo');
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

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { resolveVehicleArtwork, VehicleIdentity } from './MakeIdentity';

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
    await act(async () => root.render(<VehicleIdentity year={1997} make="Porsche" model="911"><span>Turbo</span></VehicleIdentity>));
    expect(host.querySelector('image')).toBeNull();
    expect(host.textContent).toContain('911Turbo');
    expect(host.querySelector('.sr-only')?.textContent).toBe('1997 Porsche 911');
  } finally { await act(async () => root.unmount()); }
});

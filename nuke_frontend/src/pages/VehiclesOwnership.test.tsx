// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ garage: { vehicles: [] as any[], isLoading: false, error: null as string | null, refresh: vi.fn() } }));
vi.mock('../hooks/useVehiclesDashboard', async original => ({ ...await original<any>(), useVehiclesDashboard: () => fixture.garage }));
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: { user: { id: 'user' } } }) }));
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../services/myOrganizationsService', () => ({ MyOrganizationsService: { getMyOrganizations: async () => [] } }));
vi.mock('../components/vehicles/GarageVehicleCard', () => ({ default: ({ vehicle, relationship }: any) => <div data-vehicle={vehicle.id}>{vehicle.model} {relationship?.role}</div> }));
vi.mock('../components/VehicleRelationshipManager', () => ({ default: () => null }));
vi.mock('../components/vehicles/OrganizationContextFilter', () => ({ default: () => null }));
vi.mock('../components/vehicles/BulkActionsToolbar', () => ({ default: () => null }));
vi.mock('../components/vehicles/VehicleOrganizationToolbar', () => ({ default: () => null }));
vi.mock('../components/vehicles/VehicleConfirmationQuestions', () => ({ default: () => null }));
vi.mock('../components/ownership/TitleTransferApproval', () => ({ default: () => null }));
vi.mock('../components/vehicles/FleetHealthOverview', () => ({ default: () => null }));
vi.mock('../components/vehicles/QuickFixModal', () => ({ default: () => null }));
vi.mock('../lib/supabase', () => {
  const rows = ['title', 'photo'].map(id => ({ id, year: 1970, make: 'Fixture', model: id,
    created_at: '2020-01-01', user_id: 'user', is_public: true }));
  return { supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: (table: string) => {
      let data: any[] = table === 'vehicles' ? rows : table === 'vehicle_user_permissions'
        ? [{ vehicle_id: 'photo', role: 'co_owner', user_id: 'user', is_active: true }]
        : table === 'ownership_verifications' ? [{ vehicle_id: 'title', user_id: 'user', status: 'approved' }] : [];
      const q: any = { select: () => q, order: () => q, or: () => q, is: () => q,
        eq: (key: string, value: any) => { data = data.filter(row => row[key] === value); return q; },
        in: (key: string, values: any[]) => { data = data.filter(row => values.includes(row[key])); return q; },
        then: (fn: any) => Promise.resolve({ data, error: null }).then(fn) };
      return q;
    },
  } };
});
import Vehicles from './Vehicles';
it('keeps photo-only co-owner permissions out of the actual legacy Owned tab and retains them in All', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'vehicles.sidebarCollapsed' ? 'false' : null, setItem: () => {} });
  fixture.garage = { vehicles: [{ id: 'title', year: 1970, make: 'Fixture', model: 'title', relationship_type: 'VERIFIED OWNER', created_at: '2020-01-01' },
    { id: 'photo', relationship_type: 'RELATIONSHIP REVIEW' }], isLoading: false, error: null, refresh: vi.fn() };
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter><Vehicles /></MemoryRouter>));
    expect(host.querySelector('[data-vehicle="title"]')).not.toBeNull();
    expect(host.querySelector('[data-vehicle="photo"]')).toBeNull();
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'REFRESH')!;
    expect(refresh).not.toBeNull(); await act(async () => refresh.click());
    expect(fixture.garage.refresh).toHaveBeenCalledOnce();
    const search = host.querySelector('input[placeholder="Search vehicles..."]') as HTMLInputElement;
    search.focus();
    const accepted = fixture.garage;
    fixture.garage = { ...accepted, isLoading: true, vehicles: [] };
    await act(async () => root.render(<MemoryRouter><Vehicles /></MemoryRouter>));
    expect(host.querySelector('input[placeholder="Search vehicles..."]')).toBe(search);
    expect(document.activeElement).toBe(search);
    expect(host.textContent).toContain('Reading ownership evidence');
    expect(host.textContent).not.toContain('No vehicles yet');
    fixture.garage = accepted;
    await act(async () => root.render(<MemoryRouter><Vehicles /></MemoryRouter>));
    const all = [...host.querySelectorAll('button')].find(button => button.textContent === 'All2')!;
    expect(all).toBeTruthy(); await act(async () => all.click());
    expect(host.querySelector('[data-vehicle="photo"]')).not.toBeNull();
    fixture.garage = { ...fixture.garage, error: 'evidence failed' };
    await act(async () => root.render(<MemoryRouter><Vehicles /></MemoryRouter>));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const owned = [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith('Owned'))!;
    await act(async () => owned.click());
    expect(host.querySelector('[data-vehicle="title"]')).toBeNull();
    expect(host.querySelector('[data-vehicle="photo"]')).toBeNull();
    expect(host.textContent).not.toContain('No vehicles yet');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

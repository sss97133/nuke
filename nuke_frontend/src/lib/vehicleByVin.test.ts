import { describe, expect, it, vi } from 'vitest';
import { findPublicVehicleByVin } from './vehicleByVin';

const client = (result: { data: unknown; error: unknown } | Error) => ({
  rpc: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
});

describe('findPublicVehicleByVin', () => {
  it('asks vehicle_by_vin_public for the cleaned, upper-cased VIN', async () => {
    const c = client({ data: [], error: null });
    await findPublicVehicleByVin(' 1gcek14k8ej-123456 ', c);
    expect(c.rpc).toHaveBeenCalledWith('vehicle_by_vin_public', { p_vin: '1GCEK14K8EJ123456' });
  });
  it('returns the first row as the card fields', async () => {
    const c = client({ data: [{ id: 'v1', vin: '1GCEK14K8EJ123456', year: 1984, make: 'Chevrolet', model: 'K5 Blazer', sale_price: 1 }, { id: 'v2' }], error: null });
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', c)).toEqual({ id: 'v1', year: 1984, make: 'Chevrolet', model: 'K5 Blazer' });
  });
  it('keeps a row whose year or name is unknown', async () => {
    const c = client({ data: [{ id: 'v1', year: null, make: null, model: 'Blazer' }], error: null });
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', c)).toEqual({ id: 'v1', year: null, make: null, model: 'Blazer' });
  });
  it('is no match when nothing public carries the VIN, when the read fails or throws, or when the input is empty', async () => {
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', client({ data: [], error: null }))).toBeNull();
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', client({ data: null, error: { message: 'x' } }))).toBeNull();
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', client({ data: { id: 'v1' }, error: null }))).toBeNull();
    expect(await findPublicVehicleByVin('1GCEK14K8EJ123456', client(new Error('network')))).toBeNull();
    const c = client({ data: [{ id: 'v1' }], error: null });
    expect(await findPublicVehicleByVin('  --  ', c)).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled();
  });
});

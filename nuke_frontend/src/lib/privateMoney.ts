import { supabase } from './supabase';

// The owner's money on two tables whose rows every visitor may read. These columns are not granted to
// anon or authenticated (migration 20261014093000_private_money_columns_owner_only): a select that
// names one, filters or orders on one, or selects '*' on the table, fails with a permission error.
// Read them through the two readers below (migration 20261014073000_private_money_readers), which
// return rows to the people who keep those books and no rows to anyone else; one whole vehicles row
// comes from the vehicle_row_read RPC. privateMoney.test.ts fails CI when a read reaches for them.

export const ORGANIZATION_VEHICLE_PRIVATE_COLUMNS = ['cost_basis', 'sale_price', 'asking_price', 'internal_notes'] as const;
export const VEHICLE_PRIVATE_COLUMNS = ['purchase_price', 'purchase_date', 'purchase_location'] as const;

export interface OrganizationVehicleBook {
  id: string;
  vehicle_id: string;
  asking_price: number | null;
  cost_basis: number | null;
  sale_price: number | null;
  internal_notes: string | null;
}

export interface VehicleOwnerBook {
  vehicle_id: string;
  purchase_price: number | null;
  purchase_date: string | null;
  purchase_location: string | null;
}

/**
 * An organization's books on its vehicle links, keyed by organization_vehicles.id: rows for its
 * active owners, managers and board members, an empty map for everyone else (and while signed out).
 */
export async function fetchOrganizationVehicleBooks(organizationId: string): Promise<Map<string, OrganizationVehicleBook>> {
  if (!organizationId || !(await signedIn())) return new Map();
  const { data, error } = await supabase.rpc('organization_vehicle_books', { p_organization_id: organizationId });
  if (error) console.warn('organization_vehicle_books failed; showing no books', error.message);
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as OrganizationVehicleBook[]).map((row) => [row.id, row]));
}

/** The link's money from the books, null where the caller keeps no books for it. */
export function withOrganizationVehicleBook<T extends { id: string }>(row: T, books: Map<string, OrganizationVehicleBook>) {
  const book = books.get(row.id);
  return {
    ...row,
    asking_price: book?.asking_price ?? null,
    cost_basis: book?.cost_basis ?? null,
    sale_price: book?.sale_price ?? null,
  };
}

const OWNER_BOOKS_CHUNK = 500;

/**
 * The owner's purchase facts, keyed by vehicle id: rows for vehicles the caller owns, uploaded or holds
 * access to, an empty map for everyone else (and while signed out).
 */
export async function fetchVehicleOwnerBooks(vehicleIds: string[], signal?: AbortSignal): Promise<Map<string, VehicleOwnerBook>> {
  const ids = Array.from(new Set(vehicleIds.filter(Boolean)));
  if (ids.length === 0 || !(await signedIn())) return new Map();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += OWNER_BOOKS_CHUNK) chunks.push(ids.slice(i, i + OWNER_BOOKS_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => {
    const read = supabase.rpc('vehicle_owner_books', { p_vehicle_ids: chunk });
    return signal ? read.abortSignal(signal) : read;
  }));
  const books = new Map<string, VehicleOwnerBook>();
  for (const { data, error } of results) {
    if (error) console.warn('vehicle_owner_books failed; showing no purchase facts', error.message);
    if (error || !Array.isArray(data)) continue;
    for (const row of data as VehicleOwnerBook[]) books.set(row.vehicle_id, row);
  }
  return books;
}

// Signed-out callers get no books, so skip the round trip; an unreadable session counts as signed out.
async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user?.id);
  } catch {
    return false;
  }
}

import { describe, it, expect } from 'vitest';
import {
  buildVehicleTextSearchOrFilter,
  escapePostgrestILike,
  extractYearFromTextSearch,
} from '../vehicleSearchService';

describe('vehicle search query helpers', () => {
  it('escapes PostgREST ILIKE wildcard characters', () => {
    expect(escapePostgrestILike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('buildVehicleTextSearchOrFilter returns null for empty input', () => {
    expect(buildVehicleTextSearchOrFilter({ text: '' })).toBeNull();
    expect(buildVehicleTextSearchOrFilter({ text: '   ' })).toBeNull();
  });

  it('buildVehicleTextSearchOrFilter normalizes commas/newlines and never includes ::text casts', () => {
    const or = buildVehicleTextSearchOrFilter({ text: 'Ford,\nF-150' });
    expect(or).toBeTruthy();
    expect(or).not.toMatch(/::text/);
    expect(or).not.toMatch(/[\r\n]/);
    // Commas are separators in PostgREST filter syntax; this ensures the *term* itself is safe.
    expect(or).toContain('make.ilike.%Ford%');
    expect(or).toContain('model.ilike.%F-150%');
  });

  it('extractYearFromTextSearch pulls a 4-digit year anywhere in the query', () => {
    expect(extractYearFromTextSearch('1998 Ford')).toEqual({ year: 1998, rest: 'Ford' });
    expect(extractYearFromTextSearch('Ford 1998 F-150')).toEqual({ year: 1998, rest: 'Ford F-150' });
    expect(extractYearFromTextSearch('1998')).toEqual({ year: 1998, rest: '' });
    expect(extractYearFromTextSearch('2200 future')).toEqual({ year: null, rest: '2200 future' });
  });

  it('can include owner matching via user_id/uploaded_by in(...) filters', () => {
    const id1 = '00000000-0000-0000-0000-000000000001';
    const id2 = '00000000-0000-0000-0000-000000000002';
    const or = buildVehicleTextSearchOrFilter({
      text: 'porsche',
      matchingUserIds: [id1, id1, id2],
    })!;
    expect(or).toContain(`user_id.in.(${id1},${id2})`);
    expect(or).toContain(`uploaded_by.in.(${id1},${id2})`);
  });
});


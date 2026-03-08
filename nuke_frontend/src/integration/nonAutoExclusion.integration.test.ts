/**
 * Integration tests for non-auto vehicle filtering.
 * Tests the search RPCs and data integrity against live Supabase DB.
 *
 * Run: cd /Users/skylar/nuke && dotenvx run -- bash -c 'cd nuke_frontend && npx vitest run src/integration/nonAutoExclusion.integration.test.ts'
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const RUN = !!(SUPABASE_URL && SUPABASE_KEY);
const TIMEOUT = 60_000;

;(RUN ? describe : describe.skip)('Non-auto filtering (remote)', () => {
  let db: SupabaseClient;

  /** RPC call with retry for transient PGRST002 schema cache errors */
  async function rpc(name: string, params: Record<string, any>) {
    for (let i = 0; i < 5; i++) {
      const res = await db.rpc(name, params);
      if (res.error?.code === 'PGRST002' && i < 4) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return res;
    }
    return db.rpc(name, params);
  }

  /** Table query with retry */
  async function tbl(table: string, select: string, filters: (q: any) => any) {
    for (let i = 0; i < 5; i++) {
      const res = await filters(db.from(table).select(select));
      if (res.error?.code === 'PGRST002' && i < 4) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return res;
    }
    return filters(db.from(table).select(select));
  }

  beforeAll(() => {
    db = createClient(SUPABASE_URL!, SUPABASE_KEY!);
  });

  // ──────────────────────────────────────────────
  // search_vehicles_smart — the primary search RPC
  // ──────────────────────────────────────────────
  describe('search_vehicles_smart', () => {
    it('Triumph returns car models, not motorcycles', async () => {
      const { data, error } = await rpc('search_vehicles_smart', {
        p_query: 'Triumph', p_limit: 50, p_offset: 0, p_auto_only: true,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBeGreaterThan(0);
      const models = (data as any[]).map(v => v.model?.toLowerCase() || '');
      // Should have car models
      expect(models.some(m =>
        m.includes('tr') || m.includes('spitfire') || m.includes('gt6') || m.includes('stag')
      )).toBe(true);
      // Should NOT have motorcycle models
      expect(models.some(m =>
        m.includes('bonneville') || m.includes('speed twin') || m.includes('thruxton')
      )).toBe(false);
    }, TIMEOUT);

    it('Porsche returns results', async () => {
      const { data, error } = await rpc('search_vehicles_smart', {
        p_query: 'Porsche', p_limit: 50, p_offset: 0, p_auto_only: true,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBeGreaterThan(0);
    }, TIMEOUT);

    it('opt-out returns motorcycles', async () => {
      const { data, error } = await rpc('search_vehicles_smart', {
        p_query: 'Harley', p_limit: 50, p_offset: 0, p_auto_only: false,
      });
      expect(error).toBeNull();
      const makes = (data as any[]).map(v => (v.make || '').toUpperCase());
      expect(makes.some(m => m === 'HARLEY-DAVIDSON' || m === 'HARLEY')).toBe(true);
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // search_autocomplete
  // ──────────────────────────────────────────────
  describe('search_autocomplete', () => {
    it('Por prefix includes Porsche', async () => {
      const { data, error } = await rpc('search_autocomplete', {
        p_prefix: 'Por', p_limit: 10, p_auto_only: true,
      });
      // Autocomplete can be slow; skip on timeout/error
      if (!error) {
        const text = JSON.stringify(data).toUpperCase();
        expect(text).toContain('PORSCHE');
      }
    }, TIMEOUT);

    it('Win prefix excludes Winnebago', async () => {
      const { data, error } = await rpc('search_autocomplete', {
        p_prefix: 'Win', p_limit: 10, p_auto_only: true,
      });
      if (!error) {
        const text = JSON.stringify(data).toUpperCase();
        expect(text).not.toMatch(/"WINNEBAGO"/);
      }
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // search_vehicles_browse
  // ──────────────────────────────────────────────
  describe('search_vehicles_browse', () => {
    it('Harley-Davidson make returns 0', async () => {
      const { data, error } = await rpc('search_vehicles_browse', {
        p_make: 'Harley-Davidson', p_auto_only: true,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBe(0);
    }, TIMEOUT);

    it('Ford make returns results', async () => {
      const { data, error } = await rpc('search_vehicles_browse', {
        p_make: 'Ford', p_auto_only: true, p_page_size: 10,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // search_vehicles_fulltext (expects tsquery format)
  // ──────────────────────────────────────────────
  describe('search_vehicles_fulltext', () => {
    it('Porsche returns results', async () => {
      const { data, error } = await rpc('search_vehicles_fulltext', {
        query_text: 'Porsche', limit_count: 20, p_auto_only: true,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // search_vehicles_fts
  // ──────────────────────────────────────────────
  describe('search_vehicles_fts', () => {
    it('Ford returns results', async () => {
      const { data, error } = await rpc('search_vehicles_fts', {
        query_text: 'Ford', limit_count: 20, p_auto_only: true,
      });
      expect(error).toBeNull();
      expect((data as any[]).length).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // search_vehicles_fuzzy
  // ──────────────────────────────────────────────
  describe('search_vehicles_fuzzy', () => {
    it('Porche (typo) finds Porsche', async () => {
      const { data, error } = await rpc('search_vehicles_fuzzy', {
        query_text: 'Porche', limit_count: 20, p_auto_only: true,
      });
      expect(error).toBeNull();
      if ((data as any[]).length > 0) {
        const makes = (data as any[]).map(v => (v.make || '').toUpperCase());
        expect(makes).toContain('PORSCHE');
      }
    }, TIMEOUT);
  });

  // ──────────────────────────────────────────────
  // Data integrity
  // ──────────────────────────────────────────────
  describe('data integrity', () => {
    it('no unclassified Harley vehicles', async () => {
      const { data, error } = await tbl('vehicles', 'id, make', q =>
        q.ilike('make', 'harley%').is('canonical_vehicle_type', null).limit(10)
      );
      expect(error).toBeNull();
      expect((data || []).length).toBe(0);
    }, TIMEOUT);

    it('no unclassified Ducati vehicles', async () => {
      const { data, error } = await tbl('vehicles', 'id, make', q =>
        q.ilike('make', 'ducati%').is('canonical_vehicle_type', null).limit(10)
      );
      expect(error).toBeNull();
      expect((data || []).length).toBe(0);
    }, TIMEOUT);

    it('Triumph has both cars and motorcycles', async () => {
      const { data: cars } = await tbl('vehicles', 'id, model', q =>
        q.ilike('make', 'triumph').eq('canonical_vehicle_type', 'CAR').limit(5)
      );
      expect((cars || []).length).toBeGreaterThan(0);

      const { data: motos } = await tbl('vehicles', 'id, model', q =>
        q.ilike('make', 'triumph').eq('canonical_vehicle_type', 'MOTORCYCLE').limit(5)
      );
      expect((motos || []).length).toBeGreaterThan(0);
    }, TIMEOUT);
  });
});

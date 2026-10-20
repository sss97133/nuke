// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('./imageUploadService', () => ({ ImageUploadService: {} }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));

describe('global upload queue', () => {
  it('announces itself so the header mounts its indicator (persisted uploads still resume on construction)', async () => {
    const seen = vi.fn();
    window.addEventListener('nuke:upload-queue', seen);
    await import('./globalUploadQueue');
    expect(seen).toHaveBeenCalledTimes(1);
    expect((window as { __nukeUploadQueue?: boolean }).__nukeUploadQueue).toBe(true);
  });
});

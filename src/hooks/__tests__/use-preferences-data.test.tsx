
import { renderHook } from '@testing-library/react';
import { usePreferencesData } from '../use-preferences-data';
import { supabase } from '@/integrations/supabase/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Supabase client and toast
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn()
    },
    from: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn()
    }))
  }
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesData', () => {
  const mockUser = { id: '123', email: 'test@example.com' };
  const defaultPreferences = {
    notifications_enabled: true,
    auto_save_enabled: true,
    compact_view_enabled: false,
    theme: 'system'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset preferences successfully', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().update().eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => usePreferencesData());

    await expect(result.current.handleResetPreferences({ user: mockUser }))
      .resolves
      .toBeUndefined();

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().update).toHaveBeenCalledWith(defaultPreferences);
    expect(supabase.from().update().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should clear data successfully', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().delete().eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => usePreferencesData());

    await expect(result.current.handleClearData({ user: mockUser }))
      .resolves
      .toBeUndefined();

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().delete).toHaveBeenCalled();
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesData());

    await expect(result.current.handleResetPreferences({ user: null }))
      .rejects
      .toThrow('No user found');
      
    await expect(result.current.handleClearData({ user: null }))
      .rejects
      .toThrow('No user found');
  });
});

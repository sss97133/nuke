
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
    (supabase.from as any)().update().eq.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePreferencesData());

    expect(result.current.handleResetPreferences).toBeDefined();
    await result.current.handleResetPreferences({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().update).toHaveBeenCalledWith(defaultPreferences);
    expect(supabase.from().update().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesData());

    expect(result.current.handleResetPreferences).toBeDefined();
    const resetPromise = result.current.handleResetPreferences({ user: null });
    await expect(resetPromise).rejects.toThrow('No user found');
      
    expect(result.current.handleClearData).toBeDefined();
    const clearPromise = result.current.handleClearData({ user: null });
    await expect(clearPromise).rejects.toThrow('No user found');
  });
});

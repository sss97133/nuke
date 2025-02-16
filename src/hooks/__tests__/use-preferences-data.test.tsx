
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset preferences successfully', async () => {
    const defaultPreferences = {
      notifications_enabled: true,
      auto_save_enabled: true,
      compact_view_enabled: false,
      theme: 'system'
    };

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().update().eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => usePreferencesData());
    await result.current.handleResetPreferences({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().update).toHaveBeenCalledWith(defaultPreferences);
    expect(supabase.from().update().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should clear data successfully', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().delete().eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => usePreferencesData());
    await result.current.handleClearData({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().delete).toHaveBeenCalled();
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });
});


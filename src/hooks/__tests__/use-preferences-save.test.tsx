
import { renderHook } from '@testing-library/react';
import { usePreferencesSave } from '../use-preferences-save';
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
      eq: vi.fn()
    }))
  }
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesSave', () => {
  const mockUser = { id: '123', email: 'test@example.com' };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save preferences successfully', async () => {
    const updates = { notifications_enabled: false };

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().update().eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => usePreferencesSave());
    await result.current.savePreferences({ updates, user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().update).toHaveBeenCalledWith(updates);
    expect(supabase.from().update().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesSave());
    await result.current.savePreferences({ updates: { notifications_enabled: false }, user: null });

    // Verify that the update was not attempted
    expect(supabase.from().update).not.toHaveBeenCalled();
  });
});


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
  const mockUpdates = { notifications_enabled: false };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save preferences successfully', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().update().eq.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePreferencesSave(), {
      wrapper: ({ children }) => <div>{children}</div>
    });

    expect(result.current.savePreferences).toBeDefined();
    await result.current.savePreferences({ updates: mockUpdates, user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    expect(supabase.from().update).toHaveBeenCalledWith(mockUpdates);
    expect(supabase.from().update().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesSave(), {
      wrapper: ({ children }) => <div>{children}</div>
    });

    expect(result.current.savePreferences).toBeDefined();
    const savePromise = result.current.savePreferences({ updates: mockUpdates, user: null });
    await expect(savePromise).rejects.toThrow('No user found');
  });
});


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
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((column, value) => {
          // Mock implementation that uses the arguments
          expect(column).toBeDefined();
          expect(value).toBeDefined();
          return Promise.resolve({ data: null, error: null });
        })
      })
    })
  }
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save preferences successfully', async () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };
    const mockUpdates = { notifications_enabled: false };
    
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });

    const { result } = renderHook(() => usePreferencesSave());

    expect(result.current.savePreferences).toBeDefined();
    await result.current.savePreferences({ updates: mockUpdates, user: mockUser });

    // Verify correct method chain with mock data
    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    const updateMock = supabase.from('user_preferences').update;
    expect(updateMock).toHaveBeenCalledWith(mockUpdates);
    expect(updateMock().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesSave());

    expect(result.current.savePreferences).toBeDefined();
    await result.current.savePreferences({ updates: {}, user: null });
  });
});


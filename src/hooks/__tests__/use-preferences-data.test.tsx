
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
    from: vi.fn((table: string) => ({
      update: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => Promise.resolve({ data: null, error: null }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => Promise.resolve({ data: null, error: null }))
      }))
    }))
  }
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset preferences successfully', async () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });

    const { result } = renderHook(() => usePreferencesData());

    expect(result.current.handleResetPreferences).toBeDefined();
    await result.current.handleResetPreferences({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    const updateMock = supabase.from('user_preferences').update;
    expect(updateMock).toHaveBeenCalledWith({
      notifications_enabled: true,
      auto_save_enabled: true,
      compact_view_enabled: false,
      theme: 'system'
    });
    expect(updateMock().eq).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    const { result } = renderHook(() => usePreferencesData());

    expect(result.current.handleResetPreferences).toBeDefined();
    await expect(result.current.handleResetPreferences({ user: null }))
      .rejects.toThrow('No user found');
      
    expect(result.current.handleClearData).toBeDefined();
    await expect(result.current.handleClearData({ user: null }))
      .rejects.toThrow('No user found');
  });
});

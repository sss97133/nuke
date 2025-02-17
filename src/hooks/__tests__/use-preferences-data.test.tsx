
import { renderHook } from '@testing-library/react';
import { usePreferencesData } from '../use-preferences-data';
import { supabase } from '@/integrations/supabase/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
    })
  }
}));

// Mock toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset preferences', async () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };
    const { result } = renderHook(() => usePreferencesData());

    await result.current.handleResetPreferences({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    const updateMock = supabase.from('user_preferences').update;
    expect(updateMock).toHaveBeenCalled();
  });

  it('should clear data', async () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };
    const { result } = renderHook(() => usePreferencesData());

    await result.current.handleClearData({ user: mockUser });

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    const deleteMock = supabase.from('user_preferences').delete;
    expect(deleteMock).toHaveBeenCalled();
  });

  it('should handle missing user for reset preferences', async () => {
    const { result } = renderHook(() => usePreferencesData());
    
    await expect(result.current.handleResetPreferences({ user: null }))
      .rejects.toThrow('No user found');
  });

  it('should handle missing user for clear data', async () => {
    const { result } = renderHook(() => usePreferencesData());
    
    await expect(result.current.handleClearData({ user: null }))
      .rejects.toThrow('No user found');
  });
});

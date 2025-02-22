
import { renderHook } from '@testing-library/react';
import { usePreferencesSave } from '../use-preferences-save';
import { supabase } from '@/integrations/supabase/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn()
    },
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation(() => {
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
  const mockUser = { id: 'test-id', email: 'test@example.com' };
  
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
  });

  it('should save preferences successfully', async () => {
    const mockUpdates = { notifications_enabled: false };
    const { result } = renderHook(() => usePreferencesSave(), { initialProps: undefined });

    expect(result.current.savePreferences).toBeDefined();
    await result.current.savePreferences(mockUpdates);

    expect(supabase.from).toHaveBeenCalledWith('user_preferences');
    const updateMock = supabase.from('user_preferences').update;
    expect(updateMock).toHaveBeenCalledWith(mockUpdates);
    const eqMock = updateMock().eq;
    expect(eqMock).toHaveBeenCalledWith('user_id', mockUser.id);
  });

  it('should handle error when user is not found', async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null }, error: new Error('No user found') });
    
    const { result } = renderHook(() => usePreferencesSave(), { initialProps: undefined });
    const mockUpdates = { notifications_enabled: false };
    
    expect(result.current.savePreferences).toBeDefined();
    await expect(result.current.savePreferences(mockUpdates)).rejects.toThrow('No user found');
  });
});


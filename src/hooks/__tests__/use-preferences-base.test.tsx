import { renderHook, act } from '@testing-library/react';
import { usePreferencesBase } from '../use-preferences-base';
import { supabase } from '@/integrations/supabase/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn()
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn()
        }))
      }))
    }))
  }
}));

// Mock toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

describe('usePreferencesBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load user preferences successfully', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    const mockPreferences = {
      notifications_enabled: true,
      auto_save_enabled: true,
      compact_view_enabled: false,
      theme: 'system',
      distance_unit: 'miles',
      currency: 'USD',
      default_garage_view: 'list',
      service_reminders_enabled: true,
      inventory_alerts_enabled: true,
      price_alerts_enabled: true,
      primary_color: '#9b87f5',
      secondary_color: '#7E69AB',
      accent_color: '#8B5CF6',
      font_family: 'Inter',
      font_size: 'medium'
    };

    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: mockUser }, error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockPreferences, error: null })
        })
      })
    } as any);

    const { result } = renderHook(() => usePreferencesBase());

    // Wait for the effect to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.preferences).toEqual({
      notificationsEnabled: true,
      autoSaveEnabled: true,
      compactViewEnabled: false,
      theme: 'system',
      distanceUnit: 'miles',
      currency: 'USD',
      defaultGarageView: 'list',
      serviceRemindersEnabled: true,
      inventoryAlertsEnabled: true,
      priceAlertsEnabled: true,
      primaryColor: '#9b87f5',
      secondaryColor: '#7E69AB',
      accentColor: '#8B5CF6',
      fontFamily: 'Inter',
      fontSize: 'medium'
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle error when user is not found', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });

    const { result } = renderHook(() => usePreferencesBase());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // When no user is found, we should use default preferences without error
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.preferences).toEqual({
      notificationsEnabled: true,
      autoSaveEnabled: true,
      compactViewEnabled: false,
      theme: 'system',
      distanceUnit: 'miles',
      currency: 'USD',
      defaultGarageView: 'list',
      serviceRemindersEnabled: true,
      inventoryAlertsEnabled: true,
      priceAlertsEnabled: true,
      primaryColor: '#9b87f5',
      secondaryColor: '#7E69AB',
      accentColor: '#8B5CF6',
      fontFamily: 'Inter',
      fontSize: 'medium'
    });
  });

  it('should handle error when fetching preferences fails', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: mockUser }, error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockRejectedValue(new Error('Failed to fetch'))
        })
      })
    } as any);

    const { result } = renderHook(() => usePreferencesBase());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.loading).toBe(false);
    // Should still have default preferences
    expect(result.current.preferences).toEqual({
      notificationsEnabled: true,
      autoSaveEnabled: true,
      compactViewEnabled: false,
      theme: 'system',
      distanceUnit: 'miles',
      currency: 'USD',
      defaultGarageView: 'list',
      serviceRemindersEnabled: true,
      inventoryAlertsEnabled: true,
      priceAlertsEnabled: true,
      primaryColor: '#9b87f5',
      secondaryColor: '#7E69AB',
      accentColor: '#8B5CF6',
      fontFamily: 'Inter',
      fontSize: 'medium'
    });
  });
});


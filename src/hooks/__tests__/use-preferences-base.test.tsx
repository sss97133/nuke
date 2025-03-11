
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
          single: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => Promise.resolve({ data: null, error: null }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
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
      price_alerts_enabled: true
    };

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser } });
    (supabase.from as any)().select().eq('user_id', mockUser.id).maybeSingle.mockResolvedValue({ data: mockPreferences });

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
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => usePreferencesBase());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('No user found. Please sign in again.');
    expect(result.current.loading).toBe(false);
  });
});


import { renderHook, act } from '@testing-library/react';
import { usePreferencesData } from '../use-preferences-data';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TestWrapper } from '../../test/test-utils';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn(() => Promise.resolve({ error: null }))
        }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn(() => Promise.resolve({ error: null }))
        }))
      }))
    }))
  }
}));

// Mock toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn()
  }))
}));

const renderPreferencesHook = (withoutAuth = false) => {
  return renderHook(() => usePreferencesData(), {
    wrapper: ({ children }) => (
      <TestWrapper withoutAuth={withoutAuth}>{children}</TestWrapper>
    )
  });
};

describe('usePreferencesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with unauthenticated user', () => {
    it('should handle missing user for reset preferences', async () => {
      const { result } = renderPreferencesHook(true);
      await act(async () => {
        await expect(result.current.handleResetPreferences({ user: null })).rejects.toThrow('No user found');
      });
    });

    it('should handle missing user for clear data', async () => {
      const { result } = renderPreferencesHook(true);
      await act(async () => {
        await expect(result.current.handleClearData({ user: null })).rejects.toThrow('No user found');
      });
    });
  });

  describe('with authenticated user', () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };

    it('should successfully reset preferences', async () => {
      const { result } = renderPreferencesHook();
      const { supabase } = require('@/integrations/supabase/client');
      const updateMock = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null }))
      }));
      supabase.from.mockReturnValue({ update: updateMock });

      await act(async () => {
        await result.current.handleResetPreferences({ user: mockUser });
      });

      expect(supabase.from).toHaveBeenCalledWith('user_preferences');
      expect(updateMock).toHaveBeenCalledWith({
        notifications_enabled: true,
        auto_save_enabled: true,
        compact_view_enabled: false,
        theme: 'system'
      });
    });

    it('should successfully clear data', async () => {
      const { result } = renderPreferencesHook();
      const { supabase } = require('@/integrations/supabase/client');
      const deleteMock = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null }))
      }));
      supabase.from.mockReturnValue({ delete: deleteMock });

      await act(async () => {
        await result.current.handleClearData({ user: mockUser });
      });

      expect(supabase.from).toHaveBeenCalledWith('user_preferences');
      expect(deleteMock).toHaveBeenCalled();
    });
  });
});

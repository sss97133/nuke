
import { renderHook } from '@testing-library/react';
import { usePreferencesData } from '../use-preferences-data';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TestWrapper } from '../../test/test-utils';

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
      await expect(result.current.handleResetPreferences({ user: null })).rejects.toThrow('No user found');
    });

    it('should handle missing user for clear data', async () => {
      const { result } = renderPreferencesHook(true);
      await expect(result.current.handleClearData({ user: null })).rejects.toThrow('No user found');
    });
  });

  describe('with authenticated user', () => {
    const mockUser = { id: 'test-id', email: 'test@example.com' };

    it('should successfully reset preferences', async () => {
      const { result } = renderPreferencesHook();
      await expect(result.current.handleResetPreferences({ user: mockUser })).resolves.not.toThrow();
    });

    it('should successfully clear data', async () => {
      const { result } = renderPreferencesHook();
      await expect(result.current.handleClearData({ user: mockUser })).resolves.not.toThrow();
    });
  });
});


import { renderHook } from '@testing-library/react';
import { usePreferences } from '../use-preferences';
import { vi, describe, it, expect } from 'vitest';

// Mock the individual hooks
vi.mock('../use-preferences-base', () => ({
  usePreferencesBase: vi.fn(() => ({
    preferences: {
      notificationsEnabled: true,
      autoSaveEnabled: true,
      compactViewEnabled: false
    },
    loading: false,
    error: null
  }))
}));

vi.mock('../use-preferences-save', () => ({
  usePreferencesSave: vi.fn(() => ({
    savePreferences: vi.fn()
  }))
}));

vi.mock('../use-preferences-data', () => ({
  usePreferencesData: vi.fn(() => ({
    handleResetPreferences: vi.fn(),
    handleClearData: vi.fn()
  }))
}));

describe('usePreferences', () => {
  it('should combine all hooks correctly', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current).toHaveProperty('preferences');
    expect(result.current).toHaveProperty('loading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('savePreferences');
    expect(result.current).toHaveProperty('handleResetPreferences');
    expect(result.current).toHaveProperty('handleClearData');
  });

  it('should provide the correct initial values', () => {
    const { result } = renderHook(() => usePreferences());

    expect(result.current.preferences).toEqual({
      notificationsEnabled: true,
      autoSaveEnabled: true,
      compactViewEnabled: false
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});


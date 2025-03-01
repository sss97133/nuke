
import { vi } from 'vitest';

// Mock studio configuration
export const mockStudioConfig = {
  id: 'test-studio-1',
  name: 'Test Studio',
  width: 1920,
  height: 1080,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ptzCamera: {
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    zoom: 1
  }
};

// Mock user
export const mockUser = {
  id: 'test-user-1',
  name: 'Test User',
  email: 'test@example.com'
};

// Mock functions
export const mockSaveStudioConfig = vi.fn();
export const mockFetchStudioConfig = vi.fn().mockResolvedValue(mockStudioConfig);

// Mock the studio config hook
export const mockUseStudioConfig = () => ({
  studioConfig: mockStudioConfig,
  saveStudioConfig: mockSaveStudioConfig,
  isLoading: false,
  error: null,
  fetchStudioConfig: mockFetchStudioConfig
});

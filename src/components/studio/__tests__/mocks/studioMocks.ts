
import { vi } from 'vitest';
import { mockUser, mockStudioConfig } from '../utils/testUtils';

// Mock functions
export const mockSaveStudioConfig = vi.fn().mockResolvedValue({ success: true });
export const mockFetchStudioConfig = vi.fn().mockResolvedValue(mockStudioConfig);
export const mockFetchUserProfile = vi.fn().mockResolvedValue(mockUser);

// Mock hooks returns
export const mockUseStudioConfig = () => ({
  studioConfig: mockStudioConfig,
  isLoading: false,
  error: null,
  saveStudioConfig: mockSaveStudioConfig
});

// Mock components
export const MockWorkspace = ({ children }: { children: React.ReactNode }) => (
  <div data-testid="mock-workspace">{children}</div>
);

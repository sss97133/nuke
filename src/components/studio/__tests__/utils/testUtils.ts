
// This file contains utility functions for testing studio components
import { render, RenderOptions } from '@testing-library/react';
import React, { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock data for tests
export const mockUser = {
  data: {
    user: {
      id: 'test-user-id',
      email: 'test@example.com'
    }
  },
  error: null
};

export const mockStudioConfig = {
  name: 'Test Studio',
  workspace_dimensions: { width: 20, length: 30, height: 16 },
  camera_config: { fov: 45, position: [0, 2, 5] },
  audio_config: { gain: 0.8 },
  lighting_config: { ambient: 0.5, key: 0.8 }
};

// Create a custom render function that includes react-query provider
export const renderWithQueryClient = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
  
  return render(ui, { wrapper, ...options });
};

// Re-export everything from testing-library
export * from '@testing-library/react';

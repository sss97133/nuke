
import { render, RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Create a custom render function that includes providers
export function renderWithQueryClient(
  ui: React.ReactElement,
  options: { queryClient?: QueryClient } = {}
): RenderResult {
  const queryClient = options.queryClient || new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    ),
    queryClient,
  };
}

// Mock data for tests
export const mockUser = {
  data: {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    }
  },
  error: null
};

export const mockStudioConfig = {
  id: 'config-1',
  user_id: 'test-user-id',
  dimensions: {
    length: 30,
    width: 20,
    height: 16
  },
  ptz_tracks: [
    { id: 1, name: 'Track 1', positions: [] }
  ],
  created_at: '2023-06-15T12:00:00Z'
};

export const mockStudioScene = {
  cameras: [
    { id: 'cam1', type: 'ptz', position: { x: 0, y: 0, z: 0 } },
    { id: 'cam2', type: 'fixed', position: { x: 10, y: 0, z: 0 } },
  ],
  lights: [
    { id: 'light1', type: 'spot', intensity: 1.0 },
    { id: 'light2', type: 'ambient', intensity: 0.5 },
  ],
};

// Test utilities
export const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export const generateMockId = (): string => 
  Math.random().toString(36).substring(2, 9);


import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Create a custom render function that includes providers
export function renderWithProviders<T>(
  ui: React.ReactElement,
  options: { queryClient?: QueryClient } = {}
) {
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
export const mockStudioConfig = {
  dimensions: {
    width: 1920,
    height: 1080,
  },
  ptz: {
    enabled: true,
    positions: [
      { id: 1, name: 'Position 1', pan: 0, tilt: 0, zoom: 1 },
      { id: 2, name: 'Position 2', pan: 45, tilt: 10, zoom: 1.5 },
    ],
  },
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
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateMockId = () => Math.random().toString(36).substring(2, 9);


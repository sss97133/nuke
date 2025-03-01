
import React, { ReactElement } from 'react';
import { render, RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import { StudioConfiguration as StudioConfigType } from '@/types/studio';

// Mock user and config objects
export const mockUser = {
  data: {
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      role: 'user'
    }
  },
  error: null
};

export const mockStudioConfig: StudioConfigType = {
  id: '1',
  name: 'Test Studio',
  workspace_dimensions: {
    length: 30,
    width: 20,
    height: 16
  },
  ptz_configurations: {
    tracks: [
      {
        position: { x: 0, y: 0, z: 0 },
        length: 10,
        speed: 5,
        coneAngle: 45
      }
    ],
    planes: {
      walls: [],
      ceiling: {}
    },
    roboticArms: []
  }
};

// Helper to render components with query client
export const renderWithQueryClient = (
  ui: ReactElement,
  options?: {
    queryClient?: QueryClient;
    route?: string;
  }
): RenderResult => {
  const queryClient = options?.queryClient || new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options?.route || '/']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  
  return render(ui, { wrapper });
};

// Test utility functions
export const expectToBeInTheDocument = (element: HTMLElement) => {
  expect(element).toBeDefined();
  expect(element).not.toBeNull();
};

export const expectNotToBeInTheDocument = (element: HTMLElement | null) => {
  expect(element).toBeNull();
};


import React, { ReactElement } from 'react';
import { render, RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';

interface StudioConfig {
  id: string;
  name: string;
  workspace_dimensions: {
    length: number;
    width: number;
    height: number;
  };
  equipment?: {
    cameras: Array<{
      id: string;
      name: string;
      type: string;
      position: {
        x: number;
        y: number;
        z: number;
      };
    }>;
    lightSources: Array<any>;
    audioDevices: Array<any>;
    surfaces: {
      floor: any;
      walls: any;
      ceiling: any;
    };
    roboticArms: Array<any>;
  };
}

// Mock user and config objects
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: {
    name: 'Test User'
  }
};

export const mockUserResponse = {
  data: { user: mockUser },
  error: null
};

export const mockStudioConfig: StudioConfig = {
  id: '1',
  name: 'Test Studio',
  workspace_dimensions: {
    length: 30,
    width: 20,
    height: 16
  },
  equipment: {
    cameras: [
      {
        id: 'camera-1',
        name: 'Main Camera',
        type: 'PTZ',
        position: { x: 15, y: 10, z: 5 }
      }
    ],
    lightSources: [],
    audioDevices: [],
    surfaces: {
      floor: {},
      walls: {},
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
        cacheTime: 0,
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

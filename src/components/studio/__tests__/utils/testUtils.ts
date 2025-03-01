
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Use more generic types if specific types are causing issues
interface User {
  id: string;
  email: string;
  [key: string]: any;
}

interface WorkspaceDimensions {
  length: number;
  width: number;
  height: number;
}

interface PTZTrack {
  position: { x: number; y: number; z: number };
  length: number;
  speed: number;
  coneAngle: number;
}

interface StudioConfiguration {
  id: string;
  name: string;
  workspace_dimensions: WorkspaceDimensions;
  ptz_configurations: {
    tracks: PTZTrack[];
    planes: {
      walls: any[];
      ceiling: Record<string, unknown>;
    };
    roboticArms: any[];
  };
}

export const createMockUser = (overrides: Partial<User> = {}): User => {
  return {
    id: overrides.id || 'test-user-id',
    email: overrides.email || `test-${Math.random().toString(36).substring(7)}@example.com`,
    ...overrides
  };
};

export const createMockStudioConfig = (overrides: Partial<StudioConfiguration> = {}): StudioConfiguration => {
  return {
    id: overrides.id || 'test-config-id',
    name: overrides.name || 'Test Studio Configuration',
    workspace_dimensions: {
      length: 30,
      width: 20,
      height: 16,
      ...overrides.workspace_dimensions
    },
    ptz_configurations: {
      tracks: overrides.ptz_configurations?.tracks || [{
        position: { x: 0, y: 8, z: 0 },
        length: 10,
        speed: 1,
        coneAngle: 45
      }],
      planes: overrides.ptz_configurations?.planes || { 
        walls: [], 
        ceiling: {} 
      },
      roboticArms: overrides.ptz_configurations?.roboticArms || []
    }
  };
};

export const renderWithProviders = (
  ui: React.ReactElement, 
  options?: {
    queryClientOptions?: ConstructorParameters<typeof QueryClient>[0],
    renderOptions?: RenderOptions,
    additionalWrappers?: React.ComponentType<{children: React.ReactNode}>[]
  }
) => {
  const {
    queryClientOptions = {},
    renderOptions = {},
    additionalWrappers = []
  } = options || {};

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        ...queryClientOptions.defaultOptions?.queries
      }
    },
    ...queryClientOptions
  });

  const Wrapper: React.FC<{children: React.ReactNode}> = ({ children }) => {
    let wrappedChildren = (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </QueryClientProvider>
    );

    for (const Provider of [...additionalWrappers].reverse()) {
      wrappedChildren = <Provider>{wrappedChildren}</Provider>;
    }

    return wrappedChildren;
  };

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

export const mockUser = createMockUser();
export const mockStudioConfig = createMockStudioConfig();

// For backward compatibility with existing tests
export const renderWithQueryClient = (ui: React.ReactElement) => {
  return renderWithProviders(ui);
};

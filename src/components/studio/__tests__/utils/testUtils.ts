
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { PTZTrack, WorkspaceDimensions, StudioConfiguration } from '@/types/studio';

// Interface for User if not already defined
interface User {
  id: string;
  email: string;
  // Add other user properties as needed
}

// Factory function for creating mock user data
export const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: overrides.id || 'test-user-id',
  email: overrides.email || `test-${Math.random().toString(36).substring(7)}@example.com`,
  // Add other default user properties
  ...overrides
});

// Factory function for creating mock studio configurations
export const createMockStudioConfig = (overrides: Partial<StudioConfiguration> = {}): StudioConfiguration => ({
  id: overrides.id || 'test-config-id',
  name: overrides.name || 'Test Studio Configuration',
  workspace_dimensions: {
    length: 30,
    width: 20,
    height: 16,
    ...(overrides.workspace_dimensions || {})
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
});

// Enhanced render function with more flexible options
export const renderWithProviders = (
  ui: React.ReactElement, 
  options: {
    queryClientOptions?: Partial<ConstructorParameters<typeof QueryClient>[0]>,
    renderOptions?: Omit<RenderOptions, 'wrapper'>,
    additionalWrappers?: React.ComponentType<{children: React.ReactNode}>[]
  } = {}
) => {
  const {
    queryClientOptions = {},
    renderOptions = {},
    additionalWrappers = []
  } = options;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        ...(queryClientOptions.defaultOptions?.queries || {})
      }
    },
    ...queryClientOptions
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    // Start with the base providers
    let wrappedChildren: React.ReactNode = (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </QueryClientProvider>
    );

    // Apply additional wrappers from right to left
    for (const Provider of [...additionalWrappers].reverse()) {
      wrappedChildren = <Provider>{wrappedChildren}</Provider>;
    }

    return wrappedChildren;
  };

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Predefined mock instances for quick access
export const mockUser = {
  data: {
    user: createMockUser()
  },
  error: null
};

export const mockStudioConfig = createMockStudioConfig();

// For backward compatibility with existing tests
export const renderWithQueryClient = (ui: React.ReactElement) => {
  return renderWithProviders(ui);
};

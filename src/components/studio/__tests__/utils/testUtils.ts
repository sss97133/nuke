
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { PTZTrack, WorkspaceDimensions } from '@/types/studio';

// Mock user data for testing
export const mockUser = {
  data: {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    }
  },
  error: null
};

// Mock studio configuration data
export const mockStudioConfig = {
  id: 'test-config-id',
  name: 'Test Studio Configuration',
  workspace_dimensions: {
    length: 30,
    width: 20,
    height: 16
  },
  ptz_configurations: {
    tracks: [{
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45
    }],
    planes: { walls: [], ceiling: {} },
    roboticArms: []
  }
};

// Helper function to render components with QueryClient for testing
export const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {ui}
      </BrowserRouter>
    </QueryClientProvider>
  );
};

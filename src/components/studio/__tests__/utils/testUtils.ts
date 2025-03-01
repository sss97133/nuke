
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  app_metadata: {
    provider: 'email',
  },
  user_metadata: {
    full_name: 'Test User',
  },
};

export const renderWithQueryClient = (ui: React.ReactElement) => {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={testQueryClient}>
      {ui}
    </QueryClientProvider>
  );
};

// Mock for studio config
export const mockStudioConfig = {
  id: 'studio-config-id',
  name: 'Test Studio',
  workspace_dimensions: { width: 400, height: 300, length: 500 },
  camera_config: { 
    camera_type: 'fixed',
    position: { x: 0, y: 0, z: 0 }
  },
  audio_config: {
    microphone_type: 'condenser',
    audio_input: 'xlr'
  },
  lighting_config: {
    primary_light: 'key',
    secondary_light: 'fill'
  },
  ptz_configurations: {
    planes: {
      walls: [],
      ceiling: {}
    },
    tracks: [],
    roboticArms: []
  },
  fixed_cameras: {
    positions: []
  },
  user_id: 'test-user-id',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

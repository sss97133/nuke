
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, vi } from 'vitest';

// Mock types since we can't import from the actual types
interface StudioConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  cameras: CameraConfig[];
}

interface CameraConfig {
  id: string;
  type: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
}

interface User {
  id: string;
  name: string;
  email: string;
}

// Mock data
export const mockUser: User = {
  id: '1',
  name: 'Test User',
  email: 'test@example.com'
};

export const mockStudioConfig: StudioConfig = {
  id: '1',
  name: 'Test Studio',
  width: 800,
  height: 600,
  cameras: [
    {
      id: '1',
      type: 'PTZ',
      position: { x: 0, y: 0, z: 0 }
    }
  ]
};

// Utility to render with QueryClient
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
      {ui}
    </QueryClientProvider>
  );
};

// Test assertions
export const assertElementExists = (element: HTMLElement | null) => {
  expect(element).not.toBeNull();
};

export const assertElementHasText = (element: HTMLElement | null, text: string) => {
  expect(element?.textContent).toContain(text);
};

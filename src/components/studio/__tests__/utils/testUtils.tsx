
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, expect } from 'vitest';

// Type definitions
export interface StudioConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  ptzCamera: CameraConfig;
}

export interface CameraConfig {
  x: number;
  y: number;
  z: number;
  rotation: number;
  zoom: number;
}

// Mock data
export const mockUser = {
  id: 'test-user-1',
  name: 'Test User',
  email: 'test@example.com'
};

export const mockStudioConfig: StudioConfig = {
  id: 'test-studio-1',
  name: 'Test Studio',
  width: 1920,
  height: 1080,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ptzCamera: {
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    zoom: 1
  }
};

// Function to create a wrapper with QueryClientProvider
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
  logger: {
    log: console.log,
    warn: console.warn,
    error: () => {},
  },
});

// Render with query client
export function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  const { rerender, ...result } = render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
  
  return {
    ...result,
    rerender: (rerenderUi: React.ReactElement) =>
      rerender(
        <QueryClientProvider client={testQueryClient}>{rerenderUi}</QueryClientProvider>
      ),
  };
}

// Test utilities for assertions
export const assertElementExists = (element: HTMLElement | null) => {
  expect(element).not.toBeNull();
};

export const assertTextContent = (element: HTMLElement | null, text: string) => {
  expect(element).toHaveTextContent(text);
};


import React, { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// Mock user and config objects
export const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
};

export const mockStudioConfig = {
  id: '1',
  userId: 'test-user-id',
  name: 'Test Studio',
  width: 800,
  height: 600,
  cameras: [
    {
      id: '1',
      name: 'Main Camera',
      type: 'ptz',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      isPTZ: true,
      isRecording: false,
      isLive: false,
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Helper to render components with query client
export const renderWithQueryClient = (
  ui: ReactElement,
  options?: {
    queryClient?: QueryClient;
    route?: string;
  }
) => {
  const queryClient = options?.queryClient || new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options?.route || '/']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  
  return {
    ...render(ui, { wrapper: Wrapper }),
    queryClient,
  };
};

// Vitest helper functions
export const expectToExist = (element: HTMLElement | null) => {
  if (!element) throw new Error('Element not found');
  return element;
};

export const expectTextContent = (element: HTMLElement | null, text: string) => {
  if (!element) throw new Error('Element not found');
  expect(element.textContent).toContain(text);
};

// Mock implementation of Vitest's render function since we're stubbing out the imports
function render(ui: ReactElement, options?: { wrapper: React.FC<{children: React.ReactNode}> }) {
  const Wrapper = options?.wrapper || React.Fragment;
  
  const container = document.createElement('div');
  document.body.appendChild(container);
  
  React.render(<Wrapper>{ui}</Wrapper>, container);
  
  return {
    container,
    unmount: () => {
      React.unmountComponentAtNode(container);
      document.body.removeChild(container);
    },
  };
}

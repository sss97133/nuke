import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext } from '../contexts/auth-context';
import { ToastContext } from '../contexts/toast-context';
import { mockThree } from './three-mock';
import { Toaster } from '@/components/ui/toaster';

// Mock Three.js
vi.mock('three', () => mockThree);

// Mock data for tests
const mockPreferences = {
  id: 'mock-preferences-id',
  user_id: 'mock-user-id',
  theme: 'dark',
  notifications_enabled: true,
  last_updated: '2025-01-01T00:00:00Z'
};

// Mock Supabase client
export const mockSupabaseClient = {
  from: (table: string) => ({
    select: (columns: string = '*') => ({
      eq: (column: string, value: any) => ({
        single: () => Promise.resolve({
          data: table === 'preferences' ? mockPreferences : null,
          error: null
        }),
        maybeSingle: () => Promise.resolve({
          data: table === 'preferences' ? mockPreferences : null,
          error: null
        })
      })
    }),
    insert: (data: any) => ({
      select: () => Promise.resolve({
        data: { ...mockPreferences, ...data },
        error: null
      })
    }),
    update: (data: any) => ({
      eq: (column: string, value: any) => Promise.resolve({
        data: { ...mockPreferences, ...data },
        error: null
      })
    }),
    delete: () => ({
      eq: (column: string, value: any) => Promise.resolve({
        data: null,
        error: null
      })
    })
  }),
  auth: {
    getUser: () => Promise.resolve({
      data: {
        user: {
          id: 'mock-user-id',
          email: 'mock-user@test.local',
          role: 'authenticated'
        }
      },
      error: null
    }),
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      // Simulate initial auth state
      callback('SIGNED_IN', {
        user: {
          id: 'mock-user-id',
          email: 'mock-user@test.local',
          role: 'authenticated'
        }
      });
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
  }
};

// Create a new QueryClient instance for tests
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Mock auth context
const mockAuthContext = {
  user: {
    id: 'mock-user-id',
    email: 'mock-user@test.local',
    role: 'authenticated'
  },
  isLoading: false,
  isAuthenticated: true
};

// Mock toast context
const mockToast = {
  toast: ({ title }: { title: string; description?: string; variant?: 'default' | 'destructive' }) => console.log('Toast:', title)
};

// Wrapper component for tests
interface WrapperProps {
  children: ReactNode;
  withoutAuth?: boolean;
}

export function TestWrapper({ children, withoutAuth = false }: WrapperProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastContext.Provider value={mockToast}>
          {withoutAuth ? children : (
            <AuthContext.Provider value={mockAuthContext}>
              {children}
            </AuthContext.Provider>
          )}
        </ToastContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Custom render function that includes providers
export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuthContext}>
          {ui}
          <Toaster />
        </AuthContext.Provider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

// Setup WebGL mock
export function setupWebGLMock() {
  const mockWebGLContext = {
    getExtension: () => null,
    getParameter: () => null,
    getShaderPrecisionFormat: () => ({
      precision: 1,
      rangeMin: 1,
      rangeMax: 1
    }),
    canvas: document.createElement('canvas'),
    drawingBufferWidth: 0,
    drawingBufferHeight: 0
  } as unknown as WebGLRenderingContext;

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => mockWebGLContext
  );
}

export * from '@testing-library/react';


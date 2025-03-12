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
vi.mock('three', () => ({
  Scene: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    background: null,
  })),
  PerspectiveCamera: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn() },
    lookAt: vi.fn(),
  })),
  WebGLRenderer: vi.fn().mockImplementation(() => ({
    setSize: vi.fn(),
    render: vi.fn(),
    domElement: document.createElement('canvas'),
    shadowMap: { enabled: false },
  })),
  LineBasicMaterial: vi.fn().mockImplementation(() => ({})),
  BoxGeometry: vi.fn().mockImplementation(() => ({})),
  EdgesGeometry: vi.fn().mockImplementation(() => ({})),
  LineSegments: vi.fn().mockImplementation(() => ({})),
  Vector3: vi.fn().mockImplementation(() => ({ set: vi.fn() })),
  OrbitControls: vi.fn().mockImplementation(() => ({
    enableDamping: false,
    dampingFactor: 0,
    update: vi.fn(),
  })),
  Color: vi.fn().mockImplementation((color) => ({ color })),
}));

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

// Mock Supabase configuration
vi.mock("../integrations/supabase/client", () => {
  const mockSupabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      execute: vi.fn().mockImplementation(async () => {
        // Mock different responses based on the table being queried
        const table = mockSupabase.from.mock.calls[0][0];
        if (table === 'garages') {
          return {
            data: [
              { id: 1, name: 'Test Garage 1', description: 'Test Description 1' },
              { id: 2, name: 'Test Garage 2', description: 'Test Description 2' }
            ],
            error: null
          };
        } else if (table === 'studio_configurations') {
          return {
            data: [{
              id: 1,
              name: 'Test Studio',
              description: 'Test Studio Description',
              room_width: 10,
              room_height: 8,
              room_depth: 12,
              camera_height: 1.8,
              ptz_enabled: true,
              ptz_speed: 0.5,
              ptz_sensitivity: 0.7
            }],
            error: null
          };
        }
        return { data: [], error: null };
      }),
    }),
  };
  return { supabase: mockSupabase };
});

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

// Setup test environment
beforeAll(() => {
  // Mock window properties used by Three.js
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 1,
    writable: true
  });

  // Mock requestAnimationFrame
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);

  // Setup WebGL mock
  setupWebGLMock();

  // Reset all mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });
});

export * from '@testing-library/react';


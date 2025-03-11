/** @jest-environment jsdom */
import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { queryClient, mockSupabaseClient, setupWebGLMock } from './test-utils';

// Mock Vite's import.meta.env
vi.mock('vite', () => ({
  default: {
    env: {
      VITE_ENV: 'test',
      VITE_SUPABASE_URL: 'mock-supabase-url',
      VITE_SUPABASE_ANON_KEY: 'mock-anon-key'
    }
  }
}));

// Mock environment module
vi.mock('../config/environment', async () => {
  return {
    config: {
      supabaseUrl: 'mock-supabase-url',
      supabaseAnonKey: 'mock-anon-key',
      environment: 'test',
      isDevelopment: false,
      isTest: true,
      isProduction: false
    }
  };
});

// Mock Supabase
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabaseClient
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Three.js
vi.mock('three', () => ({
  WebGLRenderer: vi.fn(() => ({
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
    shadowMap: {
      enabled: false
    }
  })),
  Scene: vi.fn(),
  PerspectiveCamera: vi.fn(() => ({
    position: { set: vi.fn() },
    lookAt: vi.fn(),
    up: { set: vi.fn() },
  })),
  Vector3: vi.fn(() => ({
    set: vi.fn(),
  })),
  Quaternion: vi.fn(() => ({
    setFromUnitVectors: vi.fn(),
    clone: vi.fn(() => ({
      invert: vi.fn(),
    })),
  })),
  LineBasicMaterial: vi.fn(() => ({
    color: 0x444444,
    linewidth: 1,
  })),
  BufferGeometry: vi.fn(),
  Line: vi.fn(),
  Box3: vi.fn(),
  Color: vi.fn(),
  Mesh: vi.fn(),
  MeshBasicMaterial: vi.fn(),
  BoxGeometry: vi.fn(),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn(),
  GridHelper: vi.fn(),
  Clock: vi.fn(() => ({
    getElapsedTime: () => 0
  }))
}));

// Mock OrbitControls
vi.mock('three/examples/jsm/controls/OrbitControls', () => ({
  OrbitControls: vi.fn(() => ({
    enableDamping: true,
    update: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// Mock window URL methods
window.URL.createObjectURL = vi.fn(() => 'mock-url');
window.URL.revokeObjectURL = vi.fn();

// Mock ResizeObserver
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

beforeAll(() => {
  setupWebGLMock();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  queryClient.clear();
});

afterAll(() => {
  vi.resetAllMocks();
});


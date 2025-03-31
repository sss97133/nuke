import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';
import { Session } from '@supabase/supabase-js';

// Mock browser APIs
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// Mock ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserver;

// Mock Supabase client
interface SupabaseAuthCallback {
  (event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED', session: Session | null): void;
}

interface SupabaseQueryOptions {
  eq?: (column: string, value: unknown) => {
    eq?: (column: string, value: unknown) => {
      single: () => Promise<{ data: unknown | null; error: Error | null }>;
      execute: () => Promise<{ data: unknown[]; count: number; error: Error | null }>;
    };
    single: () => Promise<{ data: unknown | null; error: Error | null }>;
    execute: () => Promise<{ data: unknown[]; count: number; error: Error | null }>;
  };
}

interface SupabaseTable {
  select: (columns: string, options?: SupabaseQueryOptions) => {
    eq: (column: string, value: unknown) => {
      eq: (column: string, value: unknown) => {
        single: () => Promise<{ data: unknown | null; error: Error | null }>;
        execute: () => Promise<{ data: unknown[]; count: number; error: Error | null }>;
      };
      single: () => Promise<{ data: unknown | null; error: Error | null }>;
      execute: () => Promise<{ data: unknown[]; count: number; error: Error | null }>;
    };
    single: () => Promise<{ data: unknown | null; error: Error | null }>;
    execute: () => Promise<{ data: unknown[]; count: number; error: Error | null }>;
  };
  insert: (data: Record<string, unknown>) => {
    select: () => Promise<{ data: unknown | null; error: Error | null }>;
  };
  update: (data: Record<string, unknown>) => {
    eq: () => Promise<{ data: unknown | null; error: Error | null }>;
  };
  delete: () => {
    eq: () => Promise<{ data: unknown | null; error: Error | null }>;
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: (callback: SupabaseAuthCallback) => {
        callback('SIGNED_OUT', null);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: () => Promise.resolve({ error: null })
    },
    from: (table: string): SupabaseTable => ({
      select: (columns: string, options?: SupabaseQueryOptions) => ({
        eq: (column: string, value: unknown) => ({
          eq: (column: string, value: unknown) => ({
            single: () => Promise.resolve({ data: null, error: null }),
            execute: () => Promise.resolve({ data: [], count: 0, error: null })
          }),
          single: () => Promise.resolve({ data: null, error: null }),
          execute: () => Promise.resolve({ data: [], count: 0, error: null })
        }),
        single: () => Promise.resolve({ data: null, error: null }),
        execute: () => Promise.resolve({ data: [], count: 0, error: null })
      }),
      insert: (data: Record<string, unknown>) => ({
        select: () => Promise.resolve({ data: null, error: null })
      }),
      update: (data: Record<string, unknown>) => ({
        eq: () => Promise.resolve({ data: null, error: null })
      }),
      delete: () => ({
        eq: () => Promise.resolve({ data: null, error: null })
      })
    })
  })
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => {
  const actual = vi.importActual('react-router-dom');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
    useParams: () => ({}),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => React.createElement('a', { href: to }, children)
  };
});

// Mock three.js
vi.mock('three', () => {
  class Vector3Mock {
    x: number;
    y: number;
    z: number;

    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    clone() {
      return new Vector3Mock(this.x, this.y, this.z);
    }
  }

  class ColorMock {
    r: number;
    g: number;
    b: number;

    constructor(r = 0, g = 0, b = 0) {
      this.r = r;
      this.g = g;
      this.b = b;
    }

    setHex(hex: number) {
      this.r = (hex >> 16) & 255;
      this.g = (hex >> 8) & 255;
      this.b = hex & 255;
      return this;
    }
  }

  return {
    Scene: class Scene {
      userData = {};
      background: ColorMock | null = null;
      add() {}
      remove() {}
    },
    PerspectiveCamera: class PerspectiveCamera {
      position = {
        set: vi.fn(),
        clone: () => ({ x: 0, y: 0, z: 0 })
      };
      lookAt = vi.fn();
      zoom = 1;
    },
    WebGLRenderer: class WebGLRenderer {
      setSize() {}
      render() {}
      domElement = document.createElement('canvas');
    },
    Vector3: Vector3Mock,
    Color: ColorMock
  };
});

// Mock OrbitControls
vi.mock('three/examples/jsm/controls/OrbitControls', () => {
  class OrbitControlsMock {
    target: { clone: () => { x: number; y: number; z: number } };
    object: {
      position: { clone: () => { x: number; y: number; z: number } };
      zoom: number;
    };

    constructor() {
      this.target = { clone: () => ({ x: 0, y: 0, z: 0 }) };
      this.object = {
        position: { clone: () => ({ x: 0, y: 0, z: 0 }) },
        zoom: 1
      };
    }

    update() {}
    addEventListener() {}
    removeEventListener() {}
    dispose() {}
  }

  return {
    OrbitControls: OrbitControlsMock
  };
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});


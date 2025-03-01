
import { render, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect } from "vitest";

// Define the types directly in this file since the imports are failing
interface StudioConfig {
  id: string;
  name: string;
  dimensions: {
    width: number;
    length: number;
    height: number;
  };
  cameras: CameraConfig[];
  createdAt: string;
  updatedAt: string;
  userId: string;
}

interface CameraConfig {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  settings: {
    zoom: number;
    focus: number;
    aperture: number;
  };
  ptz: {
    panRange: { min: number; max: number };
    tiltRange: { min: number; max: number };
    zoomRange: { min: number; max: number };
    presets: Array<{
      id: string;
      name: string;
      pan: number;
      tilt: number;
      zoom: number;
    }>;
  };
}

// Mock user data
export const mockUser = {
  data: {
    user: {
      id: "test-user-123",
      email: "test@example.com",
    }
  },
  error: null
};

// Create a mock studio configuration
export const mockStudioConfig: StudioConfig = {
  id: "test-studio-config-1",
  name: "Test Studio",
  dimensions: {
    width: 20,
    length: 30,
    height: 16,
  },
  cameras: [
    {
      id: "camera-1",
      name: "Main Camera",
      type: "PTZ",
      position: { x: 0, y: 100, z: 200 },
      rotation: { x: 0, y: 0, z: 0 },
      settings: {
        zoom: 1,
        focus: 0.5,
        aperture: 2.8,
      },
      ptz: {
        panRange: { min: -180, max: 180 },
        tiltRange: { min: -90, max: 90 },
        zoomRange: { min: 1, max: 10 },
        presets: [
          { id: "preset-1", name: "Wide Shot", pan: 0, tilt: 0, zoom: 1 },
          { id: "preset-2", name: "Close-up", pan: 0, tilt: 0, zoom: 5 },
        ],
      },
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: "test-user-123",
};

// Setup a testing query client
export const renderWithQueryClient = (ui: ReactElement): RenderResult => {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
};

// Helper functions for test assertions
export const testUtils = {
  expectToBeInTheDocument: (element: HTMLElement) => {
    return expect(element).toBeInTheDocument();
  },
  
  expectTextContent: (element: HTMLElement, text: string) => {
    return expect(element.textContent).toBe(text);
  },
};

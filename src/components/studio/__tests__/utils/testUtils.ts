
import { render, screen, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";
import { StudioConfig, CameraConfig } from "../../../../types/studio";

/**
 * Renders the component with any required providers
 */
export function renderWithProviders(
  ui: ReactElement, 
  { 
    wrappers = [],
    ...renderOptions 
  }: { 
    wrappers?: Array<(ui: ReactElement) => ReactElement>;
    [key: string]: any;
  } = {}
): RenderResult {
  // Apply all wrappers from outside to inside
  const wrappedComponent = wrappers.reduce(
    (wrapped, wrapper) => wrapper(wrapped),
    ui
  );
  
  return render(wrappedComponent, renderOptions);
}

/**
 * Creates a mock studio configuration object for testing
 */
export function createMockStudioConfig(): StudioConfig {
  return {
    id: "test-studio-config-1",
    name: "Test Studio Config",
    dimensions: {
      width: 600,
      length: 800,
      height: 300,
    },
    cameras: [
      createMockCameraConfig({ id: "camera-1", name: "Main Camera" }),
      createMockCameraConfig({ id: "camera-2", name: "Secondary Camera" }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: "test-user-123",
  };
}

/**
 * Creates a mock camera configuration for testing
 */
export function createMockCameraConfig(
  overrides: Partial<CameraConfig> = {}
): CameraConfig {
  return {
    id: "test-camera-1",
    name: "Test Camera",
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
    ...overrides,
  };
}

/**
 * Helper functions for test assertions
 */
export const testUtils = {
  expectToBeInTheDocument: (element: HTMLElement) => {
    expect(element).toBeInTheDocument();
  },
  
  expectTextContent: (element: HTMLElement, text: string) => {
    expect(element.textContent).toBe(text);
  },
};

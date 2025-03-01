
// This file contains utility functions for testing studio components
import { render, RenderOptions } from '@testing-library/react';
import React, { ReactElement } from 'react';

// Create a custom render function that includes providers if needed
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, { ...options });
};

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override the render method with our custom one
export { customRender as render };

// Mock functions for studio testing
export const mockStudioConfig = {
  name: 'Test Studio',
  workspace_dimensions: { width: 10, length: 10, height: 8 },
  camera_config: { fov: 45, position: [0, 2, 5] },
  audio_config: { gain: 0.8 },
  lighting_config: { ambient: 0.5, key: 0.8 }
};

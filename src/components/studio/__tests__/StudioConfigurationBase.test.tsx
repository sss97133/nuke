import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StudioConfiguration } from '../StudioConfiguration';
import { renderWithProviders } from '@/test/test-utils';

// Mock initial data
const mockInitialDimensions = {
  length: 20,
  width: 20,
  height: 10
};

const mockInitialTracks = [
  {
    id: '1',
    name: 'Camera 1',
    position: { x: 8, y: 5, z: 8 },
    rotation: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 5, z: 0 },
    speed: 1,
    zoom: 1,
    length: 10,
    coneAngle: 45
  }
];

// Mock StudioWorkspace component
vi.mock('../StudioWorkspace', () => ({
  StudioWorkspace: vi.fn(() => <div data-testid="studio-workspace" />)
}));

describe('StudioConfiguration', () => {
  const onConfigChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders studio configuration form with initial values', async () => {
    await act(async () => {
      renderWithProviders(
        <StudioConfiguration
          initialDimensions={mockInitialDimensions}
          initialTracks={mockInitialTracks}
          onConfigChange={onConfigChange}
        />
      );
    });

    // Check for form elements
    expect(screen.getByText('Studio Configuration')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dimensions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cameras' })).toBeInTheDocument();
    expect(screen.getByTestId('studio-workspace')).toBeInTheDocument();

    // Check initial dimension values
    const lengthInput = screen.getByTestId('length-input');
    const widthInput = screen.getByTestId('width-input');
    const heightInput = screen.getByTestId('height-input');

    expect(lengthInput).toHaveValue(mockInitialDimensions.length);
    expect(widthInput).toHaveValue(mockInitialDimensions.width);
    expect(heightInput).toHaveValue(mockInitialDimensions.height);
  });

  it('handles dimension changes', async () => {
    await act(async () => {
      renderWithProviders(
        <StudioConfiguration
          initialDimensions={mockInitialDimensions}
          initialTracks={mockInitialTracks}
          onConfigChange={onConfigChange}
        />
      );
    });

    // Change dimensions
    await act(async () => {
      fireEvent.change(screen.getByTestId('length-input'), {
        target: { value: '25' }
      });
      fireEvent.change(screen.getByTestId('width-input'), {
        target: { value: '30' }
      });
      fireEvent.change(screen.getByTestId('height-input'), {
        target: { value: '15' }
      });
    });

    expect(onConfigChange).toHaveBeenCalledWith({
      dimensions: { length: 25, width: 30, height: 15 },
      ptzTracks: mockInitialTracks
    });
  });

  it('handles camera operations', async () => {
    await act(async () => {
      renderWithProviders(
        <StudioConfiguration
          initialDimensions={mockInitialDimensions}
          initialTracks={mockInitialTracks}
          onConfigChange={onConfigChange}
        />
      );
    });

    // Switch to cameras tab
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Cameras' }));
    });

    // Add new camera
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Camera' }));
    });

    expect(screen.getByText('Camera 2')).toBeInTheDocument();

    // Update camera position
    const xPositionInput = screen.getByTestId('camera-x-position-input-1');
    await act(async () => {
      fireEvent.change(xPositionInput, { target: { value: '10' } });
    });

    expect(onConfigChange).toHaveBeenCalled();

    // Remove camera
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    });

    expect(screen.queryByText('Camera 2')).not.toBeInTheDocument();
  });

  it('validates dimension inputs', async () => {
    await act(async () => {
      renderWithProviders(
        <StudioConfiguration
          initialDimensions={mockInitialDimensions}
          initialTracks={mockInitialTracks}
          onConfigChange={onConfigChange}
        />
      );
    });

    const lengthInput = screen.getByTestId('length-input');

    // Test invalid input
    await act(async () => {
      fireEvent.change(lengthInput, { target: { value: 'invalid' } });
    });

    expect(lengthInput).toHaveValue(mockInitialDimensions.length);

    // Test out of range input
    await act(async () => {
      fireEvent.change(lengthInput, { target: { value: '60' } });
    });

    expect(lengthInput).toHaveAttribute('max', '50');
  });
});

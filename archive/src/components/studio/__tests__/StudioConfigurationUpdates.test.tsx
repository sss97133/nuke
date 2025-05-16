
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { StudioConfiguration } from '../StudioConfiguration';
import { renderWithQueryClient } from './utils/testUtils';
import { mockUseStudioConfig, mockSaveStudioConfig } from './mocks/studioMocks';

// Mock the hook
vi.mock('../../../hooks/useStudioConfig', () => ({
  default: () => mockUseStudioConfig()
}));

describe('StudioConfiguration - Update functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls saveStudioConfig when form is submitted', async () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Find and click the save button
    const saveButton = screen.getByRole('button', { name: /Save Configuration/i });
    fireEvent.click(saveButton);
    
    // Check if save function was called
    expect(mockSaveStudioConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveStudioConfig).toHaveBeenCalledWith(mockUseStudioConfig().studioConfig);
  });

  it('updates form values when changed', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Find input and change value
    const nameInput = screen.getByLabelText(/Studio Name/i);
    fireEvent.change(nameInput, { target: { value: 'Updated Studio Name' } });
    
    // Check if value was updated
    expect(nameInput).toHaveValue('Updated Studio Name');
  });
});

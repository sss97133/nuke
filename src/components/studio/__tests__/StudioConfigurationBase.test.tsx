
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { StudioConfiguration } from '../StudioConfiguration';
import { renderWithQueryClient } from './utils/testUtils';
import { mockUseStudioConfig } from './mocks/studioMocks';

// Mock the hook
vi.mock('../../../hooks/useStudioConfig', () => ({
  default: () => mockUseStudioConfig()
}));

describe('StudioConfiguration - Base functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the studio configuration form', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Check basic elements are rendered
    expect(screen.getByText(/Studio Configuration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Studio Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Width/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Height/i)).toBeInTheDocument();
  });

  it('displays the correct default values', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Check form has correct values
    const { name, width, height } = mockUseStudioConfig().studioConfig;
    expect(screen.getByLabelText(/Studio Name/i)).toHaveValue(name);
    expect(screen.getByLabelText(/Width/i)).toHaveValue(width);
    expect(screen.getByLabelText(/Height/i)).toHaveValue(height);
  });
});

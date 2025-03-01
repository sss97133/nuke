
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import StudioConfiguration from '../StudioConfiguration';
import { renderWithQueryClient } from './utils/testUtils';
import { mockUseStudioConfig } from './mocks/studioMocks';

// Mock the hook
vi.mock('../../../hooks/useStudioConfig', () => ({
  default: () => mockUseStudioConfig()
}));

describe('StudioConfiguration - PTZ Camera functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders PTZ camera configuration section', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Check for PTZ specific elements
    expect(screen.getByText(/PTZ Camera Configuration/i)).toBeInTheDocument();
  });

  it('displays camera position controls', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Check for position controls
    expect(screen.getByLabelText(/X Position/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Y Position/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Z Position/i)).toBeInTheDocument();
  });
});

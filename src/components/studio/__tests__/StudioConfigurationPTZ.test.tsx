
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import StudioConfiguration from '../StudioConfiguration';
import { renderWithQueryClient } from './utils/testUtils';
import { mockUseStudioConfig } from './mocks/studioMocks';

// Mock the hook
vi.mock('../../../hooks/useStudioConfig', () => ({
  default: () => mockUseStudioConfig()
}));

describe('StudioConfiguration - PTZ Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the PTZ section', () => {
    renderWithQueryClient(<StudioConfiguration />);
    
    // Check if PTZ section is rendered
    expect(screen.getByText(/Camera PTZ/i)).toBeInTheDocument();
  });
});

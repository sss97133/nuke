import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { StudioConfiguration } from '../StudioConfiguration';
import { renderWithProviders } from '../../../test/test-utils';

describe('StudioConfiguration - Base functionality', () => {
  const mockConfig = {
    id: 1,
    name: 'Test Studio',
    description: 'Test Studio Description',
    room_width: 10,
    room_height: 8,
    room_depth: 12,
    camera_height: 1.8,
    ptz_enabled: true,
    ptz_speed: 0.5,
    ptz_sensitivity: 0.7
  };

  beforeEach(() => {
    vi.mock('../../../lib/supabase', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => ({
                execute: () => Promise.resolve({ data: mockConfig, error: null })
              })
            })
          })
        })
      }
    }));
  });

  it('renders the studio configuration form', async () => {
    renderWithProviders(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Studio Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Room Width/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Room Height/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Room Depth/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Camera Height/i)).toBeInTheDocument();
    });
  });

  it('displays the correct default values', async () => {
    renderWithProviders(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Studio Name/i)).toHaveValue(mockConfig.name);
      expect(screen.getByLabelText(/Description/i)).toHaveValue(mockConfig.description);
      expect(screen.getByLabelText(/Room Width/i)).toHaveValue(mockConfig.room_width);
      expect(screen.getByLabelText(/Room Height/i)).toHaveValue(mockConfig.room_height);
      expect(screen.getByLabelText(/Room Depth/i)).toHaveValue(mockConfig.room_depth);
      expect(screen.getByLabelText(/Camera Height/i)).toHaveValue(mockConfig.camera_height);
    });
  });
});

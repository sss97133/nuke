import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GarageSelector } from '../GarageSelector';
import { renderWithProviders } from '@/test/test-utils';
import { useGarages } from '../hooks/useGarages';

// Mock hooks
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn()
  }))
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn()
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('../hooks/useGarages', () => ({
  useGarages: vi.fn()
}));

describe('GarageSelector', () => {
  const mockGarages = [
    { id: '1', name: 'Test Garage 1', location: 'San Francisco' },
    { id: '2', name: 'Test Garage 2', location: 'Los Angeles' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', async () => {
    const { useGarages } = require('../hooks/useGarages');
    useGarages.mockReturnValue({
      data: null,
      isLoading: true,
      error: null
    });

    await act(async () => {
      renderWithProviders(<GarageSelector />);
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders garage list', async () => {
    const { useGarages } = require('../hooks/useGarages');
    useGarages.mockReturnValue({
      data: mockGarages,
      isLoading: false,
      error: null
    });

    await act(async () => {
      renderWithProviders(<GarageSelector />);
    });

    expect(screen.getByRole('heading', { name: 'Select Garage' })).toBeInTheDocument();
    expect(screen.getByText('Test Garage 1')).toBeInTheDocument();
    expect(screen.getByText('Test Garage 2')).toBeInTheDocument();
  });

  it('handles garage selection', async () => {
    const { useGarages } = require('../hooks/useGarages');
    useGarages.mockReturnValue({
      data: mockGarages,
      isLoading: false,
      error: null
    });

    const { useNavigate } = require('react-router-dom');
    const navigate = vi.fn();
    useNavigate.mockReturnValue(navigate);

    await act(async () => {
      renderWithProviders(<GarageSelector />);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Select/i })[0]);
    });

    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('handles empty garage list', async () => {
    const { useGarages } = require('../hooks/useGarages');
    useGarages.mockReturnValue({
      data: [],
      isLoading: false,
      error: null
    });

    await act(async () => {
      renderWithProviders(<GarageSelector />);
    });

    const noGaragesHeading = screen.getByRole('heading', { name: 'No Garages Found', level: 2 });
    expect(noGaragesHeading).toBeInTheDocument();
    
    const noGaragesText = screen.getByText("You don't have access to any garages yet.");
    expect(noGaragesText).toBeInTheDocument();
    expect(noGaragesText).toHaveClass('text-muted-foreground');
  });
});

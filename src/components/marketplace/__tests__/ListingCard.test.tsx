import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { ListingCard } from '../ListingCard';
import { useAuth } from '@/hooks/use-auth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { renderWithProviders } from '../../../test/test-utils';

// Mock the hooks
vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn()
}));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: vi.fn()
}));

// Mock navigate function
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate
}));

describe('ListingCard', () => {
  const mockProps = {
    id: '1',
    title: 'Test Car',
    description: 'A test car listing',
    price: 25000,
    imageUrl: 'test.jpg',
    year: 2020,
    make: 'Test Make',
    model: 'Test Model',
    mileage: 50000,
    location: 'Test Location',
    documentationScore: 75,
    verifiedHistory: false,
    tokenId: undefined,
    onWatchlistToggle: vi.fn(),
    createdAt: new Date().toISOString(),
    condition: 'Excellent',
    viewCount: 100,
    commentCount: 10,
    vin: 'ABC123XYZ'
  };

  beforeEach(() => {
    // Reset mocks
    mockNavigate.mockReset();
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      session: null
    });
    (useWatchlist as ReturnType<typeof vi.fn>).mockReturnValue({
      isWatched: () => false,
      toggleWatchlist: vi.fn()
    });
  });

  it('renders basic listing information correctly', () => {
    renderWithProviders(<ListingCard {...mockProps} />);

    expect(screen.getByText(mockProps.title)).toBeInTheDocument();
    expect(screen.getByText(`$${mockProps.price.toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(`${mockProps.year} ${mockProps.make} ${mockProps.model}`)).toBeInTheDocument();
    expect(screen.getByText(`${mockProps.mileage.toLocaleString()} miles`)).toBeInTheDocument();
    expect(screen.getByText(mockProps.location)).toBeInTheDocument();
  });

  it('displays verified history badge when verifiedHistory is true', () => {
    renderWithProviders(<ListingCard {...mockProps} verifiedHistory={true} />);
    expect(screen.getByText(/Verified History/i)).toBeInTheDocument();
  });

  it('displays NFT badge when tokenId is provided', () => {
    renderWithProviders(<ListingCard {...mockProps} tokenId="0x123" />);
    expect(screen.getByText(/NFT Backed/i)).toBeInTheDocument();
  });

  it('displays documentation score with progress bar', () => {
    renderWithProviders(<ListingCard {...mockProps} documentationScore={85} />);
    expect(screen.getByText(/Documentation Score/i)).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('navigates to listing detail page when clicked', () => {
    const navigate = vi.fn();
    vi.mock('react-router-dom', () => ({
      useNavigate: () => navigate
    }));

    renderWithProviders(<ListingCard {...mockProps} />);
    fireEvent.click(screen.getByRole('link'));
    expect(navigate).toHaveBeenCalledWith(`/listing/${mockProps.id}`);
  });

  it('requires authentication to add to watchlist', () => {
    const { onWatchlistToggle } = mockProps;
    renderWithProviders(<ListingCard {...mockProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Add to Watchlist/i }));
    expect(onWatchlistToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Sign in to add to watchlist/i)).toBeInTheDocument();
  });

  it('toggles watchlist when authenticated', () => {
    const { onWatchlistToggle } = mockProps;
    renderWithProviders(<ListingCard {...mockProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Add to Watchlist/i }));
    expect(onWatchlistToggle).toHaveBeenCalledWith(mockProps.id);
  });
});

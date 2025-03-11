import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { ListingCard } from '../ListingCard';
import { useAuth } from '@/hooks/use-auth';
import { useWatchlist } from '@/hooks/useWatchlist';

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
    id: '123',
    title: 'Test Vehicle',
    price: 50000,
    imageUrl: 'test.jpg',
    location: 'San Francisco, CA',
    createdAt: new Date().toISOString(),
    condition: 'Excellent',
    viewCount: 100,
    commentCount: 10,
    vin: 'ABC123XYZ',
    documentationScore: 85,
    verifiedHistory: true,
    tokenId: '0x123'
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
    render(
      <BrowserRouter>
        <ListingCard {...mockProps} />
      </BrowserRouter>
    );

    expect(screen.getByText(mockProps.title)).toBeInTheDocument();
    expect(screen.getByText(`$${mockProps.price.toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(mockProps.location)).toBeInTheDocument();
    expect(screen.getByText(mockProps.condition)).toBeInTheDocument();
  });

  it('displays verified history badge when verifiedHistory is true', () => {
    render(
      <BrowserRouter>
        <ListingCard {...mockProps} verifiedHistory={true} />
      </BrowserRouter>
    );

    expect(screen.getByText('Verified History')).toBeInTheDocument();
  });

  it('displays NFT badge when tokenId is provided', () => {
    render(
      <BrowserRouter>
        <ListingCard {...mockProps} tokenId="0x123" />
      </BrowserRouter>
    );

    expect(screen.getByText(/NFT #/)).toBeInTheDocument();
  });

  it('displays documentation score with progress bar', () => {
    render(
      <BrowserRouter>
        <ListingCard {...mockProps} documentationScore={85} />
      </BrowserRouter>
    );

    expect(screen.getByText('Documentation Score')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('navigates to listing detail page when clicked', () => {
    render(
      <BrowserRouter>
        <ListingCard {...mockProps} />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByText(mockProps.title));
    expect(mockNavigate).toHaveBeenCalledWith(`/marketplace/listing/${mockProps.id}`);
  });

  it('requires authentication to add to watchlist', () => {
    const mockSetAuthModal = vi.fn();
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      session: null
    });

    render(
      <BrowserRouter>
        <ListingCard {...mockProps} />
      </BrowserRouter>
    );

    const watchButton = screen.getByLabelText('Add to Watchlist');
    fireEvent.click(watchButton);

    // Should trigger auth modal
    expect(mockSetAuthModal).toHaveBeenCalledWith({
      isOpen: true,
      message: "Sign in to add listings to your watchlist",
      actionType: "watch"
    });
  });

  it('toggles watchlist when authenticated', () => {
    const mockToggleWatchlist = vi.fn();
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      session: { user: { id: '123' } }
    });
    (useWatchlist as ReturnType<typeof vi.fn>).mockReturnValue({
      isWatched: () => false,
      toggleWatchlist: mockToggleWatchlist
    });

    render(
      <BrowserRouter>
        <ListingCard {...mockProps} />
      </BrowserRouter>
    );

    const watchButton = screen.getByLabelText('Add to Watchlist');
    fireEvent.click(watchButton);

    expect(mockToggleWatchlist).toHaveBeenCalledWith(mockProps.id, 'listing');
  });
});

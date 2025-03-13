import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketplaceContent } from '../MarketplaceContent';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { renderWithProviders } from '@/test/test-utils';

// Set up React Query for testing
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Mock auth state
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'test-user' },
    isLoading: false
  })
}));

// Mock marketplace data
vi.mock('@/hooks/use-marketplace', () => ({
  useMarketplace: () => ({
    listings: [],
    isLoading: false,
    error: null,
    filters: {
      docScore: 'any',
      verificationStatus: 'any',
      priceRange: 'any'
    },
    setFilters: vi.fn()
  })
}));

describe('MarketplaceContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear React Query cache
    queryClient.clear();
  });

  it('renders marketplace header and stats', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    expect(screen.getByRole('heading', { name: 'Marketplace' })).toBeInTheDocument();
    expect(screen.getByText(/The first blockchain-verified marketplace/i)).toBeInTheDocument();
    expect(screen.getByText(/Verified Listings/i)).toBeInTheDocument();
    expect(screen.getByText(/Active Auctions/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Vehicles/i)).toBeInTheDocument();
  });

  it('renders search and filter controls', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    expect(screen.getByPlaceholderText(/Search vehicles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/i })).toBeInTheDocument();
  });

  it('applies filters correctly', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    const docScoreFilter = screen.getByTestId('doc-score-filter');
    const verificationFilter = screen.getByTestId('verification-filter');
    const priceFilter = screen.getByTestId('price-filter');

    await act(async () => {
      fireEvent.change(docScoreFilter, { target: { value: '90' } });
      fireEvent.change(verificationFilter, { target: { value: 'verified' } });
      fireEvent.change(priceFilter, { target: { value: 'under25' } });
    });

    expect(docScoreFilter).toHaveValue('90');
    expect(verificationFilter).toHaveValue('verified');
    expect(priceFilter).toHaveValue('under25');
  });

  it('handles search input', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    const searchInput = screen.getByPlaceholderText(/Search vehicles/i);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'test search' } });
    });

    expect(searchInput).toHaveValue('test search');
  });

  it('displays all tab options', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });
    
    const expectedTabs = [
      { name: 'Featured', value: 'featured' },
      { name: 'Verified History', value: 'verified' },
      { name: 'Live Auctions', value: 'auction' },
      { name: 'Classic Cars', value: 'classic' },
      { name: 'Collector Editions', value: 'collector' },
      { name: 'All Listings', value: 'all' },
      { name: 'Nearby', value: 'nearby' },
      { name: 'Watched', value: 'watched' }
    ];

    expectedTabs.forEach(tab => {
      const tabElement = screen.getByRole('tab', { name: tab.name });
      expect(tabElement).toBeInTheDocument();
      expect(tabElement).toHaveAttribute('data-value', tab.value);
    });
  });

  it('switches between tabs correctly', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    // Featured tab should be active by default
    const featuredTab = screen.getByRole('tab', { name: 'Featured' });
    expect(featuredTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-value', 'featured');

    // Test switching to All Listings tab
    const allListingsTab = screen.getByRole('tab', { name: 'All Listings' });
    await act(async () => {
      fireEvent.click(allListingsTab);
    });

    await waitFor(() => {
      expect(allListingsTab).toHaveAttribute('data-state', 'active');
      expect(featuredTab).toHaveAttribute('data-state', 'inactive');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('data-value', 'all');
    });

    // Test switching to Verified History tab
    const verifiedHistoryTab = screen.getByRole('tab', { name: 'Verified History' });
    await act(async () => {
      fireEvent.click(verifiedHistoryTab);
    });

    await waitFor(() => {
      expect(verifiedHistoryTab).toHaveAttribute('data-state', 'active');
      expect(allListingsTab).toHaveAttribute('data-state', 'inactive');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('data-value', 'verified');
    });
  });

  it('displays real marketplace statistics', async () => {
    await act(async () => {
      renderWithProviders(<MarketplaceContent />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Verified Listings/)).toBeInTheDocument();
      expect(screen.getByText(/Active Auctions/)).toBeInTheDocument();
      expect(screen.getByText(/Total Vehicles/)).toBeInTheDocument();
    });
  });
});

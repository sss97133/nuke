import type { Database } from '../types';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('MarketplaceContent', () => {
  beforeEach(() => {
    // Clear React Query cache
    queryClient.clear();
  });

  it('renders marketplace header and stats', () => {
    renderWithProviders(<MarketplaceContent />);

    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.getByText(/The first blockchain-verified marketplace/i)).toBeInTheDocument();
    expect(screen.getByText(/Verified Listings/i)).toBeInTheDocument();
    expect(screen.getByText(/Active Auctions/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Vehicles/i)).toBeInTheDocument();
  });

  it('renders search and filter controls', () => {
    renderWithProviders(<MarketplaceContent />);

    expect(screen.getByPlaceholderText(/Search vehicles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/i })).toBeInTheDocument();
  });

  it('applies filters correctly', async () => {
    renderWithProviders(<MarketplaceContent />);

    // Open filters
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));

    // Set filters
    const docScoreFilter = screen.getByTestId('doc-score-filter');
    const verificationFilter = screen.getByTestId('verification-filter');
    const priceFilter = screen.getByTestId('price-filter');

    fireEvent.change(docScoreFilter, { target: { value: 'high' } });
    fireEvent.change(verificationFilter, { target: { value: 'verified' } });
    fireEvent.change(priceFilter, { target: { value: 'low' } });

    // Wait for filters to be applied
    await waitFor(() => {
      expect(screen.getByText(/Filtered Results/i)).toBeInTheDocument();
    });
  });

  it('handles search input', async () => {
    renderWithProviders(<MarketplaceContent />);

    const searchInput = screen.getByPlaceholderText(/Search vehicles/i);
    fireEvent.change(searchInput, { target: { value: 'test search' } });

    await waitFor(() => {
      expect(searchInput).toHaveValue('test search');
    });
  });

  it('displays all tab options', () => {
    renderWithProviders(<MarketplaceContent />);
    
    const expectedTabs = [
      'Featured',
      'Verified History',
      'Live Auctions',
      'Classic Cars',
      'Collector Editions',
      'All Listings',
      'Nearby',
      'Watched'
    ];

    expectedTabs.forEach(tab => {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    });
  });

  it('shows featured listings from database', async () => {
    renderWithProviders(<MarketplaceContent />);

    // Wait for real data to load
    await waitFor(async () => {
      const { data: listings } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('featured', true)
        .single();

      if (listings) {
        // Verify featured listings are displayed
        expect(screen.getByText(listings.title)).toBeInTheDocument();
        if (listings.price) {
          expect(screen.getByText(`$${listings.price}`)).toBeInTheDocument();
        }
      }
    });
  });

  it('switches between tabs and loads correct data', async () => {
    renderWithProviders(<MarketplaceContent />);
    
    // Test All Listings tab
    fireEvent.click(screen.getByRole('tab', { name: 'All Listings' }));
    await waitFor(async () => {
      const { data: allListings } = await supabase
        .select('*')
        .single();

      if (allListings) {
        expect(screen.getByText(allListings.title)).toBeInTheDocument();
      }
    });

    // Test Verified History tab
    fireEvent.click(screen.getByRole('tab', { name: 'Verified History' }));
    await waitFor(async () => {
      const { data: verifiedListings } = await supabase
        .select('*')
        .eq('verification_status', 'verified')
        .single();

      if (verifiedListings) {
        expect(screen.getByText(verifiedListings.title)).toBeInTheDocument();
      }
    });
  });

  it('displays real marketplace statistics', async () => {
    renderWithProviders(<MarketplaceContent />);

    await waitFor(() => {
      expect(screen.getByText(/Verified Listings/)).toBeInTheDocument();
      expect(screen.getByText(/Active Auctions/)).toBeInTheDocument();
      expect(screen.getByText(/Total Vehicles/)).toBeInTheDocument();
    });
  });
});

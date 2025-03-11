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

  it('renders marketplace header and title', () => {
    renderWithProviders(<MarketplaceContent />);
    
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('The first blockchain-verified marketplace for classic and collectible vehicles')).toBeInTheDocument();
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
        .from('marketplace_listings')
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
        .from('marketplace_listings')
        .select('*')
        .eq('verification_status', 'verified')
        .single();

      if (verifiedListings) {
        expect(screen.getByText(verifiedListings.title)).toBeInTheDocument();
      }
    });
  });

  it('applies filters to real data', async () => {
    renderWithProviders(<MarketplaceContent />);

    // Wait for filters to be available
    const docScoreSelect = await screen.findByTestId('doc-score-filter') as HTMLSelectElement;
    const verificationSelect = await screen.findByTestId('verification-filter') as HTMLSelectElement;
    const priceSelect = await screen.findByTestId('price-filter') as HTMLSelectElement;

    // Apply filters
    fireEvent.change(docScoreSelect, { target: { value: '80' } });
    fireEvent.change(verificationSelect, { target: { value: 'verified' } });
    fireEvent.change(priceSelect, { target: { value: '50000-100000' } });

    // Wait for filtered results
    await waitFor(() => {
      expect(screen.getByText(/Filtered Results/)).toBeInTheDocument();
    });
  });

  it('displays real marketplace statistics', async () => {
    renderWithProviders(<MarketplaceContent />);

    await waitFor(async () => {
      const { data: verifiedData } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('verification_status', 'verified')
        .single();

      const { data: auctionData } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('listing_type', 'auction')
        .eq('status', 'active')
        .single();

      const { data: totalData } = await supabase
        .from('marketplace_listings')
        .select('*')
        .single();

      const verifiedCount = verifiedData ? 1 : 0;
      const auctionCount = auctionData ? 1 : 0;
      const totalCount = totalData ? 1 : 0;

      expect(screen.getByText(`${verifiedCount} Verified Listings`)).toBeInTheDocument();
      expect(screen.getByText(`${auctionCount} Active Auctions`)).toBeInTheDocument();
      expect(screen.getByText(`${totalCount} Total Vehicles`)).toBeInTheDocument();
    });
  });
});

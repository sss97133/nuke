import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MarketplaceContent } from '../MarketplaceContent';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Set up React Query for testing
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Wrap component with providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

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
        .eq('featured', true);

      if (listings && listings.length > 0) {
        // Verify featured listings are displayed
        listings.forEach(listing => {
          expect(screen.getByText(listing.title)).toBeInTheDocument();
          if (listing.price) {
            expect(screen.getByText(`$${listing.price}`)).toBeInTheDocument();
          }
        });
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
        .select('*');

      if (allListings && allListings.length > 0) {
        allListings.forEach(listing => {
          expect(screen.getByText(listing.title)).toBeInTheDocument();
        });
      }
    });

    // Test Verified History tab
    fireEvent.click(screen.getByRole('tab', { name: 'Verified History' }));
    await waitFor(async () => {
      const { data: verifiedListings } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('verification_status', 'verified');

      if (verifiedListings && verifiedListings.length > 0) {
        verifiedListings.forEach(listing => {
          expect(screen.getByText(listing.title)).toBeInTheDocument();
        });
      }
    });
  });

  it('applies filters to real data', async () => {
    renderWithProviders(<MarketplaceContent />);

    // Wait for filters to be available
    const docScoreSelect = await screen.findByLabelText('Documentation Score') as HTMLSelectElement;
    const verificationSelect = await screen.findByLabelText('Verification Status') as HTMLSelectElement;
    const priceSelect = await screen.findByLabelText('Price Range') as HTMLSelectElement;

    // Apply filters
    fireEvent.change(docScoreSelect, { target: { value: '90' } });
    fireEvent.change(verificationSelect, { target: { value: 'verified' } });
    fireEvent.change(priceSelect, { target: { value: '50to100' } });

    // Wait for filtered data
    await waitFor(async () => {
      const { data: filteredListings } = await supabase
        .from('marketplace_listings')
        .select('*')
        .gte('documentation_score', 90)
        .eq('verification_status', 'verified')
        .gte('price', 50)
        .lte('price', 100);

      if (filteredListings && filteredListings.length > 0) {
        // Verify filtered listings are displayed
        filteredListings.forEach(listing => {
          expect(screen.getByText(listing.title)).toBeInTheDocument();
        });
      }
    });
  });

  it('displays real marketplace statistics', async () => {
    renderWithProviders(<MarketplaceContent />);
    
    await waitFor(async () => {
      const { count: verifiedCount } = await supabase
        .from('marketplace_listings')
        .select('*', { count: 'exact' })
        .eq('verification_status', 'verified');

      const { count: auctionCount } = await supabase
        .from('marketplace_listings')
        .select('*', { count: 'exact' })
        .eq('listing_type', 'auction')
        .eq('status', 'active');

      const { count: totalCount } = await supabase
        .from('marketplace_listings')
        .select('*', { count: 'exact' });

      if (verifiedCount !== null) {
        expect(screen.getByText(`${verifiedCount} Verified Listings`)).toBeInTheDocument();
      }
      if (auctionCount !== null) {
        expect(screen.getByText(`${auctionCount} Active Auctions`)).toBeInTheDocument();
      }
      if (totalCount !== null) {
        expect(screen.getByText(`${totalCount} Total Vehicles`)).toBeInTheDocument();
      }
    });
  });
});

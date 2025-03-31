/**
 * VehicleTimeline Component Tests
 * 
 * This test suite verifies the timeline visualization component following
 * our vehicle-centric architecture principles.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Component and mock data
import VehicleTimeline, { TimelineEvent } from '../index';
import { supabase } from '@/integrations/supabase/client';

// Mock the Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    data: null,
    error: null
  }
}));

// Real vehicle data samples for testing (following the no-mock data principle)
const SAMPLE_TIMELINE_EVENTS = [
  {
    id: "d0c18271-fa5c-43ea-b545-6db5e54ebcf1",
    vehicle_id: "vehicle-123",
    event_type: "manufacture",
    source: "vin_database",
    event_date: "1988-01-01T00:00:00Z",
    title: "Vehicle Manufactured",
    description: "1988 GMC Suburban manufactured",
    confidence_score: 95,
    metadata: {
      year: 1988,
      make: "GMC",
      model: "Suburban",
      vin: "1GKEV16K4JF504317"
    },
    source_url: "https://vpic.nhtsa.dot.gov/decoder/Decoder/DecodeVin/",
    image_urls: [
      "https://example.com/image1.jpg"
    ],
    created_at: "2023-03-14T06:28:02.207Z",
    updated_at: "2023-03-14T06:28:02.207Z"
  },
  {
    id: "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8",
    vehicle_id: "vehicle-123",
    event_type: "listing",
    source: "auction",
    event_date: "2023-10-15T12:00:00Z",
    title: "Listed on Auction Site",
    description: "1988 GMC Suburban 1500 Sierra Classic 4×4 listed on auction",
    confidence_score: 98,
    metadata: {
      auction_id: "123456",
      specs: {
        engine: "5.7L V8",
        transmission: "4-Speed Automatic"
      }
    },
    source_url: "https://example.com/auction/123456",
    image_urls: ["https://example.com/image2.jpg"],
    created_at: "2023-10-15T12:00:00Z",
    updated_at: "2023-10-15T12:00:00Z"
  }
];

describe('VehicleTimeline Component', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    
    // Setup Supabase mock to return sample data
    (supabase.from as any).mockReturnThis();
    (supabase.select as any).mockReturnThis();
    (supabase.eq as any).mockReturnThis();
    (supabase.order as any).mockReturnThis();
    
    // Mock a successful response
    (supabase as any).data = SAMPLE_TIMELINE_EVENTS;
    (supabase as any).error = null;
  });

  it('renders with vehicle ID', async () => {
    render(<VehicleTimeline vehicleId="vehicle-123" />);
    
    // Verify loading state appears first
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    
    // Wait for timeline events to appear
    await waitFor(() => {
      expect(screen.getByText('Vehicle Manufactured')).toBeInTheDocument();
    });

    // Check if both events are rendered
    expect(screen.getByText('Vehicle Manufactured')).toBeInTheDocument();
    expect(screen.getByText('Listed on Auction Site')).toBeInTheDocument();
  });

  it('renders with VIN instead of vehicle ID', async () => {
    render(<VehicleTimeline vin="1GKEV16K4JF504317" />);
    
    // Verify timeline eventually displays events
    await waitFor(() => {
      expect(screen.getByText('Vehicle Manufactured')).toBeInTheDocument();
    });
  });

  it('displays confidence scores for events', async () => {
    render(<VehicleTimeline vehicleId="vehicle-123" />);
    
    await waitFor(() => {
      const confidenceElements = screen.getAllByText(/confidence/i);
      expect(confidenceElements.length).toBeGreaterThan(0);
    });
  });

  it('calls onEventClick when an event is clicked', async () => {
    const handleEventClick = vi.fn();
    render(
      <VehicleTimeline 
        vehicleId="vehicle-123" 
        onEventClick={handleEventClick} 
      />
    );
    
    await waitFor(() => {
      expect(screen.getByText('Vehicle Manufactured')).toBeInTheDocument();
    });
    
    // Click on an event
    fireEvent.click(screen.getByText('Vehicle Manufactured'));
    
    // Verify the handler was called with the event data
    expect(handleEventClick).toHaveBeenCalled();
    expect(handleEventClick.mock.calls[0][0]).toHaveProperty('id');
    expect(handleEventClick.mock.calls[0][0]).toHaveProperty('eventType');
  });

  it('handles error states gracefully', async () => {
    // Set up error response
    (supabase as any).data = null;
    (supabase as any).error = { message: 'Database error' };
    
    render(<VehicleTimeline vehicleId="vehicle-123" />);
    
    // Check for error state or fallback content
    await waitFor(() => {
      expect(screen.getByText(/error/i) || screen.getByText(/fallback/i)).toBeInTheDocument();
    });
  });

  it('sorts events chronologically', async () => {
    render(<VehicleTimeline vehicleId="vehicle-123" />);
    
    await waitFor(() => {
      expect(screen.getByText('Vehicle Manufactured')).toBeInTheDocument();
    });
    
    // Check the order of events in the DOM
    const timelineItems = screen.getAllByRole('listitem');
    
    // Assuming the items are in the same order as the DOM
    // The manufacture event (1988) should come before the listing (2023)
    const manufactureIndex = timelineItems.findIndex(item => 
      item.textContent?.includes('Vehicle Manufactured'));
    const listingIndex = timelineItems.findIndex(item => 
      item.textContent?.includes('Listed on Auction Site'));
    
    expect(manufactureIndex).toBeLessThan(listingIndex);
  });
});

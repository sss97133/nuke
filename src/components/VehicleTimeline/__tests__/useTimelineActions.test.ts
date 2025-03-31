/**
 * useTimelineActions Hook Tests
 * 
 * This test suite verifies the timeline action hooks that support the
 * vehicle-centric timeline functionality.
 */
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useTimelineActions } from '../useTimelineActions';
import { supabase } from '@/integrations/supabase/client';

// Mock the Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    data: null,
    error: null
  }
}));

// Sample timeline event for testing
const sampleEvent = {
  id: "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8",
  vehicleId: "vehicle-123",
  eventType: "maintenance",
  eventSource: "owner_input",
  eventDate: "2023-11-15T12:00:00Z",
  title: "Oil Change",
  description: "Regular maintenance - oil and filter change",
  confidenceScore: 95,
  metadata: {
    mileage: 90000,
    service_type: "regular_maintenance",
    parts: ["oil_filter", "engine_oil"]
  },
  sourceUrl: "https://example.com/service/123456",
  imageUrls: ["https://example.com/service-image.jpg"]
};

// Sample response format from Supabase
const mockSuccessResponse = {
  data: { id: "new-event-id" },
  error: null
};

const mockErrorResponse = {
  data: null,
  error: { message: "Database error" }
};

describe('useTimelineActions Hook', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    
    // Default success response
    (supabase.from as any).mockReturnThis();
    (supabase.select as any).mockReturnThis();
    (supabase.insert as any).mockReturnThis();
    (supabase.update as any).mockReturnThis();
    (supabase.delete as any).mockReturnThis();
    (supabase.eq as any).mockReturnThis();
    (supabase.order as any).mockReturnThis();
    (supabase.single as any).mockReturnThis();
    (supabase as any).data = mockSuccessResponse.data;
    (supabase as any).error = mockSuccessResponse.error;
  });

  it('should add a timeline event', async () => {
    // Mock the Supabase insert response
    (supabase.from as jest.Mock).mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockSuccessResponse)
      })
    });

    const { result } = renderHook(() => useTimelineActions());

    let addResult;
    await act(async () => {
      addResult = await result.current.addTimelineEvent({
        vehicleId: "vehicle-123",
        eventType: "maintenance",
        title: "Oil Change",
        description: "Regular maintenance",
        eventDate: "2023-11-15T12:00:00Z",
        confidenceScore: 95,
        eventSource: "owner_input"
      });
    });

    expect(addResult.success).toBe(true);
    expect(addResult.data).toHaveProperty('id');
    expect(supabase.from).toHaveBeenCalledWith('vehicle_timeline_events');
  });

  it('should update a timeline event', async () => {
    // Mock the Supabase update response
    (supabase.from as jest.Mock).mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(mockSuccessResponse)
        })
      })
    });

    const { result } = renderHook(() => useTimelineActions());

    let updateResult;
    await act(async () => {
      updateResult = await result.current.updateTimelineEvent({
        id: "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8",
        title: "Oil Change and Tire Rotation",
        description: "Updated description"
      });
    });

    expect(updateResult.success).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('vehicle_timeline_events');
    expect(supabase.update).toHaveBeenCalled();
    expect(supabase.eq).toHaveBeenCalledWith('id', "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8");
  });

  it('should delete a timeline event', async () => {
    // Mock the Supabase delete response
    (supabase.from as jest.Mock).mockReturnValue({
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(mockSuccessResponse)
        })
      })
    });

    const { result } = renderHook(() => useTimelineActions());

    let deleteResult;
    await act(async () => {
      deleteResult = await result.current.deleteTimelineEvent("ebad072a-713f-44c8-a4d5-d2a1e1aac5d8");
    });

    expect(deleteResult.success).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('vehicle_timeline_events');
    expect(supabase.delete).toHaveBeenCalled();
    expect(supabase.eq).toHaveBeenCalledWith('id', "ebad072a-713f-44c8-a4d5-d2a1e1aac5d8");
  });

  it('should handle errors when adding an event', async () => {
    // Mock an error response
    (supabase.from as jest.Mock).mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockErrorResponse)
      })
    });

    const { result } = renderHook(() => useTimelineActions());

    let addResult;
    await act(async () => {
      addResult = await result.current.addTimelineEvent({
        vehicleId: "vehicle-123",
        eventType: "maintenance",
        title: "Oil Change",
        description: "Regular maintenance",
        eventDate: "2023-11-15T12:00:00Z",
        confidenceScore: 95,
        eventSource: "owner_input"
      });
    });

    expect(addResult.success).toBe(false);
    expect(addResult.error).toBeDefined();
    expect(addResult.error.message).toBe("Database error");
  });

  it('should implement confidence scoring for events', async () => {
    // This test verifies that the confidence scoring system is working correctly
    const { result } = renderHook(() => useTimelineActions());
    
    // Test the calculated confidence score (if applicable)
    const calculatedScore = result.current.calculateConfidenceScore({
      eventType: "maintenance",
      eventSource: "owner_input",
      hasDocumentation: true,
      hasImages: true
    });
    
    // Verify score is within expected range and follows our scoring rules
    expect(calculatedScore).toBeGreaterThanOrEqual(1);
    expect(calculatedScore).toBeLessThanOrEqual(100);
    
    // Owner input with documentation should have higher confidence than without
    const scoreWithoutDocs = result.current.calculateConfidenceScore({
      eventType: "maintenance",
      eventSource: "owner_input",
      hasDocumentation: false,
      hasImages: true  
    });
    
    expect(calculatedScore).toBeGreaterThan(scoreWithoutDocs);
  });

  it('should properly handle multi-source data conflicts', async () => {
    // Test the conflict resolution capabilities when adding an event that conflicts
    const conflictingEvent = {
      vehicleId: "vehicle-123",
      eventType: "maintenance",
      title: "Oil Change",
      description: "Conflicting description",
      eventDate: "2023-11-15T12:00:00Z", // Same date as existing event
      confidenceScore: 90, // Lower score than existing
      eventSource: "dealer_record"
    };
    
    // First mock a fetch that finds the conflicting event
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            data: [sampleEvent], // The existing event
            error: null
          })
        })
      })
    });
    
    const { result } = renderHook(() => useTimelineActions());
    
    // Check conflict detection (should return the higher confidence event)
    const conflictResult = await result.current.checkConflicts(conflictingEvent);
    
    expect(conflictResult.hasConflicts).toBe(true);
    expect(conflictResult.winningEvent.id).toBe(sampleEvent.id);
    expect(conflictResult.winningEvent.confidenceScore).toBeGreaterThan(conflictingEvent.confidenceScore);
  });
});

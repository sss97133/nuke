/**
 * Timeline Service for the Vehicle-Centric Architecture
 * 
 * Orchestrates the integration of data from multiple sources into a unified vehicle timeline
 * Leverages the multi-source connector framework to aggregate and normalize data
 */

import { supabaseClient } from '../supabase-client';
import { MarketplaceConnector } from '../connectors/marketplace-connector';
import { resolveConflictingEvents, recalculateConfidenceScores } from './confidence-scoring';

// Configure source weights for confidence scoring
const SOURCE_WEIGHTS = {
  'bat': 0.85,         // Bring a Trailer (auction data)
  'nhtsa': 0.9,        // NHTSA (government data)
  'craigslist': 0.7,   // Craigslist listings
  'facebook': 0.65,    // Facebook Marketplace
  'user': 0.75,        // User-provided data
  'dealer': 0.8,       // Dealer records
  'carfax': 0.85,      // Carfax reports
  'autocheck': 0.8,    // Autocheck reports
  'insurance': 0.8,    // Insurance records
  'service': 0.75,     // Service records
  'dmv': 0.9,          // DMV records
  'manufacturer': 0.9, // Manufacturer data
  'auction': 0.8,      // General auction data
  'import': 0.7        // Imported data
};

/**
 * Timeline Service class
 * Manages vehicle timeline data from multiple sources
 */
export class TimelineService {
  constructor() {
    // Initialize connectors
    this.connectors = {
      marketplace: new MarketplaceConnector(),
      // Additional connectors would be registered here
      // bat: new BatConnector(),
      // nhtsa: new NhtsaConnector(), 
      // etc.
    };
  }

  /**
   * Process all sources for a vehicle
   * @param {string} vehicleId - Vehicle ID to process
   * @returns {Promise<Object>} Processing results
   */
  async processAllSources(vehicleId) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }
    
    const results = {};
    
    // Process each connector
    for (const [name, connector] of Object.entries(this.connectors)) {
      try {
        results[name] = await connector.process({ vehicleId });
      } catch (error) {
        console.error(`Error processing source ${name}:`, error);
        results[name] = {
          source: name,
          error: error.message,
          success: false
        };
      }
    }
    
    // After processing all sources, resolve any conflicts
    await this.resolveConflicts(vehicleId);
    
    return results;
  }
  
  /**
   * Process data from a specific source for a vehicle
   * @param {string} vehicleId - Vehicle ID to process
   * @param {string} source - Source name to process
   * @returns {Promise<Object>} Processing results
   */
  async processSource(vehicleId, source) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }
    
    if (!source || !this.connectors[source]) {
      throw new Error(`Source ${source} is not supported`);
    }
    
    try {
      const result = await this.connectors[source].process({ vehicleId });
      
      // After processing, resolve any conflicts
      await this.resolveConflicts(vehicleId);
      
      return result;
    } catch (error) {
      console.error(`Error processing source ${source}:`, error);
      return {
        source,
        error: error.message,
        success: false
      };
    }
  }
  
  /**
   * Get timeline events for a vehicle
   * @param {string} vehicleId - Vehicle ID to get timeline for
   * @param {Object} options - Options for filtering/sorting
   * @returns {Promise<Array>} Timeline events
   */
  async getVehicleTimeline(vehicleId, options = {}) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }
    
    try {
      // Build query based on options
      let query = supabaseClient
        .from('vehicle_timeline')
        .select('*')
        .eq('vehicle_id', vehicleId);
      
      // Apply filters
      if (options.sources && options.sources.length > 0) {
        query = query.in('source', options.sources);
      }
      
      if (options.eventTypes && options.eventTypes.length > 0) {
        query = query.in('event_type', options.eventTypes);
      }
      
      if (options.startDate) {
        query = query.gte('event_date', options.startDate);
      }
      
      if (options.endDate) {
        query = query.lte('event_date', options.endDate);
      }
      
      if (options.minConfidence) {
        query = query.gte('confidence_score', options.minConfidence);
      }
      
      // Apply sorting
      const sortField = options.sortBy || 'event_date';
      const sortOrder = options.sortDesc ? 'desc' : 'asc';
      query = query.order(sortField, { ascending: sortOrder === 'asc' });
      
      // Execute query
      const { data, error } = await query;
      
      if (error) {
        throw error;
      }
      
      return data || [];
    } catch (error) {
      console.error('Error getting vehicle timeline:', error);
      throw error;
    }
  }
  
  /**
   * Resolve conflicting events in the timeline
   * @param {string} vehicleId - Vehicle ID to resolve conflicts for
   * @returns {Promise<Object>} Resolution results
   */
  async resolveConflicts(vehicleId) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }
    
    try {
      // Get all timeline events for the vehicle
      const { data: events, error } = await supabaseClient
        .from('vehicle_timeline')
        .select('*')
        .eq('vehicle_id', vehicleId);
      
      if (error) {
        throw error;
      }
      
      if (!events || events.length === 0) {
        return { resolved: 0 };
      }
      
      // Group events by event_type
      const eventsByType = events.reduce((groups, event) => {
        const key = event.event_type;
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(event);
        return groups;
      }, {});
      
      // Track events that need resolution
      const resolutionNeeded = [];
      
      // Find event types with conflicting data
      Object.entries(eventsByType).forEach(([eventType, eventsOfType]) => {
        if (eventsOfType.length > 1) {
          // For event types with multiple entries, resolve conflicts
          const resolved = resolveConflictingEvents(eventsOfType);
          
          // Mark all lower-confidence events as 'resolved'
          eventsOfType.forEach(event => {
            if (event.id !== resolved.id) {
              resolutionNeeded.push({
                id: event.id,
                resolved_by: resolved.id,
                resolution_reason: 'confidence_score',
                active: false
              });
            }
          });
        }
      });
      
      // Update events that need resolution
      if (resolutionNeeded.length > 0) {
        // Update each event's resolution status
        const updatePromises = resolutionNeeded.map(resolution => 
          supabaseClient
            .from('vehicle_timeline')
            .update({
              resolved_by: resolution.resolved_by,
              resolution_reason: resolution.resolution_reason,
              active: resolution.active
            })
            .eq('id', resolution.id)
        );
        
        await Promise.all(updatePromises);
      }
      
      return {
        resolved: resolutionNeeded.length,
        total: events.length
      };
    } catch (error) {
      console.error('Error resolving timeline conflicts:', error);
      throw error;
    }
  }
  
  /**
   * Add a manual timeline event
   * @param {Object} event - Timeline event to add
   * @returns {Promise<Object>} The created event
   */
  async addEvent(event) {
    if (!event || !event.vehicle_id || !event.event_type) {
      throw new Error('Invalid event data');
    }
    
    try {
      // Set default values
      const now = new Date().toISOString();
      const fullEvent = {
        ...event,
        source: event.source || 'user',
        event_date: event.event_date || now,
        created_at: now,
        updated_at: now,
        confidence_score: event.confidence_score || SOURCE_WEIGHTS[event.source || 'user'] || 0.75,
        active: true
      };
      
      // Insert the event
      const { data, error } = await supabaseClient
        .from('vehicle_timeline')
        .insert(fullEvent)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      // After adding a new event, resolve any conflicts
      await this.resolveConflicts(event.vehicle_id);
      
      return data;
    } catch (error) {
      console.error('Error adding timeline event:', error);
      throw error;
    }
  }
  
  /**
   * Update an existing timeline event
   * @param {string} eventId - ID of the event to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} The updated event
   */
  async updateEvent(eventId, updates) {
    if (!eventId) {
      throw new Error('Event ID is required');
    }
    
    try {
      // Get the current event
      const { data: currentEvent, error: fetchError } = await supabaseClient
        .from('vehicle_timeline')
        .select('*')
        .eq('id', eventId)
        .single();
      
      if (fetchError) {
        throw fetchError;
      }
      
      // Prepare updates
      const updatedEvent = {
        ...updates,
        updated_at: new Date().toISOString()
      };
      
      // If source changed, recalculate confidence score
      if (updates.source && updates.source !== currentEvent.source) {
        updatedEvent.confidence_score = SOURCE_WEIGHTS[updates.source] || 0.75;
      }
      
      // Update the event
      const { data, error } = await supabaseClient
        .from('vehicle_timeline')
        .update(updatedEvent)
        .eq('id', eventId)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      // After updating, resolve any conflicts
      await this.resolveConflicts(currentEvent.vehicle_id);
      
      return data;
    } catch (error) {
      console.error('Error updating timeline event:', error);
      throw error;
    }
  }
  
  /**
   * Delete a timeline event
   * @param {string} eventId - ID of the event to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteEvent(eventId) {
    if (!eventId) {
      throw new Error('Event ID is required');
    }
    
    try {
      // Get the current event to know which vehicle it belongs to
      const { data: currentEvent, error: fetchError } = await supabaseClient
        .from('vehicle_timeline')
        .select('vehicle_id')
        .eq('id', eventId)
        .single();
      
      if (fetchError) {
        throw fetchError;
      }
      
      // Delete the event
      const { error } = await supabaseClient
        .from('vehicle_timeline')
        .delete()
        .eq('id', eventId);
      
      if (error) {
        throw error;
      }
      
      // After deleting, resolve any conflicts
      if (currentEvent && currentEvent.vehicle_id) {
        await this.resolveConflicts(currentEvent.vehicle_id);
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting timeline event:', error);
      throw error;
    }
  }
  
  /**
   * Group similar events to reduce timeline noise
   * @param {string} vehicleId - Vehicle ID to group events for
   * @returns {Promise<Object>} Grouping results
   */
  async groupSimilarEvents(vehicleId) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }
    
    try {
      // Get all timeline events for the vehicle
      const { data: events, error } = await supabaseClient
        .from('vehicle_timeline')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('active', true);
      
      if (error) {
        throw error;
      }
      
      if (!events || events.length === 0) {
        return { grouped: 0 };
      }
      
      // Group events by similarity
      const similarityGroups = {};
      
      // Logic to identify similar events within a short timeframe
      events.forEach(event => {
        const eventDate = new Date(event.event_date);
        const eventType = event.event_type;
        
        // Look for events of the same type within a day
        const key = `${eventType}_${eventDate.toISOString().split('T')[0]}`;
        
        if (!similarityGroups[key]) {
          similarityGroups[key] = [];
        }
        
        similarityGroups[key].push(event);
      });
      
      // Track events that will be grouped
      const groupsToCreate = [];
      
      // For each group with multiple events, create a group
      Object.values(similarityGroups).forEach(group => {
        if (group.length > 1) {
          // Sort by confidence score
          group.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));
          
          // The highest confidence event becomes the primary
          const primary = group[0];
          const others = group.slice(1);
          
          // Create a group record
          groupsToCreate.push({
            primary_id: primary.id,
            grouped_count: others.length,
            event_type: primary.event_type,
            vehicle_id: vehicleId,
            group_members: others.map(e => e.id)
          });
          
          // Update others to reference the primary
          others.forEach(event => {
            event.grouped_with = primary.id;
            event.active = false;
          });
        }
      });
      
      // Update group memberships
      const updatePromises = [];
      
      // Flatten all events that need updating
      const eventsToUpdate = groupsToCreate.flatMap(group => {
        return group.group_members.map(memberId => ({
          id: memberId,
          grouped_with: group.primary_id,
          active: false
        }));
      });
      
      // Update each event's group status
      if (eventsToUpdate.length > 0) {
        for (const event of eventsToUpdate) {
          updatePromises.push(
            supabaseClient
              .from('vehicle_timeline')
              .update({
                grouped_with: event.grouped_with,
                active: event.active
              })
              .eq('id', event.id)
          );
        }
        
        await Promise.all(updatePromises);
      }
      
      return {
        grouped: eventsToUpdate.length,
        groups: groupsToCreate.length,
        total: events.length
      };
    } catch (error) {
      console.error('Error grouping similar events:', error);
      throw error;
    }
  }
}

/**
 * Marketplace Connector for Nuke
 * 
 * Integrates with the multi-source connector framework to handle vehicle data
 * from marketplace sources like Craigslist and Facebook Marketplace
 */

import type { Database } from '../types';
import { supabaseClient } from '../supabase-client';
import { BaseConnector } from './base-connector';
import { calculateConfidenceScore } from '../timeline/confidence-scoring';

/**
 * MarketplaceConnector class for handling data from various online marketplaces
 * Extends the BaseConnector to maintain compatibility with the multi-source framework
 */
export class MarketplaceConnector extends BaseConnector {
  constructor() {
    super('marketplace');
    this.supportedSources = ['craigslist', 'facebook'];
    this.sourceWeights = {
      'craigslist': 0.8,
      'facebook': 0.75
    };
  }

  /**
   * Validates if the source is supported by this connector
   * @param {string} source - The source identifier
   * @returns {boolean} Whether the source is supported
   */
  supportsSource(source) {
    return this.supportedSources.includes(source.toLowerCase());
  }

  /**
   * Fetches vehicle data from the database for a specific marketplace source
   * @param {Object} params - Parameters for fetching data
   * @param {string} params.vehicleId - The vehicle ID to fetch data for
   * @param {string} params.source - The specific marketplace source (optional)
   * @returns {Promise<Array>} Vehicle data from the source
   */
  async fetch({ vehicleId, source = null }) {
    let query = supabaseClient
      .from('vehicle_raw_data')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('data_type', 'discovery');
    
    // Filter by specific source if provided
    if (source && this.supportsSource(source)) {
      query = query.eq('source', source);
    } else if (!source) {
      // If no specific source, include all supported sources
      query = query.in('source', this.supportedSources);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching marketplace data:', error);
      return [];
    }
    
    return data || [];
  }

  /**
   * Transforms raw marketplace data into standardized timeline events
   * @param {Array} rawData - Raw data from the source
   * @returns {Array} Transformed timeline events
   */
  transform(rawData) {
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      return [];
    }
    
    return rawData.map(record => {
      const sourceData = record.data;
      const source = record.source;
      
      // Calculate a confidence score based on data completeness and source reliability
      const confidenceFactors = {
        hasVin: sourceData.vin ? 0.2 : 0,
        hasYear: sourceData.year ? 0.15 : 0,
        hasMakeModel: (sourceData.make && sourceData.model) ? 0.15 : 0,
        hasImages: (sourceData.images && sourceData.images.length > 0) ? 0.15 : 0,
        hasPrice: sourceData.price ? 0.15 : 0,
        sourceWeight: this.sourceWeights[source] || 0.5
      };
      
      // Calculate overall confidence score
      const confidenceScore = calculateConfidenceScore({
        baseScore: 0.6,
        factors: confidenceFactors
      });
      
      // Create a timeline event from the marketplace data
      const event = {
        vehicle_id: record.vehicle_id,
        event_type: 'listing',
        source: source,
        source_id: sourceData.url || null,
        event_date: sourceData.discovered_at || record.created_at,
        title: `Vehicle listed on ${source === 'craigslist' ? 'Craigslist' : 'Facebook Marketplace'}`,
        description: sourceData.description || `This vehicle was found listed on ${source === 'craigslist' ? 'Craigslist' : 'Facebook Marketplace'}.`,
        confidence_score: confidenceScore,
        metadata: {
          price: sourceData.price,
          url: sourceData.url,
          discovered_at: sourceData.discovered_at,
          listing_title: sourceData.title
        },
        image_urls: sourceData.images || []
      };
      
      return event;
    });
  }

  /**
   * Validates transformed data before saving
   * @param {Array} transformedData - Transformed timeline events
   * @returns {Array} Validated timeline events
   */
  validate(transformedData) {
    if (!transformedData || !Array.isArray(transformedData)) {
      return [];
    }
    
    return transformedData.filter(event => {
      // Filter out events without required fields
      return (
        event.vehicle_id &&
        event.event_type &&
        event.source &&
        event.event_date &&
        event.title
      );
    });
  }

  /**
   * Saves validated marketplace events to the timeline
   * @param {Array} validatedData - Validated timeline events
   * @returns {Promise<Object>} Result of the save operation
   */
  async save(validatedData) {
    if (!validatedData || validatedData.length === 0) {
      return { inserted: 0, errors: [] };
    }
    
    try {
      // Insert all events into the timeline
      const { data, error } = await supabaseClient
  .insert(validatedData);
      
      if (error) {
        console.error('Error saving marketplace events to timeline:', error);
        return { inserted: 0, errors: [error] };
      }
      
      return { inserted: validatedData.length, errors: [] };
    } catch (error) {
      console.error('Exception saving marketplace events:', error);
      return { inserted: 0, errors: [error] };
    }
  }

  /**
   * Process marketplace data through the complete pipeline
   * @param {Object} params - Processing parameters
   * @returns {Promise<Object>} Processing results
   */
  async process(params) {
    try {
      const rawData = await this.fetch(params);
      const transformedData = this.transform(rawData);
      const validatedData = this.validate(transformedData);
      const saveResult = await this.save(validatedData);
      
      return {
        source: this.name,
        rawCount: rawData.length,
        transformedCount: transformedData.length,
        validatedCount: validatedData.length,
        savedCount: saveResult.inserted,
        errors: saveResult.errors
      };
    } catch (error) {
      console.error('Error processing marketplace data:', error);
      return {
        source: this.name,
        rawCount: 0,
        transformedCount: 0,
        validatedCount: 0,
        savedCount: 0,
        errors: [error]
      };
    }
  }
}

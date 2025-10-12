import { supabase } from '../lib/supabase';
import type { DataSource, FieldAnnotation, VehicleModification } from '../types/dataSource';

export class DataSourceService {
  /**
   * Create a new data source entry for a vehicle field
   */
  static async createDataSource(dataSource: Omit<DataSource, 'id' | 'created_at' | 'updated_at'>): Promise<DataSource | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_data_sources')
        .insert(dataSource)
        .select()
        .single();

      if (error) {
        console.error('Error creating data source:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error creating data source:', error);
      return null;
    }
  }

  /**
   * Get all data sources for a specific vehicle field
   */
  static async getFieldDataSources(vehicleId: string, fieldName: string): Promise<DataSource[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_data_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('field_name', fieldName)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching field data sources:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching field data sources:', error);
      return [];
    }
  }

  /**
   * Get annotation data for a specific field
   */
  static async getFieldAnnotation(vehicleId: string, fieldName: string): Promise<FieldAnnotation | null> {
    try {
      const sources = await this.getFieldDataSources(vehicleId, fieldName);
      
      if (sources.length === 0) {
        return null;
      }

      // Find primary source (highest confidence, most recent)
      const primarySource = sources.reduce((best, current) => {
        if (current.confidence_score > best.confidence_score) {
          return current;
        }
        if (current.confidence_score === best.confidence_score && 
            new Date(current.created_at) > new Date(best.created_at)) {
          return current;
        }
        return best;
      });

      // Find conflicting sources (different values)
      const conflictingSources = sources.filter(
        source => source.field_value !== primarySource.field_value && source.id !== primarySource.id
      );

      // Determine verification level
      const verificationLevel = this.determineVerificationLevel(sources);

      return {
        fieldName,
        sources,
        primarySource,
        conflictingSources: conflictingSources.length > 0 ? conflictingSources : undefined,
        lastUpdated: sources[0].created_at,
        verificationLevel
      };
    } catch (error) {
      console.error('Error getting field annotation:', error);
      return null;
    }
  }

  /**
   * Get annotations for multiple fields at once
   */
  static async getVehicleAnnotations(vehicleId: string, fieldNames: string[]): Promise<Record<string, FieldAnnotation>> {
    try {
      const annotations: Record<string, FieldAnnotation> = {};
      
      const promises = fieldNames.map(async (fieldName) => {
        const annotation = await this.getFieldAnnotation(vehicleId, fieldName);
        if (annotation) {
          annotations[fieldName] = annotation;
        }
      });

      await Promise.all(promises);
      return annotations;
    } catch (error) {
      console.error('Error getting vehicle annotations:', error);
      return {};
    }
  }

  /**
   * Track data from web scraping
   */
  static async trackScrapedData(
    vehicleId: string, 
    scrapedData: Record<string, any>, 
    sourceUrl: string,
    contributorId?: string
  ): Promise<void> {
    try {
      const dataSourcePromises = Object.entries(scrapedData).map(([fieldName, value]) => {
        if (value === null || value === undefined || value === '') {
          return Promise.resolve();
        }

        return this.createDataSource({
          vehicle_id: vehicleId,
          field_name: fieldName,
          field_value: String(value),
          source_type: 'web_scrape',
          source_url: sourceUrl,
          source_entity: this.extractDomainName(sourceUrl),
          source_metadata: { scraping_timestamp: new Date().toISOString() },
          contributor_id: contributorId,
          confidence_score: 0.7, // Default confidence for scraped data
          verification_status: 'unverified',
          is_active: true
        });
      });

      await Promise.all(dataSourcePromises);
    } catch (error) {
      console.error('Error tracking scraped data:', error);
    }
  }

  /**
   * Track user-uploaded data
   */
  static async trackUserData(
    vehicleId: string,
    fieldName: string,
    value: string,
    contributorId: string,
    metadata: Record<string, any> = {}
  ): Promise<DataSource | null> {
    return this.createDataSource({
      vehicle_id: vehicleId,
      field_name: fieldName,
      field_value: value,
      source_type: 'user_upload',
      source_metadata: metadata,
      contributor_id: contributorId,
      confidence_score: 0.9, // High confidence for user data
      verification_status: 'unverified',
      is_active: true
    });
  }

  /**
   * Create a vehicle modification record
   */
  static async createModification(modification: Omit<VehicleModification, 'id' | 'created_at' | 'updated_at'>): Promise<VehicleModification | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_modifications')
        .insert(modification)
        .select()
        .single();

      if (error) {
        console.error('Error creating modification:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error creating modification:', error);
      return null;
    }
  }

  /**
   * Get all modifications for a vehicle
   */
  static async getVehicleModifications(vehicleId: string): Promise<VehicleModification[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_modifications')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('modification_date', { ascending: false });

      if (error) {
        console.error('Error fetching modifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching modifications:', error);
      return [];
    }
  }

  /**
   * Determine verification level based on sources
   */
  private static determineVerificationLevel(sources: DataSource[]): 'unverified' | 'basic' | 'professional' | 'multi_verified' {
    const verifiedSources = sources.filter(s => s.verification_status !== 'unverified');
    const multiVerified = sources.filter(s => s.verification_status === 'multi_verified');
    const humanVerified = sources.filter(s => s.verification_status === 'human_verified');

    if (multiVerified.length > 0) return 'multi_verified';
    if (verifiedSources.length > 1) return 'professional';
    if (humanVerified.length > 0) return 'basic';
    return 'unverified';
  }

  /**
   * Extract domain name from URL
   */
  private static extractDomainName(url: string): string {
    try {
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch {
      return url;
    }
  }
}

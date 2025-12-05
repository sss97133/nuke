/**
 * Organization Intelligence Service
 * 
 * Determines UI configuration for organizations based on:
 * 1. Explicit UI config (highest priority - user set)
 * 2. Explicit business type/specializations (medium priority)
 * 3. Data-driven analysis (lowest priority - only if explicit missing)
 * 
 * NEVER overwrites explicit settings - only enhances when missing
 */

import { supabase } from '../lib/supabase';

export interface OrganizationIntelligence {
  source: 'explicit_ui_config' | 'explicit_business_type' | 'data_driven' | 'default';
  config: {
    type?: string;
    primary_focus?: 'service' | 'inventory' | 'collection' | 'mixed';
    specializations?: string[];
    confidence?: number;
  };
  respectExplicit: boolean;
  effectiveType: string;
  effectivePrimaryFocus: string;
  dataSignals?: {
    vehicles: {
      total: number;
      service: number;
      inventory: number;
      sold: number;
    };
    receipts: {
      total: number;
      with_labor: number;
      with_parts: number;
      avg_value: number;
      total_investment: number;
    };
    timeline: {
      total_events: number;
      work_events: number;
      avg_duration_hours: number;
    };
    images: {
      total: number;
      work_in_progress: number;
      finished_work: number;
    };
    inferred_type?: string;
    primary_focus?: string;
    confidence?: number;
  };
}

export interface TabConfig {
  id: string;
  priority: number;
  label: string;
  badge?: number;
}

export class OrganizationIntelligenceService {
  /**
   * Get effective organization configuration
   * Respects explicit settings, uses data-driven as fallback
   */
  static async getIntelligence(organizationId: string): Promise<OrganizationIntelligence | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_effective_org_config', {
          p_organization_id: organizationId
        });

      if (error) {
        console.error('Error getting org intelligence:', error);
        return null;
      }

      if (!data) return null;

      return {
        source: data.source,
        config: data.config || {},
        respectExplicit: data.respect_explicit || false,
        effectiveType: data.effective_type || 'unknown',
        effectivePrimaryFocus: data.effective_primary_focus || 'mixed',
        dataSignals: data.data_signals
      };
    } catch (error) {
      console.error('Error in getIntelligence:', error);
      return null;
    }
  }

  /**
   * Analyze data signals for an organization
   * Updates data_signals column in businesses table
   */
  static async analyzeDataSignals(organizationId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('analyze_organization_data_signals', {
          p_organization_id: organizationId
        });

      if (error) {
        console.error('Error analyzing data signals:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in analyzeDataSignals:', error);
      return null;
    }
  }

  /**
   * Determine tab priority based on intelligence
   * Respects explicit settings, uses data-driven as fallback
   */
  static determineTabPriority(
    intelligence: OrganizationIntelligence,
    dataSignals: any
  ): TabConfig[] {
    const tabs: TabConfig[] = [];

    // ALWAYS show Overview first
    tabs.push({ id: 'overview', priority: 100, label: 'Overview' });

    const primaryFocus = intelligence.effectivePrimaryFocus;
    const source = intelligence.source;

    // If explicit settings exist, respect them
    if (source === 'explicit_ui_config' || source === 'explicit_business_type') {
      // Use explicit type to determine tabs
      const effectiveType = intelligence.effectiveType;

      if (effectiveType === 'body_shop' || 
          effectiveType === 'garage' || 
          effectiveType === 'restoration_shop' ||
          effectiveType === 'performance_shop') {
        // Explicitly a service org - always show service tab
        const serviceCount = dataSignals?.vehicles?.service || 0;
        tabs.push({
          id: 'service',
          priority: 90,
          label: serviceCount > 0 ? `Service (${serviceCount})` : 'Service',
          badge: serviceCount > 0 ? serviceCount : undefined
        });

        if (dataSignals?.receipts?.total > 0) {
          tabs.push({
            id: 'receipts',
            priority: 85,
            label: `Work Orders (${dataSignals.receipts.total})`,
            badge: dataSignals.receipts.total
          });
        }

        // Inventory is lower priority for service orgs
        if (dataSignals?.vehicles?.inventory > 0) {
          tabs.push({
            id: 'inventory',
            priority: 60,
            label: `Inventory (${dataSignals.vehicles.inventory})`,
            badge: dataSignals.vehicles.inventory
          });
        }

        // Sold is very low priority
        if (dataSignals?.vehicles?.sold > 5) {
          tabs.push({
            id: 'sold',
            priority: 30,
            label: `Sold (${dataSignals.vehicles.sold})`,
            badge: dataSignals.vehicles.sold
          });
        }
      } else if (effectiveType === 'dealership') {
        // Explicitly a dealer
        if (dataSignals?.vehicles?.inventory > 0) {
          tabs.push({
            id: 'inventory',
            priority: 95,
            label: `Inventory (${dataSignals.vehicles.inventory})`,
            badge: dataSignals.vehicles.inventory
          });
        }

        if (dataSignals?.vehicles?.sold > 0) {
          tabs.push({
            id: 'sold',
            priority: 80,
            label: `Sold (${dataSignals.vehicles.sold})`,
            badge: dataSignals.vehicles.sold
          });
        }

        // Service is lower priority for dealers
        if (dataSignals?.vehicles?.service > 3) {
          tabs.push({
            id: 'service',
            priority: 40,
            label: `Service (${dataSignals.vehicles.service})`,
            badge: dataSignals.vehicles.service
          });
        }
      }
    } else {
      // No explicit settings - use data-driven intelligence
      if (primaryFocus === 'service') {
        // Always show service tab for service-focused orgs
        const serviceCount = dataSignals?.vehicles?.service || 0;
        tabs.push({
          id: 'service',
          priority: 90,
          label: serviceCount > 0 ? `Service (${serviceCount})` : 'Service',
          badge: serviceCount > 0 ? serviceCount : undefined
        });

        if (dataSignals?.receipts?.total > 0) {
          tabs.push({
            id: 'receipts',
            priority: 85,
            label: `Work Orders (${dataSignals.receipts.total})`,
            badge: dataSignals.receipts.total
          });
        }

        if (dataSignals?.vehicles?.inventory > 0) {
          tabs.push({
            id: 'inventory',
            priority: 60,
            label: `Inventory (${dataSignals.vehicles.inventory})`,
            badge: dataSignals.vehicles.inventory
          });
        }
      } else if (primaryFocus === 'inventory') {
        if (dataSignals?.vehicles?.inventory > 0) {
          tabs.push({
            id: 'inventory',
            priority: 95,
            label: `Inventory (${dataSignals.vehicles.inventory})`,
            badge: dataSignals.vehicles.inventory
          });
        }

        if (dataSignals?.vehicles?.sold > 0) {
          tabs.push({
            id: 'sold',
            priority: 80,
            label: `Sold (${dataSignals.vehicles.sold})`,
            badge: dataSignals.vehicles.sold
          });
        }
      }
    }

    // Always available but lower priority
    tabs.push({ id: 'images', priority: 70, label: 'Images' });
    tabs.push({ id: 'contributors', priority: 50, label: 'Contributors' });
    tabs.push({ id: 'marketplace', priority: 40, label: 'Marketplace' });
    tabs.push({ id: 'notifications', priority: 20, label: 'Notifications' });

    // Sort by priority (highest first)
    return tabs.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get service vehicles with receipt summaries
   */
  static async getServiceVehicles(organizationId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_service_vehicles_for_org', {
          p_organization_id: organizationId
        });

      if (error) {
        console.error('Error getting service vehicles:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getServiceVehicles:', error);
      return [];
    }
  }
}


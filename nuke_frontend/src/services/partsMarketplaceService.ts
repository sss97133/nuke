/**
 * Parts Marketplace Service
 * 
 * Searches for parts across multiple suppliers:
 * - AutoZone, O'Reilly, RockAuto (common)
 * - CJ Pony Parts, LMC Truck, Summit Racing (specialty)
 * 
 * Uses YMM + location + part name to find availability
 */

import { supabase } from '../lib/supabase';

export interface PartSearchParams {
  partName: string;
  year?: number;
  make?: string;
  model?: string;
  location?: { zip?: string; lat?: number; lng?: number };
  suppliers?: string[];
}

export interface PartSupplier {
  id: string;
  name: string;
  url: string;
  price?: number;
  inStock: boolean;
  shippingDays?: number;
  location?: string;
  distance?: number; // miles
}

export interface PartSearchResult {
  partName: string;
  oemPartNumber?: string;
  aftermarketPartNumbers?: string[];
  suppliers: PartSupplier[];
  bestPrice?: number;
  fastestShipping?: number;
  closestStore?: PartSupplier;
}

/**
 * Search for parts across multiple suppliers
 * 
 * This is a placeholder that will integrate with:
 * 1. Supplier APIs (when available)
 * 2. Web scraping (for suppliers without APIs)
 * 3. Cached results (to avoid rate limits)
 */
export async function searchParts(params: PartSearchParams): Promise<PartSearchResult> {
  const { partName, year, make, model, location, suppliers } = params;

  // For now, return mock data structure
  // TODO: Integrate with actual supplier APIs
  
  const mockSuppliers: PartSupplier[] = [
    {
      id: 'autozone-1',
      name: 'AutoZone',
      url: `https://www.autozone.com/search?searchText=${encodeURIComponent(partName)}`,
      price: undefined, // Would come from API
      inStock: true,
      shippingDays: 2,
      location: location?.zip ? `Store near ${location.zip}` : undefined
    },
    {
      id: 'oreilly-1',
      name: "O'Reilly Auto Parts",
      url: `https://www.oreillyauto.com/search?q=${encodeURIComponent(partName)}`,
      price: undefined,
      inStock: true,
      shippingDays: 1,
      location: location?.zip ? `Store near ${location.zip}` : undefined
    },
    {
      id: 'rockauto-1',
      name: 'RockAuto',
      url: `https://www.rockauto.com/en/catalog/${make?.toLowerCase()},${year},${model?.toLowerCase()},${encodeURIComponent(partName)}`,
      price: undefined,
      inStock: true,
      shippingDays: 3
    }
  ];

  // Add specialty suppliers based on vehicle type
  if (make?.toLowerCase().includes('ford') || make?.toLowerCase().includes('mustang')) {
    mockSuppliers.push({
      id: 'cjpony-1',
      name: 'CJ Pony Parts',
      url: `https://www.cjponyparts.com/search?q=${encodeURIComponent(partName)}`,
      price: undefined,
      inStock: true,
      shippingDays: 2
    });
  }

  if (make?.toLowerCase().includes('chevrolet') || make?.toLowerCase().includes('gmc') || 
      make?.toLowerCase().includes('truck')) {
    mockSuppliers.push({
      id: 'lmc-1',
      name: 'LMC Truck',
      url: `https://www.lmctruck.com/search?q=${encodeURIComponent(partName)}`,
      price: undefined,
      inStock: true,
      shippingDays: 2
    });
  }

  // Add Summit Racing for performance parts
  mockSuppliers.push({
    id: 'summit-1',
    name: 'Summit Racing',
    url: `https://www.summitracing.com/search?keyword=${encodeURIComponent(partName)}`,
    price: undefined,
    inStock: true,
    shippingDays: 2
  });

  return {
    partName,
    suppliers: mockSuppliers,
    bestPrice: undefined, // Would calculate from actual prices
    fastestShipping: 1,
    closestStore: location ? mockSuppliers[0] : undefined
  };
}

/**
 * Track part order through our system
 */
export async function trackPartOrder(params: {
  userId: string;
  vehicleId: string;
  partName: string;
  supplierId: string;
  supplierName: string;
  price?: number;
  orderUrl: string;
  imageId?: string; // Image where part was clicked
}) {
  try {
    // Create order record
    const { data, error } = await supabase
      .from('part_orders')
      .insert({
        user_id: params.userId,
        vehicle_id: params.vehicleId,
        part_name: params.partName,
        supplier_id: params.supplierId,
        supplier_name: params.supplierName,
        price: params.price,
        order_url: params.orderUrl,
        image_id: params.imageId,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error tracking part order:', error);
    throw error;
  }
}

/**
 * Document part installation
 */
export async function documentInstallation(params: {
  orderId: string;
  vehicleId: string;
  partName: string;
  installationDate: string;
  installationImages?: string[]; // Image IDs
  notes?: string;
  laborHours?: number;
  difficulty?: 'easy' | 'moderate' | 'hard' | 'expert';
}) {
  try {
    // Update order status
    await supabase
      .from('part_orders')
      .update({
        status: 'installed',
        installed_at: params.installationDate
      })
      .eq('id', params.orderId);

    // Create installation record
    const { data, error } = await supabase
      .from('part_installations')
      .insert({
        order_id: params.orderId,
        vehicle_id: params.vehicleId,
        part_name: params.partName,
        installation_date: params.installationDate,
        installation_images: params.installationImages,
        notes: params.notes,
        labor_hours: params.laborHours,
        difficulty: params.difficulty,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Create timeline event
    await supabase
      .from('vehicle_timeline_events')
      .insert({
        vehicle_id: params.vehicleId,
        event_type: 'part_installation',
        title: `Installed ${params.partName}`,
        description: params.notes,
        event_date: params.installationDate,
        metadata: {
          order_id: params.orderId,
          installation_id: data.id,
          labor_hours: params.laborHours,
          difficulty: params.difficulty
        }
      });

    return data;
  } catch (error) {
    console.error('Error documenting installation:', error);
    throw error;
  }
}

/**
 * Calculate job stats from completed installations
 */
export async function calculateJobStats(vehicleId: string) {
  try {
    const { data: installations, error } = await supabase
      .from('part_installations')
      .select('*')
      .eq('vehicle_id', vehicleId);

    if (error) throw error;

    const stats = {
      totalInstallations: installations?.length || 0,
      totalLaborHours: installations?.reduce((sum, i) => sum + (i.labor_hours || 0), 0) || 0,
      averageLaborHours: 0,
      difficultyBreakdown: {
        easy: 0,
        moderate: 0,
        hard: 0,
        expert: 0
      },
      totalSpent: 0, // Would sum from part_orders
      partsByCategory: {} as Record<string, number>
    };

    if (installations && installations.length > 0) {
      stats.averageLaborHours = stats.totalLaborHours / installations.length;

      installations.forEach(inst => {
        if (inst.difficulty) {
          stats.difficultyBreakdown[inst.difficulty]++;
        }
      });
    }

    return stats;
  } catch (error) {
    console.error('Error calculating job stats:', error);
    throw error;
  }
}


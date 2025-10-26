/**
 * Vehicle Valuation Service
 * Single source of truth for all vehicle pricing/valuation data
 * Used by VehiclePricingWidget, VehicleBuildSystem, and other components
 */

import { supabase } from '../lib/supabase';

export interface VehicleValuation {
  // Core investment data
  totalInvested: number;
  buildBudget: number;
  
  // Calculated values
  estimatedValue: number;
  marketLow: number;
  marketHigh: number;
  
  // Confidence and sources
  confidence: number;
  dataSources: string[];
  
  // Breakdown details
  partsInvestment: number;
  laborHours: number;
  installedParts: number;
  pendingParts: number;
  
  // Top line items with image evidence
  topParts: Array<{
    name: string;
    price: number;
    images?: Array<{
      url: string;
      tags: string[];
    }>;
  }>;
  
  // Metadata
  lastUpdated: string;
  hasRealData: boolean;
}

export class VehicleValuationService {
  private static cache = new Map<string, { data: VehicleValuation; timestamp: number }>();
  private static CACHE_TTL = 60000; // 1 minute cache

  /**
   * Get comprehensive vehicle valuation from all data sources
   * This is the SINGLE SOURCE OF TRUTH for vehicle value
   * 
   * Uses AI-powered valuation function that considers:
   * - AI-detected parts and systems
   * - Documented labor hours
   * - Documentation quality
   * - Condition assessment from AI tags
   */
  static async getValuation(vehicleId: string): Promise<VehicleValuation> {
    // Check cache
    const cached = this.cache.get(vehicleId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Try AI-powered valuation first (most accurate)
      const { data: aiValuation, error: aiError } = await supabase
        .rpc('calculate_ai_vehicle_valuation', { p_vehicle_id: vehicleId });

      if (!aiError && aiValuation && aiValuation.length > 0) {
        const av = aiValuation[0];
        const valuation: VehicleValuation = {
          totalInvested: parseFloat(av.base_value) + parseFloat(av.parts_value) + parseFloat(av.labor_value),
          buildBudget: 0,
          estimatedValue: parseFloat(av.estimated_value),
          marketLow: parseFloat(av.estimated_value) * 0.85,
          marketHigh: parseFloat(av.estimated_value) * 1.15,
          confidence: parseFloat(av.confidence_score),
          dataSources: av.data_sources || [],
          partsInvestment: parseFloat(av.parts_value),
          laborHours: av.breakdown?.labor_hours || 0,
          installedParts: av.breakdown?.parts_detected || 0,
          pendingParts: 0,
          topParts: [],
          lastUpdated: new Date().toISOString(),
          hasRealData: true
        };

        // Cache and return
        this.cache.set(vehicleId, {
          data: valuation,
          timestamp: Date.now()
        });

        return valuation;
      }

      // Fallback to legacy method if AI valuation fails
      console.warn('AI valuation failed, using legacy method');
    } catch (error) {
      console.error('AI valuation error:', error);
    }

    try {
      // Initialize valuation object
      const valuation: VehicleValuation = {
        totalInvested: 0,
        buildBudget: 0,
        estimatedValue: 0,
        marketLow: 0,
        marketHigh: 0,
        confidence: 0,
        dataSources: [],
        partsInvestment: 0,
        laborHours: 0,
        installedParts: 0,
        pendingParts: 0,
        topParts: [],
        lastUpdated: new Date().toISOString(),
        hasRealData: false
      };

      // 1. Prefer real receipts normalized from documents
      const { data: receipts } = await supabase
        .from('receipts')
        .select('id, total, created_at')
        .eq('scope_type', 'vehicle')
        .eq('scope_id', vehicleId);

      if (receipts && receipts.length > 0) {
        const receiptsTotal = receipts.reduce((sum: number, r: any) => sum + (r.total || 0), 0);
        valuation.totalInvested = Math.max(valuation.totalInvested, receiptsTotal);
        valuation.hasRealData = true;
        if (!valuation.dataSources.includes('Build Receipts')) {
          valuation.dataSources.push('Build Receipts');
        }
        valuation.confidence = Math.max(valuation.confidence, 85);

        const receiptIds = receipts.map((r: any) => r.id);
        if (receiptIds.length > 0) {
          const { data: receiptItems } = await supabase
            .from('receipt_items')
            .select('receipt_id, description, total_price')
            .in('receipt_id', receiptIds);

          if (receiptItems && receiptItems.length > 0) {
            // Aggregate by description to form parts list
            const partsMap = new Map<string, number>();
            receiptItems.forEach((it: any) => {
              const key = (it.description || 'Unknown').trim();
              const amt = it.total_price || 0;
              partsMap.set(key, (partsMap.get(key) || 0) + amt);
            });

            const partsArray = Array.from(partsMap.entries()).map(([name, price]) => ({ name, price }));
            partsArray.sort((a, b) => (b.price || 0) - (a.price || 0));
            const topItems = partsArray.slice(0, 5);

            // Fetch related images via image_tags matching part names
            let imagesByPart = new Map<string, any[]>();
            if (topItems.length > 0) {
              const orClause = topItems
                .map(p => `tag_name.ilike.%${p.name.replace(/[%]/g, '')}%`)
                .join(',');
              const { data: tagRows } = await supabase
                .from('image_tags')
                .select(`
                  tag_name,
                  vehicle_images!inner (
                    image_url,
                    thumbnail_url,
                    vehicle_id
                  )
                `)
                .eq('vehicle_images.vehicle_id', vehicleId)
                .or(orClause);

              imagesByPart = new Map<string, any[]>();
              tagRows?.forEach((tag: any) => {
                topItems.forEach(p => {
                  if ((tag.tag_name || '').toLowerCase().includes(p.name.toLowerCase())) {
                    if (!imagesByPart.has(p.name)) imagesByPart.set(p.name, []);
                    const url = tag.vehicle_images?.thumbnail_url || tag.vehicle_images?.image_url;
                    if (url) imagesByPart.get(p.name)!.push({ url, tags: [tag.tag_name] });
                  }
                });
              });
            }

            valuation.topParts = topItems.map(p => ({
              name: p.name,
              price: p.price || 0,
              images: (imagesByPart.get(p.name) || []).slice(0, 3)
            }));
            valuation.partsInvestment = partsArray.reduce((sum, x) => sum + (x.price || 0), 0);
          }
        }
      }

      // 2. Get build data (legacy). Only fill gaps not already provided by receipts
      const { data: buildData } = await supabase
        .from('vehicle_builds')
        .select('id, total_spent, total_budget')
        .eq('vehicle_id', vehicleId)
        .single();

      if (buildData) {
        valuation.totalInvested = Math.max(valuation.totalInvested, buildData.total_spent || 0);
        valuation.buildBudget = buildData.total_budget || 0;
        
        if (buildData.total_spent > 0) {
          valuation.hasRealData = true;
          valuation.dataSources.push('Build Receipts');
          valuation.confidence = Math.max(valuation.confidence, 85);
        }

        // Get line items
        if (buildData.id) {
          const { data: lineItems } = await supabase
            .from('build_line_items')
            .select('name, total_price, status, days_to_install')
            .eq('build_id', buildData.id);

          if (lineItems) {
            // Calculate parts investment
            if (!valuation.partsInvestment || valuation.partsInvestment === 0) {
              valuation.partsInvestment = lineItems.reduce((sum, item) => 
                sum + (item.total_price || 0), 0);
            }
            
            // Count installed vs pending
            valuation.installedParts = lineItems.filter(item => 
              item.status === 'completed' || item.status === 'installed').length;
            valuation.pendingParts = lineItems.filter(item => 
              item.status === 'ordered' || item.status === 'received').length;
            
            // Calculate labor hours
            valuation.laborHours = lineItems.reduce((sum, item) => 
              sum + ((item.days_to_install || 0) * 8), 0);
            
            // Get top 5 most expensive parts
            const topItems = valuation.topParts && valuation.topParts.length > 0
              ? []
              : lineItems
                .sort((a, b) => (b.total_price || 0) - (a.total_price || 0))
                .slice(0, 5);
            
            if (topItems.length > 0) {
              // PERFORMANCE FIX: Fetch all image tags in one query instead of N+1 queries
              const partNames = topItems.map(item => item.name);
              const { data: allImageTags } = await supabase
                .from('image_tags')
                .select(`
                  tag_name,
                  vehicle_images!inner (
                    image_url,
                    thumbnail_url,
                    vehicle_id
                  )
                `)
                .eq('vehicle_images.vehicle_id', vehicleId)
                .or(partNames.map(name => `tag_name.ilike.%${name}%`).join(','));

              // Group tags by part name for efficient lookup
              const tagsByPart = new Map<string, any[]>();
              allImageTags?.forEach((tag: any) => {
                partNames.forEach(partName => {
                  if ((tag.tag_name || '').toLowerCase().includes(partName.toLowerCase())) {
                    if (!tagsByPart.has(partName)) {
                      tagsByPart.set(partName, []);
                    }
                    tagsByPart.get(partName)!.push(tag);
                  }
                });
              });

              // Build topParts using cached data
              valuation.topParts = topItems.map(item => {
                const tags = tagsByPart.get(item.name)?.slice(0, 3) || [];
                const images = tags.map((tag: any) => ({
                  url: tag.vehicle_images?.thumbnail_url || tag.vehicle_images?.image_url,
                  tags: [tag.tag_name]
                })).filter((img: any) => img.url);

                return {
                  name: item.name,
                  price: item.total_price || 0,
                  images
                };
              });
            }

            if (lineItems.length > 0) {
              valuation.dataSources.push('Parts Inventory');
            }
          }
        }
      }

      // 2. Get market data including MarketCheck validated sources
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('make, model, year, vin')
        .eq('id', vehicleId)
        .single();

      if (vehicle) {
        // Get MarketCheck market data if available
        const { data: marketCheckData } = await supabase
          .from('market_data')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .in('source', ['marketcheck', 'marketcheck_history', 'marketcheck_trends'])
          .order('created_at', { ascending: false });

        let marketCheckValue = 0;
        let marketCheckConfidence = 0;

        if (marketCheckData && marketCheckData.length > 0) {
          // Process MarketCheck data for valuation
          const listingData = marketCheckData.find(d => d.source === 'marketcheck');
          const historyData = marketCheckData.find(d => d.source === 'marketcheck_history');
          const trendsData = marketCheckData.find(d => d.source === 'marketcheck_trends');

          if (listingData && listingData.price_value) {
            marketCheckValue = parseFloat(listingData.price_value);
            marketCheckConfidence = listingData.confidence_score || 70;
            
            // Adjust confidence based on additional data sources
            if (historyData) {
              marketCheckConfidence = Math.min(marketCheckConfidence + 15, 95);
              valuation.dataSources.push('MarketCheck History');
            }
            
            if (trendsData) {
              marketCheckConfidence = Math.min(marketCheckConfidence + 10, 95);
              valuation.dataSources.push('MarketCheck Trends');
            }
            
            valuation.dataSources.push('MarketCheck Live Data');
          }
        }

        // Get traditional comparables
        const { data: comparables } = await supabase
          .from('build_benchmarks')
          .select('sale_price')
          .eq('make', vehicle.make)
          .eq('year', vehicle.year)
          .limit(5);

        let comparablesValue = 0;
        if (comparables && comparables.length > 0) {
          comparablesValue = comparables.reduce((sum, c) => 
            sum + (c.sale_price || 0), 0) / comparables.length;
          valuation.dataSources.push('Market Comparables');
        }

        // Blend market values with preference for MarketCheck (more current)
        if (marketCheckValue > 0 && comparablesValue > 0) {
          // Weight MarketCheck higher due to real-time data
          const blendedMarketValue = (marketCheckValue * 0.7) + (comparablesValue * 0.3);
          
          if (valuation.totalInvested === 0) {
            valuation.estimatedValue = blendedMarketValue;
          } else {
            // Blend invested amount with market value
            valuation.estimatedValue = (valuation.totalInvested * 0.6) + (blendedMarketValue * 0.4);
          }
          
          valuation.confidence = Math.min(valuation.confidence + marketCheckConfidence * 0.3, 95);
        } else if (marketCheckValue > 0) {
          // Use MarketCheck data only
          if (valuation.totalInvested === 0) {
            valuation.estimatedValue = marketCheckValue;
          } else {
            valuation.estimatedValue = (valuation.totalInvested * 0.7) + (marketCheckValue * 0.3);
          }
          
          valuation.confidence = Math.min(valuation.confidence + marketCheckConfidence * 0.4, 95);
        } else if (comparablesValue > 0) {
          // Fallback to traditional comparables
          if (valuation.totalInvested === 0) {
            valuation.estimatedValue = comparablesValue;
          } else {
            valuation.estimatedValue = (valuation.totalInvested * 0.7) + (comparablesValue * 0.3);
          }
          
          valuation.confidence = Math.min(valuation.confidence + 10, 95);
        }
      }

      // 3. Check documentation quality and AI-tagged parts
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, image_url')
        .eq('vehicle_id', vehicleId);
      
      // Get AI-extracted part values from image tags
      const { data: valueTags } = await supabase
        .from('image_tags')
        .select(`
          text,
          metadata,
          vehicle_images!inner (
            vehicle_id
          )
        `)
        .eq('vehicle_images.vehicle_id', vehicleId)
        .in('tag_type', ['part', 'modification', 'component'])
        .not('metadata', 'is', null);
      
      // Extract prices from AI analysis
      let aiExtractedValue = 0;
      if (valueTags) {
        valueTags.forEach(tag => {
          if (tag.metadata?.estimated_value) {
            aiExtractedValue += tag.metadata.estimated_value;
          }
        });
        
        if (aiExtractedValue > 0) {
          valuation.dataSources.push('AI Image Analysis');
          valuation.confidence = Math.min(valuation.confidence + 15, 95);
        }
      }

      if (images && images.length > 10) {
        valuation.dataSources.push('Comprehensive Documentation');
        valuation.confidence = Math.min(valuation.confidence + 5, 95);
        
        // Add 5% premium for well-documented vehicle
        if (valuation.estimatedValue > 0) {
          valuation.estimatedValue *= 1.05;
        }
      }

      // 4. Calculate final values
      if (valuation.totalInvested > 0) {
        // Use actual investment as base
        valuation.estimatedValue = valuation.estimatedValue || valuation.totalInvested;
      }

      // Set market range
      if (valuation.estimatedValue > 0) {
        valuation.marketLow = valuation.estimatedValue * 0.85;
        valuation.marketHigh = valuation.estimatedValue * 1.15;
      }

      // Default confidence if no data
      if (valuation.confidence === 0) {
        valuation.confidence = valuation.hasRealData ? 70 : 0;
      }

      // Cache the result
      this.cache.set(vehicleId, {
        data: valuation,
        timestamp: Date.now()
      });

      return valuation;
    } catch (error) {
      console.error('Valuation error:', error);
      
      // Return empty valuation on error
      return {
        totalInvested: 0,
        buildBudget: 0,
        estimatedValue: 0,
        marketLow: 0,
        marketHigh: 0,
        confidence: 0,
        dataSources: [],
        partsInvestment: 0,
        laborHours: 0,
        installedParts: 0,
        pendingParts: 0,
        topParts: [],
        lastUpdated: new Date().toISOString(),
        hasRealData: false
      };
    }
  }

  /**
   * Clear cache for a specific vehicle
   */
  static clearCache(vehicleId?: string) {
    if (vehicleId) {
      this.cache.delete(vehicleId);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Format currency for display
   */
  static formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }
}

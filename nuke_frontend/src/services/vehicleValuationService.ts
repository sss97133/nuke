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
  // Category breakdown from receipts/build items
  categoryBreakdown?: Array<{ category: string; invested: number; marketValue: number }>;
  
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

    // Deterministic valuation using receipts, labor, and market data

    try {
      // FIRST: Check for expert agent valuation (most authoritative)
      const { data: expertValuation } = await supabase
        .from('vehicle_valuations')
        .select('id, estimated_value, documented_components, confidence_score, components, environmental_context, value_justification, valuation_date')
        .eq('vehicle_id', vehicleId)
        .order('valuation_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (expertValuation && expertValuation.estimated_value) {
        // Use expert valuation as primary source
        const valuation: VehicleValuation = {
          totalInvested: 0,
          buildBudget: 0,
          estimatedValue: expertValuation.estimated_value || 0,
          marketLow: (expertValuation.estimated_value || 0) * 0.85,
          marketHigh: (expertValuation.estimated_value || 0) * 1.15,
          confidence: expertValuation.confidence_score || 0,
          dataSources: ['AI Expert Analysis'],
          partsInvestment: 0,
          laborHours: 0,
          installedParts: expertValuation.documented_components?.length || 0,
          pendingParts: 0,
          topParts: (expertValuation.components || []).map((comp: any) => ({
            name: comp.name || comp.component || 'Unknown',
            price: comp.value || comp.estimated_value || 0,
            images: comp.images || []
          })),
          lastUpdated: expertValuation.valuation_date || new Date().toISOString(),
          hasRealData: true
        };
        
        // Cache and return
        this.cache.set(vehicleId, { data: valuation, timestamp: Date.now() });
        return valuation;
      }

      // Initialize valuation object (fallback to receipts/labor)
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
            .select('receipt_id, description, total_price, category')
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

            // Build category breakdown (use provided category or infer from description)
            const byCategory: Record<string, { invested: number; marketValue: number }> = {};
            const inferCategory = (desc?: string, cat?: string | null) => {
              const d = (desc || '').toLowerCase();
              const c = (cat || '').toLowerCase();
              if (c) return c.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
              if (/engine|motor|intake|exhaust|radiator|coolant|filter|spark/i.test(d)) return 'Engine';
              if (/brake|pad|rotor|caliper|master/i.test(d)) return 'Brakes';
              if (/suspension|shock|spring|coilover|strut/i.test(d)) return 'Suspension';
              if (/transmission|clutch|gear|drivetrain/i.test(d)) return 'Transmission';
              if (/tire|wheel|rim/i.test(d)) return 'Wheels & Tires';
              if (/body|panel|fender|hood|bumper|paint|wrap/i.test(d)) return 'Body/Paint';
              if (/interior|seat|trim|dash|carpet|stereo/i.test(d)) return 'Interior';
              if (/electrical|wiring|harness|battery|alternator/i.test(d)) return 'Electrical';
              return 'Misc';
            };
            receiptItems.forEach((it: any) => {
              const cat = inferCategory(it.description, it.category);
              if (!byCategory[cat]) byCategory[cat] = { invested: 0, marketValue: 0 };
              byCategory[cat].invested += it.total_price || 0;
              byCategory[cat].marketValue += (it.total_price || 0) * 1.15;
            });
            valuation.categoryBreakdown = Object.entries(byCategory).map(([category, v]) => ({ category, invested: v.invested, marketValue: v.marketValue }));
          }
        }
      }

      // 2. Get build data (legacy). Only fill gaps not already provided by receipts
      const { data: buildData } = await supabase
        .from('vehicle_builds')
        .select('id, total_spent, total_budget')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

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
        .select('make, model, year, vin, current_value, purchase_price, msrp')
        .eq('id', vehicleId)
        .single();

      let marketBase = 0;
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
            if (!isNaN(marketCheckValue) && marketCheckValue > 0) marketBase = marketCheckValue;
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
          marketBase = blendedMarketValue;
          
          if (valuation.totalInvested === 0) {
            valuation.estimatedValue = blendedMarketValue;
          } else {
            // Blend invested amount with market value
            valuation.estimatedValue = (valuation.totalInvested * 0.6) + (blendedMarketValue * 0.4);
          }
          
          valuation.confidence = Math.min(valuation.confidence + marketCheckConfidence * 0.3, 95);
        } else if (marketCheckValue > 0) {
          // Use MarketCheck data only
          marketBase = marketCheckValue;
          if (valuation.totalInvested === 0) {
            valuation.estimatedValue = marketCheckValue;
          } else {
            valuation.estimatedValue = (valuation.totalInvested * 0.7) + (marketCheckValue * 0.3);
          }
          
          valuation.confidence = Math.min(valuation.confidence + marketCheckConfidence * 0.4, 95);
        } else if (comparablesValue > 0) {
          // Fallback to traditional comparables
          marketBase = comparablesValue;
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

      // 3a. Get AI analysis results for quality assessment
      const { data: profileInsights } = await supabase
        .from('profile_image_insights')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('summary_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Use AI insights to detect build quality
      let buildQualityMultiplier = 1.0;
      if (profileInsights && profileInsights.checklist) {
        const checklist = profileInsights.checklist as any;
        
        // Professional build indicators
        const isProfessionalBuild = 
          checklist.paint_quality === 'professional' ||
          checklist.paint_quality === 'show_quality' ||
          checklist.build_quality === 'professional';
        
        const hasCustomWork =
          checklist.has_custom_interior === true ||
          checklist.has_custom_paint === true ||
          checklist.has_lift_kit === true;
        
        const isCleanBuild =
          checklist.rust_severity === 'none' ||
          checklist.rust_severity === 'surface' &&
          checklist.frame_visible_damage === false;
        
        // Apply quality multipliers
        if (isProfessionalBuild) {
          buildQualityMultiplier += 0.15; // +15% for professional work
          valuation.dataSources.push('AI: Professional Build Quality');
        }
        
        if (hasCustomWork) {
          buildQualityMultiplier += 0.10; // +10% for custom features
          valuation.dataSources.push('AI: Custom Features Detected');
        }
        
        if (isCleanBuild) {
          buildQualityMultiplier += 0.05; // +5% for clean condition
          valuation.dataSources.push('AI: Excellent Condition');
        }
        
        console.log(`AI build quality multiplier: ${buildQualityMultiplier}x`);
      }
      
      // 3b. Check structured vehicle documents (Receipts, Invoices, etc.)
      // Fetch all documents and filter client-side to avoid enum type issues with .in()
      let documents: any[] = [];
      try {
        let allDocs = null;
        let docsError = null;
        
        try {
          const result = await supabase
            .from('vehicle_documents')
            .select('document_type, title, amount, vendor_name, description')
            .eq('vehicle_id', vehicleId);
          allDocs = result.data;
          docsError = result.error;
        } catch (err: any) {
          // Table might not exist, handle gracefully
          if (err.code === 'PGRST301' || err.code === 'PGRST116' || err.code === '42P01') {
            docsError = null; // Table doesn't exist, just skip
            allDocs = [];
          } else {
            docsError = err;
          }
        }
        
        if (!docsError && allDocs) {
          // Filter client-side to avoid .in() syntax issues with enum types
          const validTypes = ['receipt', 'invoice', 'estimate', 'appraisal', 'service_record'];
          documents = allDocs.filter((doc: any) => 
            doc.document_type && validTypes.includes(String(doc.document_type))
          );
        }
      } catch (err) {
        console.warn('Error loading vehicle_documents:', err);
        documents = [];
      }

      if (documents && documents.length > 0) {
        const docTotal = documents.reduce((sum, doc) => sum + (doc.amount || 0), 0);
        if (docTotal > 0) {
          valuation.totalInvested += docTotal;
          valuation.hasRealData = true;
          if (!valuation.dataSources.includes('Verified Documents')) {
            valuation.dataSources.push('Verified Documents');
          }
          valuation.confidence = Math.min(valuation.confidence + 10, 95);
          
          // Add high-value docs to top parts list if not already there
          const docItems = documents
            .filter(d => d.amount && d.amount > 100)
            .map(d => ({
              name: d.title || d.description || d.vendor_name || 'Document',
              price: d.amount,
              images: [] // Documents might not have image previews in this context yet
            }))
            .sort((a, b) => b.price - a.price)
            .slice(0, 3);
            
          valuation.topParts = [...valuation.topParts, ...docItems]
            .sort((a, b) => b.price - a.price)
            .slice(0, 5);
        }
      }
      
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

      // 4. Include ALL documented work from work orders (parts, labor, materials, overhead)
      try {
        const { data: totalInvestedData, error: investedError } = await supabase
          .rpc('get_vehicle_total_invested', { p_vehicle_id: vehicleId });
        
        if (!investedError && totalInvestedData) {
          const totalInvested = totalInvestedData.total_invested || 0;
          const breakdown = totalInvestedData.breakdown || {};
          
          if (totalInvested > 0) {
            // Add to total invested
            valuation.totalInvested = Math.max(valuation.totalInvested, totalInvested);
            
            // Update parts investment
            if (breakdown.parts) {
              valuation.partsInvestment = Math.max(valuation.partsInvestment, breakdown.parts);
            }
            
            // Update labor hours (calculate from labor cost if available)
            if (breakdown.labor) {
              const avgLaborRate = 120; // Default rate
              const estimatedHours = breakdown.labor / avgLaborRate;
              valuation.laborHours = Math.max(valuation.laborHours, estimatedHours);
            }
            
            // Add data source
            if (!valuation.dataSources.includes('Work Orders')) {
              valuation.dataSources.push('Work Orders');
            }
            
            // Increase confidence based on comprehensive work data
            if (totalInvestedData.components_count?.events_with_work > 0) {
              valuation.confidence = Math.min(valuation.confidence + 10, 95);
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching total invested:', err);
      }
      
      // Fallback: Include documented labor from work sessions at $75/hr (if no work order data)
      if (valuation.totalInvested === 0) {
        try {
          const { data: workSessions } = await supabase
            .rpc('get_vehicle_work_sessions', { p_vehicle_id: vehicleId });
          const hours = (workSessions || []).reduce((sum: number, s: any) => sum + (s.labor_hours || 0), 0);
          if (hours > 0) {
            valuation.laborHours = Math.max(valuation.laborHours, hours);
            valuation.totalInvested += hours * 75;
            if (!valuation.dataSources.includes('Work Sessions')) valuation.dataSources.push('Work Sessions');
          }
        } catch {}
      }

      // 5. Calculate final values per new model: market + modifications premium + documentation bonus
      const documentationBonus = aiExtractedValue * 0.1;
      
      // Modification premium: modifications typically add 40-60% of their cost to market value
      const modificationPremium = valuation.totalInvested > 0 
        ? valuation.totalInvested * 0.5  // 50% of investment adds to value
        : 0;
      
      if (marketBase > 0) {
        // Base market value + modification premium + documentation bonus
        const premiumFromParts = Math.max(0, valuation.partsInvestment - marketBase * 0.5);
        valuation.estimatedValue = Math.max(
          Math.round(marketBase + premiumFromParts + modificationPremium + documentationBonus),
          valuation.estimatedValue || 0
        );
      } else if (valuation.totalInvested > 0 && !valuation.estimatedValue) {
        // If no market base, use total invested + modification premium + documentation bonus
        valuation.estimatedValue = Math.round(valuation.totalInvested + modificationPremium + documentationBonus);
      } else if (!valuation.estimatedValue && vehicle?.current_value) {
        // FALLBACK: Use database current_value if no other data
        valuation.estimatedValue = vehicle.current_value;
        valuation.dataSources.push('Vehicle Record');
        valuation.hasRealData = true;
        valuation.confidence = Math.max(valuation.confidence, 70);
      } else if (!valuation.estimatedValue && vehicle?.purchase_price) {
        // FALLBACK: Use purchase price if current_value missing
        valuation.estimatedValue = vehicle.purchase_price;
        valuation.dataSources.push('Purchase Price');
        valuation.hasRealData = true;
        valuation.confidence = Math.max(valuation.confidence, 60);
      } else if (!valuation.estimatedValue && vehicle?.msrp) {
        // FALLBACK: Use MSRP as last resort
        valuation.estimatedValue = vehicle.msrp;
        valuation.dataSources.push('Original MSRP');
        valuation.confidence = Math.max(valuation.confidence, 40);
      }

      // 5b. Apply AI condition caps/penalties using latest profile_image_insights checklist
      try {
        const { data: latestInsight } = await supabase
          .from('profile_image_insights')
          .select('confidence, condition_score, condition_label, checklist, summary_date')
          .eq('vehicle_id', vehicleId)
          .order('summary_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestInsight) {
          const cl: any = latestInsight.checklist || {};
          const isNonRunner = String(cl.rolling_state || '').toLowerCase() === 'non_runner';
          const engineMissing = cl.engine_present === false;
          const frameDamage = cl.frame_visible_damage === true;
          const rustPerf = String(cl.rust_severity || '').toLowerCase() === 'perforation';

          // Hard caps
          let capMultiplier = 1.0;
          if (isNonRunner || engineMissing) capMultiplier = Math.min(capMultiplier, 0.3);
          if (frameDamage || rustPerf) capMultiplier = Math.min(capMultiplier, 0.4);

          if (valuation.estimatedValue > 0 && capMultiplier < 1.0) {
            // Prefer capping relative to market base when available
            const anchor = marketBase > 0 ? marketBase : valuation.estimatedValue;
            const capped = Math.round(anchor * capMultiplier + Math.max(0, valuation.totalInvested - anchor) * 0.25);
            valuation.estimatedValue = Math.max(0, Math.min(valuation.estimatedValue, capped));
            if (!valuation.dataSources.includes('AI Condition Assessment')) {
              valuation.dataSources.push('AI Condition Assessment');
            }
            // Confidence adjustment: respect AI confidence when stricter
            const aiConf = typeof latestInsight.confidence === 'number' ? Math.round(latestInsight.confidence * 100) : null;
            if (aiConf !== null) {
              valuation.confidence = Math.min(valuation.confidence, Math.max(50, aiConf));
            } else {
              valuation.confidence = Math.min(valuation.confidence, 75);
            }
          }
        }
      } catch {
        // If insights unavailable, skip penalties silently
      }

      // Apply AI-detected build quality multiplier to final value
      if (buildQualityMultiplier > 1.0 && valuation.estimatedValue > 0) {
        const qualityAdjustment = valuation.estimatedValue * (buildQualityMultiplier - 1.0);
        console.log(`Applying AI quality adjustment: +$${Math.round(qualityAdjustment)}`);
        valuation.estimatedValue = Math.round(valuation.estimatedValue * buildQualityMultiplier);
        valuation.confidence = Math.min(valuation.confidence + 5, 95); // Increase confidence with AI data
      }

      // Set market range
      if (valuation.estimatedValue > 0) {
        valuation.marketLow = valuation.estimatedValue * 0.85;
        valuation.marketHigh = valuation.estimatedValue * 1.15;
      }

      // Confidence model: receipts 90 + market 5 + photos 5 (cap 95)
      let finalConfidence = 70;
      if (receipts && receipts.length > 0) finalConfidence = 90;
      if (marketBase > 0) finalConfidence += 5;
      if ((images?.length || 0) > 100) finalConfidence += 5;
      valuation.confidence = Math.min(finalConfidence, 95);

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

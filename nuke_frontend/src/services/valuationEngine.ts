/**
 * Valuation Engine - Truth-Based Vehicle Valuation
 * 
 * Core Principles:
 * 1. Purchase price establishes a FLOOR (you can't lose money instantly)
 * 2. Documented investments ADD to floor (receipts + labor)
 * 3. Images provide EVIDENCE for value claims
 * 4. Market data is REFERENCE, not override (unless selling)
 * 5. Visual documentation answers WHY: "Why is this worth $90k?"
 */

import { supabase } from '../lib/supabase';

export interface ValueLineItem {
  category: string;
  description: string;
  amount: number;
  date: string;
  evidence: {
    type: 'receipt' | 'photos' | 'labor_log' | 'title';
    imageUrls: string[];
    receiptId?: string;
    photoCount: number;
  };
  confidence: number; // 0-100
}

export interface ValuationResult {
  // Core numbers
  purchasePrice: number;          // What you paid (floor)
  documentedInvestments: number;  // Receipts + labor
  estimatedValue: number;         // Purchase + investments
  marketReference: number;        // What market says (for comparison only)
  
  // Value breakdown
  lineItems: ValueLineItem[];     // Every dollar accounted for
  
  // Confidence metrics
  overallConfidence: number;      // 0-100
  documentationScore: number;     // How well documented (0-100)
  
  // Visual evidence summary
  totalImages: number;
  imagesWithEvidence: number;     // Images linked to value claims
  
  // Market context (informational)
  marketRange: { low: number; high: number };
  marketPosition: 'above' | 'at' | 'below'; // vs market
  
  // Warnings/flags
  warnings: string[];
  flags: {
    overpaid?: boolean;           // Purchase > market by >30%
    underinvested?: boolean;      // Market suggests more work needed
    poorDocumentation?: boolean;  // <50% of investments have photo evidence
    valueAtRisk?: boolean;        // Condition/damage visible in photos
  };
}

export class ValuationEngine {
  
  /**
   * Main valuation function - builds truth-based estimate with visual evidence
   */
  static async calculateValuation(vehicleId: string): Promise<ValuationResult> {
    try {
      // 1. Get vehicle base data
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('purchase_price, purchase_date, make, model, year, vin, mileage')
        .eq('id', vehicleId)
        .single();

      if (!vehicle) {
        throw new Error('Vehicle not found');
      }

      const purchasePrice = vehicle.purchase_price || 0;
      const lineItems: ValueLineItem[] = [];
      const warnings: string[] = [];

      // 2. Add purchase price as first line item
      if (purchasePrice > 0) {
        // Find title/purchase evidence
        const { data: titleImages } = await supabase
          .from('vehicle_images')
          .select('image_url, variants')
          .eq('vehicle_id', vehicleId)
          .or('sensitive_type.eq.title,category.eq.title,category.eq.purchase_documents')
          .limit(5);

        lineItems.push({
          category: 'Purchase',
          description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          amount: purchasePrice,
          date: vehicle.purchase_date || 'Unknown',
          evidence: {
            type: 'title',
            imageUrls: (titleImages || []).map(i => i.variants?.thumbnail || i.image_url).filter(Boolean),
            photoCount: titleImages?.length || 0
          },
          confidence: titleImages && titleImages.length > 0 ? 100 : 70
        });
      } else {
        warnings.push('No purchase price recorded - using market estimate as floor');
      }

      // 3. Get all receipts with photo evidence
      const { data: receipts } = await supabase
        .from('receipts')
        .select(`
          id,
          total_amount,
          created_at,
          vendor_name,
          receipt_items (
            description,
            total_price,
            category
          )
        `)
        .eq('scope_type', 'vehicle')
        .eq('scope_id', vehicleId)
        .order('created_at', { ascending: true });

      let totalInvestments = 0;

      if (receipts && receipts.length > 0) {
        for (const receipt of receipts) {
          const receiptTotal = receipt.total_amount || 0;
          totalInvestments += receiptTotal;

          // Find photos taken around receipt date (within 7 days)
          const receiptDate = new Date(receipt.created_at);
          const dateMin = new Date(receiptDate);
          dateMin.setDate(dateMin.getDate() - 7);
          const dateMax = new Date(receiptDate);
          dateMax.setDate(dateMax.getDate() + 7);

          const { data: relatedImages } = await supabase
            .from('vehicle_images')
            .select('image_url, variants, category')
            .eq('vehicle_id', vehicleId)
            .gte('taken_at', dateMin.toISOString())
            .lte('taken_at', dateMax.toISOString())
            .limit(10);

          // Categorize receipt
          const items = receipt.receipt_items || [];
          const primaryCategory = this.categorizeReceipt(items, receipt.vendor_name);

          lineItems.push({
            category: primaryCategory,
            description: receipt.vendor_name || `${items.length} items`,
            amount: receiptTotal,
            date: receipt.created_at,
            evidence: {
              type: 'receipt',
              imageUrls: (relatedImages || []).map(i => i.variants?.thumbnail || i.image_url).filter(Boolean),
              receiptId: receipt.id,
              photoCount: relatedImages?.length || 0
            },
            confidence: relatedImages && relatedImages.length > 0 ? 95 : 80
          });
        }
      }

      // 4. Get documented labor hours
      const { data: laborEvents } = await supabase
        .from('timeline_events')
        .select('title, event_date, metadata')
        .eq('vehicle_id', vehicleId)
        .not('metadata->labor_hours', 'is', null)
        .order('event_date', { ascending: true });

      let totalLaborValue = 0;
      if (laborEvents && laborEvents.length > 0) {
        for (const event of laborEvents) {
          const hours = event.metadata?.labor_hours || 0;
          const rate = event.metadata?.labor_rate || 75; // $75/hr shop rate
          const laborValue = hours * rate;
          totalLaborValue += laborValue;

          // Find photos linked to this event
          const { data: eventImages } = await supabase
            .from('vehicle_images')
            .select('image_url, variants')
            .eq('vehicle_id', vehicleId)
            .eq('timeline_event_id', event.id || '')
            .limit(10);

          if (laborValue > 0) {
            lineItems.push({
              category: 'Labor',
              description: event.title || 'Work session',
              amount: laborValue,
              date: event.event_date,
              evidence: {
                type: 'labor_log',
                imageUrls: (eventImages || []).map(i => i.variants?.thumbnail || i.image_url).filter(Boolean),
                photoCount: eventImages?.length || 0
              },
              confidence: eventImages && eventImages.length > 3 ? 90 : 70
            });
          }
        }
      }

      totalInvestments += totalLaborValue;

      // 5. Get market reference (NOT used as floor, just context)
      let marketReference = 0;
      const { data: marketData } = await supabase
        .from('market_data')
        .select('price_value, source')
        .eq('vehicle_id', vehicleId)
        .in('source', ['marketcheck', 'marketcheck_history'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (marketData?.price_value) {
        marketReference = parseFloat(marketData.price_value);
      } else {
        // Fallback: check build_benchmarks for similar vehicles
        const { data: comps } = await supabase
          .from('build_benchmarks')
          .select('sale_price')
          .eq('make', vehicle.make)
          .eq('year', vehicle.year)
          .limit(10);

        if (comps && comps.length > 0) {
          const avgSale = comps.reduce((sum, c) => sum + (c.sale_price || 0), 0) / comps.length;
          marketReference = avgSale;
        }
      }

      // 6. Calculate estimated value using FLOOR + INVESTMENTS model
      const estimatedValue = purchasePrice + totalInvestments;

      // 7. Determine market position and warnings
      let marketPosition: 'above' | 'at' | 'below' = 'at';
      if (marketReference > 0) {
        const diff = estimatedValue - marketReference;
        const diffPct = (diff / marketReference) * 100;

        if (diffPct > 20) {
          marketPosition = 'above';
          warnings.push(`Estimated value is ${diffPct.toFixed(0)}% above market comps ($${marketReference.toLocaleString()})`);
        } else if (diffPct < -20) {
          marketPosition = 'below';
          warnings.push(`Estimated value is ${Math.abs(diffPct).toFixed(0)}% below market comps ($${marketReference.toLocaleString()})`);
        } else {
          marketPosition = 'at';
        }

        // Overpaid flag
        if (purchasePrice > marketReference * 1.3) {
          warnings.push(`⚠️ Purchase price ($${purchasePrice.toLocaleString()}) was ${((purchasePrice / marketReference - 1) * 100).toFixed(0)}% above market`);
        }
      }

      // 8. Calculate documentation score
      const { count: totalImageCount } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      const imagesWithEvidence = lineItems.reduce((sum, item) => sum + item.evidence.photoCount, 0);
      const documentationScore = totalImageCount && totalImageCount > 0
        ? Math.min((imagesWithEvidence / totalImageCount) * 100, 100)
        : 0;

      // 9. Calculate overall confidence
      const hasReceiptEvidence = lineItems.filter(i => i.evidence.type === 'receipt').length > 0;
      const hasPhotoEvidence = imagesWithEvidence > 10;
      const hasPurchaseProof = lineItems.find(i => i.category === 'Purchase')?.evidence.photoCount || 0 > 0;

      let overallConfidence = 50; // Base
      if (hasPurchaseProof) overallConfidence += 20;
      if (hasReceiptEvidence) overallConfidence += 20;
      if (hasPhotoEvidence) overallConfidence += 10;
      overallConfidence = Math.min(overallConfidence, 100);

      // 10. Flags
      const flags: ValuationResult['flags'] = {};
      
      if (purchasePrice > marketReference * 1.3) {
        flags.overpaid = true;
      }
      
      if (marketReference > estimatedValue * 1.2 && totalInvestments < marketReference * 0.1) {
        flags.underinvested = true;
        warnings.push('⚠️ Market suggests vehicle needs more work to reach full value');
      }
      
      if (documentationScore < 50) {
        flags.poorDocumentation = true;
        warnings.push('⚠️ Less than half of investments have photo evidence');
      }

      // Check for damage tags
      const { data: damageTags } = await supabase
        .from('image_tags')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .in('tag_type', ['damage', 'rust', 'crack', 'dent'])
        .limit(1);

      if (damageTags && damageTags.length > 0) {
        flags.valueAtRisk = true;
        warnings.push('⚠️ Damage detected in photos - may affect value');
      }

      return {
        purchasePrice,
        documentedInvestments: totalInvestments,
        estimatedValue,
        marketReference,
        lineItems: lineItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        overallConfidence,
        documentationScore,
        totalImages: totalImageCount || 0,
        imagesWithEvidence,
        marketRange: {
          low: estimatedValue * 0.90,
          high: estimatedValue * 1.10
        },
        marketPosition,
        warnings,
        flags
      };

    } catch (error) {
      console.error('Valuation engine error:', error);
      throw error;
    }
  }

  /**
   * Categorize receipt based on items purchased
   */
  private static categorizeReceipt(items: any[], vendorName?: string): string {
    if (!items || items.length === 0) {
      return vendorName || 'Parts';
    }

    const allText = items.map(i => `${i.description} ${i.category || ''}`).join(' ').toLowerCase();

    // Categorization by keywords
    if (/engine|motor|piston|valve|cam|intake|exhaust|turbo/.test(allText)) return 'Engine';
    if (/transmission|clutch|gear|differential/.test(allText)) return 'Drivetrain';
    if (/brake|rotor|caliper|pad|master cylinder/.test(allText)) return 'Brakes';
    if (/suspension|shock|spring|coilover|strut|bushing/.test(allText)) return 'Suspension';
    if (/tire|wheel|rim/.test(allText)) return 'Wheels/Tires';
    if (/body|panel|fender|hood|bumper|door/.test(allText)) return 'Body';
    if (/paint|primer|clear coat|sand/.test(allText)) return 'Paint';
    if (/interior|seat|carpet|dash|stereo|upholstery/.test(allText)) return 'Interior';
    if (/electrical|wiring|battery|alternator|starter/.test(allText)) return 'Electrical';
    if (/fuel|tank|pump|injector|carburetor/.test(allText)) return 'Fuel System';
    
    return 'Parts';
  }

  /**
   * Get visual evidence map - shows which images justify which value claims
   */
  static async getVisualEvidenceMap(vehicleId: string): Promise<{
    evidenceByCategory: Record<string, {
      totalValue: number;
      imageCount: number;
      coveragePercent: number;
      topImages: Array<{ url: string; tags: string[]; date: string }>;
    }>;
  }> {
    try {
      const valuation = await this.calculateValuation(vehicleId);
      
      const evidenceByCategory: Record<string, any> = {};

      for (const item of valuation.lineItems) {
        if (!evidenceByCategory[item.category]) {
          evidenceByCategory[item.category] = {
            totalValue: 0,
            imageCount: 0,
            images: []
          };
        }

        const cat = evidenceByCategory[item.category];
        cat.totalValue += item.amount;
        cat.imageCount += item.evidence.photoCount;
        
        // Add images with metadata
        item.evidence.imageUrls.forEach((url, idx) => {
          cat.images.push({
            url,
            tags: [item.description],
            date: item.date
          });
        });
      }

      // Calculate coverage percentage for each category
      Object.keys(evidenceByCategory).forEach(category => {
        const cat = evidenceByCategory[category];
        const expectedImages = cat.totalValue > 5000 ? 10 : cat.totalValue > 1000 ? 5 : 3;
        cat.coveragePercent = Math.min((cat.imageCount / expectedImages) * 100, 100);
        cat.topImages = cat.images.slice(0, 5);
        delete cat.images;
      });

      return { evidenceByCategory };

    } catch (error) {
      console.error('Visual evidence map error:', error);
      return { evidenceByCategory: {} };
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

  /**
   * Generate human-readable explanation of valuation
   */
  static explainValuation(result: ValuationResult): string {
    const lines: string[] = [];

    lines.push(`Purchase Price: ${this.formatCurrency(result.purchasePrice)}`);
    
    if (result.documentedInvestments > 0) {
      lines.push(`+ Documented Investments: ${this.formatCurrency(result.documentedInvestments)}`);
      lines.push(`  (${result.lineItems.length - 1} receipts/work sessions with ${result.imagesWithEvidence} photos)`);
    }
    
    lines.push(`= Estimated Value: ${this.formatCurrency(result.estimatedValue)}`);
    lines.push('');
    lines.push(`Market Reference: ${this.formatCurrency(result.marketReference)}`);
    lines.push(`Position: ${result.marketPosition === 'above' ? 'Above market' : result.marketPosition === 'below' ? 'Below market' : 'At market'}`);
    lines.push('');
    lines.push(`Documentation: ${result.documentationScore.toFixed(0)}%`);
    lines.push(`Confidence: ${result.overallConfidence}%`);
    
    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      result.warnings.forEach(w => lines.push(`  ${w}`));
    }

    return lines.join('\n');
  }
}


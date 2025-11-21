import { supabase } from '../lib/supabase';

export interface EventFinancialSummary {
  // Client
  clientDisplayName: string | null;
  isPrivate: boolean;
  
  // TCI breakdown
  laborCost: number;
  partsCost: number;
  suppliesCost: number;
  overheadCost: number;
  toolDepreciationCost: number;
  totalShopFees: number;
  tciTotal: number;
  
  // Revenue
  customerPrice: number;
  profitMargin: number;
  profitMarginPercent: number;
  
  // Social value
  partnershipRevenue: number;
  sponsorshipRevenue: number;
  viewerRevenue: number;
  totalSocialValue: number;
  
  // Combined
  combinedProfit: number;
  
  // Turnaround
  orderToDeliveryHours: number | null;
  deliveryToInstallHours: number | null;
  workDurationHours: number | null;
  totalTurnaroundHours: number | null;
  
  // Engagement
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  
  // Counts
  toolsUsedCount: number;
  partsUsedCount: number;
  knowledgeReferencedCount: number;
  
  // Rate info
  rateSource: string | null;
  appliedLaborRate: number | null;
}

export interface PartDetail {
  id: string;
  partName: string;
  partNumber: string | null;
  quantity: number;
  costPrice: number;
  retailPrice: number;
  markupPercent: number;
  supplierName: string | null;
  supplierRating: number | null;
  onTimePercentage: number | null;
}

export interface ToolDetail {
  id: string;
  toolName: string | null;
  durationMinutes: number;
  depreciationCost: number;
}

export interface KnowledgeDetail {
  id: string;
  title: string;
  category: string;
  timesReferenced: number;
  helpfulnessScore: number;
}

export class EventFinancialService {
  static async getEventFinancialSummary(eventId: string): Promise<EventFinancialSummary | null> {
    try {
      const { data, error } = await supabase
        .from('complete_event_summary')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching event financial summary:', error);
        return null;
      }
      
      if (!data) return null;
      
      return {
        clientDisplayName: data.client_display_name,
        isPrivate: data.is_private || false,
        
        laborCost: parseFloat(data.labor_cost || 0),
        partsCost: parseFloat(data.parts_cost || 0),
        suppliesCost: parseFloat(data.supplies_cost || 0),
        overheadCost: parseFloat(data.overhead_cost || 0),
        toolDepreciationCost: parseFloat(data.tool_depreciation_cost || 0),
        totalShopFees: parseFloat(data.total_shop_fees || 0),
        tciTotal: parseFloat(data.tci_total || 0),
        
        customerPrice: parseFloat(data.customer_price || 0),
        profitMargin: parseFloat(data.profit_margin || 0),
        profitMarginPercent: parseFloat(data.profit_margin_percent || 0),
        
        partnershipRevenue: parseFloat(data.partnership_revenue || 0),
        sponsorshipRevenue: parseFloat(data.sponsorship_revenue || 0),
        viewerRevenue: parseFloat(data.viewer_revenue || 0),
        totalSocialValue: parseFloat(data.total_social_value || 0),
        
        combinedProfit: parseFloat(data.combined_profit || 0),
        
        orderToDeliveryHours: data.order_to_delivery_hours ? parseFloat(data.order_to_delivery_hours) : null,
        deliveryToInstallHours: data.delivery_to_install_hours ? parseFloat(data.delivery_to_install_hours) : null,
        workDurationHours: data.work_duration_hours ? parseFloat(data.work_duration_hours) : null,
        totalTurnaroundHours: data.total_turnaround_hours ? parseFloat(data.total_turnaround_hours) : null,
        
        views: data.views || 0,
        likes: data.likes || 0,
        comments: data.comments || 0,
        engagementRate: parseFloat(data.engagement_rate || 0),
        
        toolsUsedCount: data.tools_used_count || 0,
        partsUsedCount: data.parts_used_count || 0,
        knowledgeReferencedCount: data.knowledge_referenced_count || 0,
        
        rateSource: data.rate_source,
        appliedLaborRate: data.applied_labor_rate ? parseFloat(data.applied_labor_rate) : null
      };
    } catch (err) {
      console.error('Error in getEventFinancialSummary:', err);
      return null;
    }
  }
  
  static async getEventParts(eventId: string): Promise<PartDetail[]> {
    try {
      const { data, error } = await supabase
        .from('event_parts_used')
        .select(`
          id,
          part_name,
          part_number,
          quantity,
          cost_price,
          retail_price,
          markup_percent,
          supplier:suppliers(name),
          supplier_rating:suppliers(rating:supplier_ratings(overall_score, on_time_percentage))
        `)
        .eq('event_id', eventId);
      
      if (error) throw error;
      
      return (data || []).map((p: any) => ({
        id: p.id,
        partName: p.part_name,
        partNumber: p.part_number,
        quantity: p.quantity || 1,
        costPrice: parseFloat(p.cost_price || 0),
        retailPrice: parseFloat(p.retail_price || 0),
        markupPercent: parseFloat(p.markup_percent || 0),
        supplierName: p.supplier?.name || null,
        supplierRating: p.supplier_rating?.rating?.overall_score ? parseFloat(p.supplier_rating.rating.overall_score) : null,
        onTimePercentage: p.supplier_rating?.rating?.on_time_percentage ? parseFloat(p.supplier_rating.rating.on_time_percentage) : null
      }));
    } catch (err) {
      console.error('Error fetching event parts:', err);
      return [];
    }
  }
  
  static async getEventTools(eventId: string): Promise<ToolDetail[]> {
    try {
      const { data, error } = await supabase
        .from('event_tools_used')
        .select('id, duration_minutes, depreciation_cost')
        .eq('event_id', eventId);
      
      if (error) throw error;
      
      return (data || []).map((t: any) => ({
        id: t.id,
        toolName: 'Tool', // Would need to join to user_tools if tool_id FK is set
        durationMinutes: t.duration_minutes || 0,
        depreciationCost: parseFloat(t.depreciation_cost || 0)
      }));
    } catch (err) {
      console.error('Error fetching event tools:', err);
      return [];
    }
  }
  
  static async getEventKnowledge(eventId: string): Promise<KnowledgeDetail[]> {
    try {
      const { data, error } = await supabase
        .from('event_knowledge_applied')
        .select(`
          id,
          knowledge:knowledge_base(
            title,
            category,
            times_referenced,
            helpfulness_score
          )
        `)
        .eq('event_id', eventId);
      
      if (error) throw error;
      
      return (data || []).map((k: any) => ({
        id: k.id,
        title: k.knowledge?.title || 'Unknown',
        category: k.knowledge?.category || 'general',
        timesReferenced: k.knowledge?.times_referenced || 0,
        helpfulnessScore: parseFloat(k.knowledge?.helpfulness_score || 0)
      }));
    } catch (err) {
      console.error('Error fetching event knowledge:', err);
      return [];
    }
  }
  
  static async calculateTCI(eventId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('calculate_event_tci', { p_event_id: eventId });
      
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error calculating TCI:', err);
      return null;
    }
  }
  
  static async calculateTurnaround(eventId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('calculate_turnaround_time', { p_event_id: eventId });
      
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error calculating turnaround:', err);
      return null;
    }
  }
  
  static async generateInvoice(eventId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .rpc('generate_invoice_from_event', { p_event_id: eventId });
      
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error generating invoice:', err);
      return null;
    }
  }
  
  static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  }
  
  static formatStars(score: number): string {
    const stars = Math.round(score / 20); // Convert 0-100 to 0-5 stars
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }
}


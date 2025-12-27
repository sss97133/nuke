/**
 * Organization Investor Metrics
 * 
 * Smart metric selection based on:
 * 1. Data availability (signal strength)
 * 2. Organization type
 * 3. Viewer context (owner vs investor vs public)
 * 
 * Only shows metrics when sufficient data exists (avoids misleading zeros)
 */

export interface OrgMetric {
  value: string | number;
  label: string;
  description?: string;
}

export interface OrgMetricData {
  // Revenue/Profitability
  total_revenue?: number;
  gross_profit?: number;
  gross_margin_pct?: number;
  net_margin_pct?: number;
  
  // Volume/Efficiency
  transaction_volume?: number;
  gmv?: number;
  inventory_turnover?: number;
  avg_days_to_sell?: number;
  project_completion_rate?: number;
  
  // Customer Retention
  repeat_customer_rate?: number;
  repeat_customer_count?: number;
  
  // Service-specific
  labor_rate?: number;
  avg_project_value?: number;
  total_projects?: number;
  
  // Inventory/Vehicle Data
  total_vehicles?: number;
  total_inventory?: number;
  total_sales?: number;
  total_events?: number;
  
  // Business classification
  business_type?: string;
  primary_focus?: string;
  
  // Data quality indicators
  vehicle_count?: number;
  receipt_count?: number;
  listing_count?: number;
  
  [key: string]: any;
}

export interface ViewerContext {
  type?: 'owner' | 'investor' | 'public' | 'customer';
  isOwner?: boolean;
}

/**
 * Check if we have sufficient data signal for a metric
 * This determines if a metric should be shown (privileged to view)
 * Returns true only if signal is strong enough
 */
function hasSignal(value: number | undefined | null, threshold: number = 3): boolean {
  return value !== undefined && value !== null && value >= threshold;
}

/**
 * Get investor-focused metrics with data quality checks
 * Returns best available metrics based on org type + data availability
 */
export function getOrgInvestorMetrics(
  org: OrgMetricData,
  context?: ViewerContext
): OrgMetric[] {
  const businessType = org.business_type?.toLowerCase() || '';
  const primaryFocus = org.primary_focus?.toLowerCase() || '';
  const viewerType = context?.type || 'public';
  
  const metrics: OrgMetric[] = [];
  
  // ============================================
  // AUCTION HOUSES
  // Priority: GMV → Revenue → Repeat Rate
  // ============================================
  if (businessType === 'auction_house' || primaryFocus === 'auctions') {
    const gmv = org.gmv || 0;
    const revenue = org.total_revenue || 0;
    const volume = org.transaction_volume || org.total_sales || 0;
    const repeatRate = org.repeat_customer_rate;
    
    // GMV (only if we have listings/sales data - signal threshold: 5 listings)
    if (hasSignal(org.listing_count, 5) && gmv > 0) {
      metrics.push({
        value: formatCurrency(gmv),
        label: 'GMV',
        description: 'Gross merchandise volume'
      });
    } else if (hasSignal(volume, 3)) {
      metrics.push({
        value: volume,
        label: 'Sales',
        description: 'Total sales/transactions'
      });
    }
    
    // Revenue (only if calculated from commissions - signal threshold: $1K revenue)
    if (hasSignal(revenue, 1000)) {
      metrics.push({
        value: formatCurrency(revenue),
        label: 'Revenue',
        description: 'Total commission revenue'
      });
    }
    
    // Repeat Rate (only if we have customer data - signal threshold: 3+ repeat customers)
    if (repeatRate !== undefined && repeatRate > 0 && hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: `${repeatRate.toFixed(0)}%`,
        label: 'Repeat Rate',
        description: 'Seller/buyer retention'
      });
    } else if (hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: org.repeat_customer_count,
        label: 'Repeat Customers',
        description: 'Customers with multiple transactions'
      });
    }
  }
  
  // ============================================
  // DEALERSHIPS
  // Priority: Revenue → Margin → Turnover
  // ============================================
  else if (businessType === 'dealership' || primaryFocus === 'inventory') {
    const revenue = org.total_revenue || 0;
    const margin = org.gross_margin_pct;
    const turnover = org.inventory_turnover;
    const avgDays = org.avg_days_to_sell;
    const sold = org.total_sales || 0;
    
    // Revenue (signal threshold: $1K revenue OR 3+ sales)
    if (hasSignal(revenue, 1000)) {
      metrics.push({
        value: formatCurrency(revenue),
        label: 'Revenue',
        description: 'Total sales revenue'
      });
    } else if (hasSignal(sold, 3)) {
      metrics.push({
        value: sold,
        label: 'Sold',
        description: 'Units sold'
      });
    }
    
    // Margin (signal threshold: 3+ sales with margin data)
    if (margin !== undefined && margin > 0 && hasSignal(org.total_sales, 3)) {
      metrics.push({
        value: `${margin.toFixed(1)}%`,
        label: 'Margin',
        description: 'Gross profit margin'
      });
    }
    // Or inventory turnover (signal threshold: 3+ inventory items)
    else if (turnover !== undefined && turnover > 0 && hasSignal(org.total_inventory, 3)) {
      metrics.push({
        value: `${turnover.toFixed(1)}x`,
        label: 'Turnover',
        description: 'Inventory turnover ratio'
      });
    }
    // Or avg days to sell (signal threshold: 3+ sales)
    else if (avgDays !== undefined && avgDays > 0 && hasSignal(org.total_sales, 3)) {
      metrics.push({
        value: `${Math.round(avgDays)}d`,
        label: 'Avg Days',
        description: 'Average days to sell'
      });
    }
    
    // Repeat Rate (signal threshold: 3+ repeat customers)
    const repeatRate = org.repeat_customer_rate;
    if (repeatRate !== undefined && repeatRate > 0 && hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: `${repeatRate.toFixed(0)}%`,
        label: 'Repeat Rate',
        description: 'Customer retention'
      });
    } else if (hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: org.repeat_customer_count,
        label: 'Repeat Cust',
        description: 'Repeat customers'
      });
    }
  }
  
  // ============================================
  // SERVICE SHOPS
  // Priority: Revenue → Margin → Labor Rate (if owner) / Repeat Rate
  // ============================================
  else if (['garage', 'body_shop', 'restoration_shop', 'performance_shop', 'detailing', 'mobile_service', 'specialty_shop'].includes(businessType) || primaryFocus === 'service') {
    const revenue = org.total_revenue || 0;
    const margin = org.gross_margin_pct;
    const projects = org.total_projects || org.total_events || 0;
    const laborRate = org.labor_rate;
    const repeatRate = org.repeat_customer_rate;
    
    // Revenue (signal threshold: 3+ receipts AND $500+ revenue)
    if (hasSignal(revenue, 500) && hasSignal(org.receipt_count, 3)) {
      metrics.push({
        value: formatCurrency(revenue),
        label: 'Revenue',
        description: 'Total invoiced revenue'
      });
    } else if (hasSignal(projects, 5)) {
      metrics.push({
        value: projects,
        label: 'Projects',
        description: 'Total projects completed'
      });
    }
    
    // Margin (signal threshold: 5+ receipts with margin data)
    if (margin !== undefined && margin > 0 && hasSignal(org.receipt_count, 5)) {
      metrics.push({
        value: `${margin.toFixed(1)}%`,
        label: 'Margin',
        description: 'Gross profit margin'
      });
    }
    // Or Labor Rate (signal threshold: labor rate exists AND owner/investor viewing)
    else if (laborRate !== undefined && laborRate > 0 && (viewerType === 'owner' || viewerType === 'investor')) {
      metrics.push({
        value: `$${laborRate}/hr`,
        label: 'Labor Rate',
        description: 'Hourly labor rate'
      });
    }
    
    // Repeat Rate (signal threshold: 5+ vehicles AND repeat data)
    if (repeatRate !== undefined && repeatRate > 0 && hasSignal(org.vehicle_count, 5)) {
      metrics.push({
        value: `${repeatRate.toFixed(0)}%`,
        label: 'Repeat Rate',
        description: 'Customer retention'
      });
    } else if (hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: org.repeat_customer_count,
        label: 'Repeat Cust',
        description: 'Repeat customers'
      });
    }
    // Or just vehicle count if we don't have repeat data (signal threshold: 3+ vehicles)
    else if (hasSignal(org.vehicle_count, 3) && metrics.length < 3) {
      metrics.push({
        value: org.vehicle_count,
        label: 'Vehicles',
        description: 'Vehicles serviced'
      });
    }
  }
  
  // ============================================
  // PARTS SUPPLIERS
  // Priority: Revenue → Margin → Volume
  // ============================================
  else if (businessType === 'parts_supplier') {
    const revenue = org.total_revenue || 0;
    const margin = org.gross_margin_pct;
    const volume = org.transaction_volume || org.total_inventory || 0;
    
    // Revenue (signal threshold: $1K revenue OR 10+ SKUs)
    if (hasSignal(revenue, 1000)) {
      metrics.push({
        value: formatCurrency(revenue),
        label: 'Revenue',
        description: 'Total sales revenue'
      });
    } else if (hasSignal(volume, 10)) {
      metrics.push({
        value: volume,
        label: 'SKUs',
        description: 'Product catalog size'
      });
    }
    
    // Margin (signal threshold: margin data exists)
    if (margin !== undefined && margin > 0) {
      metrics.push({
        value: `${margin.toFixed(1)}%`,
        label: 'Margin',
        description: 'Gross profit margin'
      });
    }
    
    // Repeat Rate (signal threshold: 3+ repeat customers)
    const repeatRate = org.repeat_customer_rate;
    if (repeatRate !== undefined && repeatRate > 0 && hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: `${repeatRate.toFixed(0)}%`,
        label: 'Repeat',
        description: 'Customer retention'
      });
    }
  }
  
  // ============================================
  // DEFAULT FALLBACK
  // Show whatever data we have (with signal checks)
  // ============================================
  else {
    const revenue = org.total_revenue || 0;
    const margin = org.gross_margin_pct;
    const volume = org.transaction_volume || org.total_vehicles || 0;
    const repeatRate = org.repeat_customer_rate;
    
    // Revenue (signal threshold: $1K revenue)
    if (hasSignal(revenue, 1000)) {
      metrics.push({
        value: formatCurrency(revenue),
        label: 'Revenue',
        description: 'Total revenue'
      });
    } else if (hasSignal(volume, 3)) {
      metrics.push({
        value: volume,
        label: 'Volume',
        description: 'Transaction/vehicle volume'
      });
    }
    
    // Margin (signal threshold: margin data exists)
    if (margin !== undefined && margin > 0) {
      metrics.push({
        value: `${margin.toFixed(1)}%`,
        label: 'Margin',
        description: 'Gross profit margin'
      });
    }
    
    // Repeat Rate (signal threshold: 3+ repeat customers)
    if (repeatRate !== undefined && repeatRate > 0 && hasSignal(org.repeat_customer_count, 3)) {
      metrics.push({
        value: `${repeatRate.toFixed(0)}%`,
        label: 'Repeat',
        description: 'Customer retention'
      });
    }
  }
  
  // Ensure we always return exactly 3 metrics (pad with available data if needed)
  while (metrics.length < 3) {
    // Fill with available data (signal thresholds are lower for fallback)
    if (metrics.length === 0 && hasSignal(org.total_vehicles, 1)) {
      metrics.push({
        value: org.total_vehicles || 0,
        label: 'Vehicles',
        description: 'Total vehicles'
      });
    } else if (metrics.length === 1 && hasSignal(org.total_events, 1)) {
      metrics.push({
        value: org.total_events || 0,
        label: 'Events',
        description: 'Total events'
      });
    } else {
      // Last resort: show placeholder
      metrics.push({
        value: '—',
        label: '—',
        description: 'Insufficient data'
      });
    }
  }
  
  return metrics.slice(0, 3); // Always return exactly 3
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${Math.round(value / 1000)}K`;
  }
  return `$${value.toLocaleString()}`;
}

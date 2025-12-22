/**
 * Shared types for tool parsing services
 * Extracted to break circular dependencies
 */

export interface ParsedTool {
  // Core tool data
  name: string;
  part_number?: string;
  serial_number?: string;
  brand_name?: string;
  
  // Financial data
  purchase_price?: number;
  purchase_date?: string;
  transaction_number?: string;
  
  // Additional metadata
  description?: string;
  category?: string;
  condition?: string;
  quantity?: number;
  
  // Flexible additional fields (can grow over time)
  metadata?: Record<string, any>;
}

export interface ToolImportResult {
  success: boolean;
  toolsImported: number;
  tools: ParsedTool[];
  errors: string[];
}


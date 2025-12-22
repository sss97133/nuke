/**
 * Shared types for receipt parsing services
 * Extracted to break circular dependencies
 */

export interface UniversalReceiptResult {
  success: boolean;
  receipt_metadata: {
    vendor_name?: string;
    vendor_address?: string;
    transaction_date?: string;
    transaction_number?: string;
    total_amount?: number;
    subtotal?: number;
    tax_amount?: number;
    payment_method?: string;
  };
  line_items: Array<{
    part_number?: string;
    description: string;
    quantity: number;
    unit_price?: number;
    total_price?: number;
    discount?: number;
    brand?: string;
    serial_number?: string;
    line_type: 'sale' | 'warranty' | 'return' | 'payment' | 'unknown';
    additional_data?: Record<string, any>;
  }>;
  payment_records: Array<{
    payment_date?: string;
    payment_type?: string;
    amount: number;
    transaction_number?: string;
  }>;
  raw_extraction: any;
  confidence_score: number;
  errors: string[];
}


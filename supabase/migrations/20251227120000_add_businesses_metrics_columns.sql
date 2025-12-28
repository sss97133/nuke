-- ============================================================
-- ADD MISSING METRICS COLUMNS TO BUSINESSES TABLE
-- Adds columns needed for organization metrics and investor data
-- ============================================================

DO $$
BEGIN
  -- Labor rate (hourly rate for the organization)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'labor_rate'
  ) THEN
    ALTER TABLE businesses ADD COLUMN labor_rate NUMERIC(10,2);
  END IF;

  -- Primary focus (service, inventory, mixed)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'primary_focus'
  ) THEN
    ALTER TABLE businesses ADD COLUMN primary_focus TEXT CHECK (primary_focus IN ('service', 'inventory', 'mixed'));
  END IF;

  -- Total sold (count of vehicles/sales)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_sold'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_sold INTEGER DEFAULT 0;
  END IF;

  -- Total revenue (in dollars)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_revenue'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_revenue NUMERIC(15,2) DEFAULT 0;
  END IF;

  -- Gross margin percentage
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'gross_margin_pct'
  ) THEN
    ALTER TABLE businesses ADD COLUMN gross_margin_pct NUMERIC(5,2);
  END IF;

  -- Inventory turnover (annual turnover ratio)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'inventory_turnover'
  ) THEN
    ALTER TABLE businesses ADD COLUMN inventory_turnover NUMERIC(10,2);
  END IF;

  -- Average days to sell
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'avg_days_to_sell'
  ) THEN
    ALTER TABLE businesses ADD COLUMN avg_days_to_sell NUMERIC(10,2);
  END IF;

  -- Project completion rate (percentage)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'project_completion_rate'
  ) THEN
    ALTER TABLE businesses ADD COLUMN project_completion_rate NUMERIC(5,2);
  END IF;

  -- Repeat customer count
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'repeat_customer_count'
  ) THEN
    ALTER TABLE businesses ADD COLUMN repeat_customer_count INTEGER DEFAULT 0;
  END IF;

  -- Gross Merchandise Value (GMV)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'gmv'
  ) THEN
    ALTER TABLE businesses ADD COLUMN gmv NUMERIC(15,2) DEFAULT 0;
  END IF;

  -- Receipt count
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'receipt_count'
  ) THEN
    ALTER TABLE businesses ADD COLUMN receipt_count INTEGER DEFAULT 0;
  END IF;

  -- Listing count (may be redundant with total_listings, but keeping for compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'listing_count'
  ) THEN
    ALTER TABLE businesses ADD COLUMN listing_count INTEGER DEFAULT 0;
  END IF;

  -- Total projects
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_projects'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_projects INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN businesses.labor_rate IS 'Standard hourly labor rate for the organization ($/hour)';
COMMENT ON COLUMN businesses.primary_focus IS 'Primary business focus: service, inventory, or mixed';
COMMENT ON COLUMN businesses.total_sold IS 'Total number of vehicles/items sold';
COMMENT ON COLUMN businesses.total_revenue IS 'Total revenue in dollars';
COMMENT ON COLUMN businesses.gross_margin_pct IS 'Gross profit margin percentage';
COMMENT ON COLUMN businesses.inventory_turnover IS 'Annual inventory turnover ratio';
COMMENT ON COLUMN businesses.avg_days_to_sell IS 'Average number of days to sell inventory';
COMMENT ON COLUMN businesses.project_completion_rate IS 'Percentage of projects completed on time';
COMMENT ON COLUMN businesses.repeat_customer_count IS 'Number of repeat customers';
COMMENT ON COLUMN businesses.gmv IS 'Gross Merchandise Value - total value of all transactions';
COMMENT ON COLUMN businesses.receipt_count IS 'Total number of receipts/transactions processed';
COMMENT ON COLUMN businesses.listing_count IS 'Total number of listings (may be redundant with total_listings)';
COMMENT ON COLUMN businesses.total_projects IS 'Total number of projects completed';


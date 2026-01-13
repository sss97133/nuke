-- Allow 'live_auction' as a vehicle_listings.sale_type option (short duration auctions).
-- Existing constraint allowed: auction, fixed_price, best_offer, hybrid
-- This migration extends it to include: live_auction

DO $$
BEGIN
  IF to_regclass('public.vehicle_listings') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.vehicle_listings DROP CONSTRAINT IF EXISTS vehicle_listings_sale_type_check;
      ALTER TABLE public.vehicle_listings
        ADD CONSTRAINT vehicle_listings_sale_type_check
          CHECK (sale_type = ANY (ARRAY[
            'auction'::text,
            'live_auction'::text,
            'fixed_price'::text,
            'best_offer'::text,
            'hybrid'::text
          ]));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;


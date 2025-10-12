-- Revert the most recent receipt for a user: subtract its items from user_tools and delete the receipt
-- Set the user id here
WITH params AS (
  SELECT '0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid AS uid
),
-- 1) Identify last receipt for the user
last_receipt AS (
  SELECT id
  FROM receipts
  WHERE user_id = (SELECT uid FROM params)
  ORDER BY created_at DESC
  LIMIT 1
),
-- 2) Aggregate its sale line items
agg AS (
  SELECT 
    COALESCE(part_number,'') AS part_number_key,
    description,
    SUM(COALESCE(quantity,1)) AS q,
    SUM(COALESCE(total_price,0)) AS amt
  FROM line_items
  WHERE user_id = (SELECT uid FROM params)
    AND receipt_id IN (SELECT id FROM last_receipt)
    AND (line_type IS NULL OR line_type = 'sale')
  GROUP BY 1,2
),
-- 3) Subtract from user_tools totals and remove the receipt id from arrays
updated AS (
  UPDATE user_tools ut
  SET 
    total_quantity = GREATEST(COALESCE(ut.total_quantity,0) - agg.q, 0),
    total_spent    = GREATEST(COALESCE(ut.total_spent,0) - agg.amt, 0),
    receipt_ids    = CASE 
                      WHEN ut.receipt_ids IS NULL THEN NULL
                      ELSE array_remove(ut.receipt_ids, (SELECT id FROM last_receipt))
                    END,
    updated_at     = NOW()
  FROM agg
  WHERE ut.user_id = (SELECT uid FROM params)
    AND (
      (ut.part_number IS NOT NULL AND ut.part_number = NULLIF(agg.part_number_key,''))
      OR (ut.part_number IS NULL AND ut.description = agg.description)
    )
  RETURNING ut.id
),
-- 4) Delete zeroed-out tools
removed_tools AS (
  DELETE FROM user_tools
  WHERE user_id = (SELECT uid FROM params)
    AND COALESCE(total_quantity,0) = 0
    AND COALESCE(total_spent,0) = 0
  RETURNING id
),
-- 5) Delete the line items for that receipt
removed_line_items AS (
  DELETE FROM line_items WHERE user_id = (SELECT uid FROM params) AND receipt_id IN (SELECT id FROM last_receipt)
  RETURNING id
)
-- 6) Delete the receipt record
DELETE FROM receipts WHERE user_id = (SELECT uid FROM params) AND id IN (SELECT id FROM last_receipt);

-- Check receipt processing status and tool counts
-- Shows what receipts exist and how many tools were extracted

SELECT 
  r.id,
  r.original_filename,
  r.supplier_name,
  r.receipt_date,
  r.processing_status,
  r.tools_extracted,
  r.tools_saved,
  r.created_at,
  r.processed_at,
  r.storage_path,
  COUNT(t.id) as actual_tools_in_db
FROM tool_receipt_documents r
LEFT JOIN user_tools t ON t.receipt_document_id = r.id
GROUP BY r.id, r.original_filename, r.supplier_name, r.receipt_date, 
         r.processing_status, r.tools_extracted, r.tools_saved, 
         r.created_at, r.processed_at, r.storage_path
ORDER BY r.created_at DESC
LIMIT 10;

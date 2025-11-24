#!/bin/bash

# Simple scan monitor - shows progress from database

echo "================================================================================";
echo "🔍 AI SCAN MONITOR";
echo "================================================================================";
echo "";

while true; do
  clear
  echo "================================================================================";
  echo "🔍 AI IMAGE SCANNING PROGRESS";
  echo "================================================================================";
  echo "";
  echo "$(date '+%Y-%m-%d %H:%M:%S')";
  echo "";
  
  # Get current scan progress
  psql "postgresql://postgres.qkgaybvrernstplzjaam:5bDBY\!iAnZtvpwx@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
    -c "SELECT 
          scan_type,
          status,
          processed_images || '/' || total_images as progress,
          failed_images as failed,
          ROUND((processed_images::numeric / NULLIF(total_images, 0)) * 100, 1) || '%' as complete,
          started_at,
          updated_at
        FROM ai_scan_progress 
        ORDER BY created_at DESC 
        LIMIT 1;" \
    2>/dev/null || echo "No active scan";
  
  echo "";
  echo "Overall Stats:";
  psql "postgresql://postgres.qkgaybvrernstplzjaam:5bDBY\!iAnZtvpwx@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
    -c "SELECT * FROM get_image_scan_stats();" \
    2>/dev/null | head -10
  
  echo "";
  echo "Press Ctrl+C to stop monitoring";
  echo "View live at: https://n-zero.dev/admin";
  
  sleep 5
done


# Data Directory

This directory contains JSON data files from AI scanning operations.

## Files

- **blazer_ai_scan_results_*_images.json** - AI scan results from Blazer image processing
- **business-classification-updates.csv** - Optional output from `scripts/classify-pending-businesses.ts --csv` (id, business_type)
- **business-classification-updates.sql** - Optional output from `scripts/classify-pending-businesses.ts --sql` (UPDATE statements for businesses.business_type)

## Purpose

This directory serves as the output location for:
- AI vision analysis results
- Batch image scanning operations
- Training data exports
- Analysis summaries

Data files here are typically consumed by the frontend application or used for further processing.

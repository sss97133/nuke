# AI Scripts Directory

This directory contains Python scripts for AI-powered image analysis and vehicle data processing.

## Scripts

### Image Scanning & Tagging
- **blazer_image_database_scanner.py** - Database integration for scanning Blazer images with AI
- **image_scanner_system.py** - Core image scanning system with OpenAI Vision API
- **blazer_image_tagger_demo.py** - Demo script for tagging Blazer images
- **scan_multiple_blazer_images.py** - Batch scanning utility for multiple Blazer images

### Document Processing
- **document_ai_processor.py** - AI-powered document parsing and data extraction

### Testing
- **test_ai_vision_simple.py** - Simple AI vision API tests
- **test_image_scanner.py** - Image scanner system tests

## Setup

These scripts require:
- Python 3.8+
- OpenAI API key set in environment: `OPENAI_API_KEY`
- Supabase database credentials (for database scanner)

## Output

Scan results are saved to `../data/` directory as JSON files.

## Usage

Run scripts from the project root:
```bash
cd /Users/skylar/nuke
python scripts/ai/blazer_image_database_scanner.py
```

Or from this directory:
```bash
cd scripts/ai
python blazer_image_database_scanner.py
```

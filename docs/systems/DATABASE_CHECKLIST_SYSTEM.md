# Database-Driven Checklist System for LLM Site Mapping

## Overview

The LLM now uses a **database-driven checklist** to systematically find all required fields on any automotive website. Instead of just analyzing pages, the LLM goes through a comprehensive checklist and finds each field.

---

## How It Works

### 1. **Database Checklist Table**

The `extraction_field_checklist` table contains:
- **Field name** - Standard field identifier
- **Database mapping** - Which table/column to store it in
- **LLM question** - Specific question for the LLM to answer
- **LLM instructions** - How to find this field
- **Extraction hints** - Where to look (check_title, check_specs_section, etc.)
- **Common patterns** - Regex patterns or text patterns
- **Example values** - What the field looks like
- **Priority** - How important this field is (0-100)

### 2. **Systematic Field Discovery**

The LLM:
1. Loads the complete checklist from database
2. For each field in the checklist:
   - Reads the `llm_question` (e.g., "What is the vehicle year?")
   - Reads the `llm_instructions` (e.g., "Look for 4-digit year in title or specs")
   - Follows the `extraction_hints` (e.g., check_title, check_specs_section)
   - Finds the field on the page
   - Provides CSS selectors, patterns, and extraction method
3. Returns which fields were found and which were not

### 3. **Automatic Database Mapping**

Fields are automatically mapped to the correct database table/column based on the checklist, ensuring consistency.

---

## Checklist Categories

### Vehicle Core Fields (Required)
- `year`, `make`, `model` - Required for all vehicles

### Vehicle Specifications
- `vin`, `mileage`, `color`, `interior_color`
- `transmission`, `engine_size`, `drivetrain`
- `body_style`, `trim`, `series`

### Vehicle Pricing
- `asking_price`, `sale_price`, `reserve_price`

### Vehicle Description & History
- `description`, `notes`

### Vehicle Location
- `location` (city, state)

### Organization/Seller Fields
- `seller_name`, `seller_website`, `seller_phone`, `seller_email`, `seller_location`

### Auction Fields (if applicable)
- `lot_number`, `auction_status`, `auction_end_date`, `bid_count`

### Image Fields
- `primary_image`, `gallery_images`

### Discovery & Metadata
- `discovery_url`, `discovery_source`

---

## Example Checklist Entry

```json
{
  "field_name": "vin",
  "field_category": "vehicle_specs",
  "db_table": "vehicles",
  "db_column": "vin",
  "data_type": "text",
  "is_required": false,
  "priority": 95,
  "llm_question": "What is the VIN (Vehicle Identification Number)?",
  "llm_instructions": "Look for 17-character alphanumeric code. Check specs section, description, or structured data. Format: [A-HJ-NPR-Z0-9]{17}",
  "extraction_hints": ["check_specs_section", "check_description", "check_structured_data", "check_hidden_fields"],
  "common_patterns": ["\\b[A-HJ-NPR-Z0-9]{17}\\b", "VIN[:\\s]*([A-HJ-NPR-Z0-9]{17})"],
  "example_values": ["1G1YY26G995123456", "WBA3A5C58EK123456"]
}
```

---

## LLM Prompt Structure

The LLM receives:
1. **Page content** (HTML + Markdown)
2. **Complete checklist** (all fields to find)
3. **Instructions** to go through checklist systematically
4. **Requirements** to provide selectors, patterns, and extraction methods

The LLM returns:
- `fields_found` - Array of found fields with selectors
- `fields_not_found` - Array of field names not found
- `coverage_percentage` - How many fields were found
- `recommendations` - Extraction recommendations

---

## Benefits

1. **Systematic**: LLM goes through checklist, doesn't miss fields
2. **Database-Driven**: Checklist is in database, can be updated without code changes
3. **Comprehensive**: Covers all fields we need, not just obvious ones
4. **Consistent**: Same checklist used for all sites
5. **Accountable**: Tracks which fields were found vs. not found
6. **Extensible**: Easy to add new fields to checklist

---

## Adding New Fields

To add a new field to the checklist:

```sql
INSERT INTO extraction_field_checklist (
  field_name, field_category, db_table, db_column, data_type,
  is_required, priority, llm_question, llm_instructions,
  extraction_hints, common_patterns, example_values
) VALUES (
  'new_field_name',
  'vehicle_specs',
  'vehicles',
  'new_field_column',
  'text',
  false,
  75,
  'What is the new field value?',
  'Look for this field in...',
  ARRAY['check_specs_section', 'check_description'],
  ARRAY['pattern1', 'pattern2'],
  ARRAY['example1', 'example2']
);
```

The LLM will automatically start looking for this field on all future site mappings.

---

## Usage

The checklist is automatically used by `thorough-site-mapper`:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/thorough-site-mapper \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.dupontregistry.com"
  }'
```

The function will:
1. Load checklist from database
2. Analyze site with LLM using checklist
3. Map all found fields to database
4. Return complete site map with coverage metrics

---

## Viewing the Checklist

Query the checklist:

```sql
-- View all fields
SELECT * FROM extraction_field_checklist ORDER BY priority DESC;

-- View by category
SELECT * FROM extraction_checklist_by_category;

-- View required fields only
SELECT * FROM extraction_field_checklist WHERE is_required = true;
```


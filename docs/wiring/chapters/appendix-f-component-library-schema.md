# Appendix F: Component Engineering Library Schema

The component library is the foundation under every output — wiring diagrams, BOMs, installation guides, connector schedules, clearance checks. Every component is a deep node, not a flat row.

## Architecture

```
component_library (universal — shared across all vehicles)
  ├── component_documents[] (every PDF, manual, datasheet)
  │     └── component_drawings[] (extracted images, traced SVGs)
  ├── component_connectors[] (pin-level detail for wiring)
  └── component_mounting{} (bolt patterns, clearance envelopes)

build_manifest_components (vehicle-specific instances)
  ├── FK → component_library (what part)
  ├── FK → vehicles (which vehicle)
  ├── position (where it mounts)
  └── status (planned/purchased/installed)
```

## Tables

### component_library
The master catalog. One row per unique part. A Motec M130 is one row whether it's on 1 vehicle or 100.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| manufacturer | text NOT NULL | "Motec", "ACDelco", "Bosch", "Holley" |
| part_number | text NOT NULL | Primary part number ("M130", "D510C", "12611424") |
| name | text NOT NULL | Human name ("M130 ECU", "LS3 Ignition Coil") |
| category | text | ecu, pdm, sensor, actuator, lighting, switch, relay, connector, harness, audio, body, brake, cooling, fuel, ignition, display |
| subcategory | text | engine_management, knock_sensor, ignition_coil, fuel_injector, etc. |
| description | text | Full description |
| supersedes | text[] | Part numbers this replaces ("12570616" → "12611424") |
| superseded_by | text | Part number that replaces this |
| dimensions_mm | jsonb | {"length": 107.5, "width": 127.5, "height": 38.7, "weight_g": 300} |
| mounting_spec | jsonb | {"bolt_count": 3, "bolt_size": "M5", "bolt_pattern_mm": [[x,y]...], "torque_nm": 5, "clearance_envelope_mm": {...}} |
| electrical_spec | jsonb | {"voltage_min": 6, "voltage_max": 22, "current_draw_a": 1.5, "power_w": 18, "fuse_rating_a": null} |
| environmental_spec | jsonb | {"temp_min_c": -10, "temp_max_c": 85, "ip_rating": "IP67", "vibration_g": 25} |
| connector_summary | jsonb | [{"label": "A", "type": "Superseal", "pins": 34}, {"label": "B", "type": "Superseal", "pins": 26}] |
| manufacturer_url | text | Product page URL |
| datasheet_url | text | Direct link to primary datasheet PDF |
| cad_available | boolean | Whether 3D CAD models exist (GrabCAD, manufacturer) |
| cad_urls | text[] | URLs to CAD models |
| price_usd | numeric | Known/estimated price |
| price_source | text | "Desert Performance invoice", "Summit Racing", "manufacturer MSRP" |
| verified | boolean | Data verified against manufacturer documentation |
| verified_at | timestamptz | |
| notes | text | Engineering notes, compatibility warnings |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique constraint:** (manufacturer, part_number)

### component_documents
Every piece of engineering documentation for a component. PDFs, images, manuals.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| component_id | uuid FK → component_library | |
| document_type | text NOT NULL | See enum below |
| title | text NOT NULL | "M130 Datasheet", "PDM30 Wiring Manual" |
| file_path | text | Local path in reference_documents/ |
| storage_url | text | Supabase storage URL (if uploaded) |
| source_url | text NOT NULL | Where we downloaded it from |
| file_type | text | pdf, png, svg, step, iges, stl, jpg, dxf |
| file_size_bytes | bigint | |
| page_count | int | For PDFs |
| relevant_pages | text | "3" or "67-69" — pages with key drawings |
| content_summary | text | What this document contains |
| ocr_text | text | Full OCR'd text (for search) |
| verified | boolean | |
| created_at | timestamptz | |

**document_type enum:**
- `datasheet` — manufacturer product summary with key specs
- `dimensional_drawing` — 2D engineering drawing with measurements
- `installation_guide` — how to install, wiring instructions
- `user_manual` — full product manual
- `wiring_diagram` — component-specific wiring schematic
- `pinout` — pin assignment table/diagram
- `connector_face` — connector face view with pin positions
- `mounting_template` — printable drilling template
- `3d_model` — CAD file (STEP, IGES, STL)
- `service_bulletin` — TSBs, known issues, corrections
- `certification` — FMVSS, SAE, CE, IP rating certs
- `product_photo` — manufacturer product photography
- `application_note` — technical application guidance
- `cross_reference` — compatibility/interchange data
- `calibration_data` — sensor calibration tables, curves

### component_drawings
Specific engineering drawings extracted FROM documents. These are the images that get used as wiring diagram layers.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| component_id | uuid FK → component_library | |
| document_id | uuid FK → component_documents | Source document |
| drawing_type | text NOT NULL | See enum below |
| view_angle | text | "front", "side_left", "side_right", "top", "bottom", "rear", "isometric_3qtr", "isometric_front" |
| image_path | text | Extracted raster image path |
| svg_path | text | Traced vector SVG path (for overlay use) |
| image_url | text | Supabase storage URL |
| svg_url | text | Supabase storage URL |
| source_page | int | Page number in source document |
| scale | text | "1:1", "2:1", "NTS" (not to scale) |
| dimensions_extracted | jsonb | Measurements read from the drawing |
| resolution_dpi | int | Image resolution |
| notes | text | |
| created_at | timestamptz | |

**drawing_type enum:**
- `orthographic_front` — front elevation with dimensions
- `orthographic_side` — side elevation with dimensions
- `orthographic_top` — plan view with dimensions
- `mounting_pattern` — bolt hole positions only
- `connector_face` — pin cavity layout
- `exploded_view` — assembly explosion
- `cross_section` — cutaway view
- `wiring_schematic` — circuit diagram for this component
- `installation_context` — component shown installed in vehicle
- `clearance_envelope` — space requirements around component

### component_connectors
Pin-level detail for every connector on a component. This is what the wiring system uses to generate harnesses.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| component_id | uuid FK → component_library | |
| connector_label | text NOT NULL | "A", "B", "J1", "main" |
| connector_type | text | "Tyco Superseal 34", "Metri-Pack 3-pin", "EV6/USCAR", "DTM 4-pin" |
| component_side_pn | text | Part number of connector ON the component |
| harness_side_pn | text | Part number of MATING connector for the harness |
| pin_count | int | |
| keying | text | "Position 1", "Keyed A" |
| sealed | boolean | Weather-sealed? |
| pins | jsonb NOT NULL | Array of pin objects (see below) |
| face_view_drawing_id | uuid FK → component_drawings | |
| notes | text | |
| created_at | timestamptz | |

**Pin object structure (within pins jsonb array):**
```json
{
  "number": "A03",
  "designation": "IGN_LS1",
  "full_name": "Low Side Ignition 1",
  "function": "ignition_output",
  "direction": "output",
  "signal_type": "low_side_drive",
  "wire_gauge_awg": 20,
  "wire_gauge_mm2": 0.5,
  "max_current_a": 10,
  "recommended_color": "WHT",
  "shielded": false,
  "notes": ""
}
```

### build_manifest_components
Links a specific vehicle build to the universal component library. This replaces/extends `vehicle_build_manifest`.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| vehicle_id | uuid FK → vehicles | |
| component_id | uuid FK → component_library | |
| quantity | int DEFAULT 1 | 8 for injectors, 8 for coils, etc. |
| instance_label | text | "Cylinder 1", "Driver Side", "Bank 1" |
| zone | text | engine, firewall, cab, underbody, front, rear |
| mounting_location | text | "Driver valve cover, cylinder 1 position" |
| position_x_pct | numeric | Percentage from front (0=front bumper, 100=rear bumper) |
| position_y_pct | numeric | Percentage from driver side (0=driver, 100=passenger) |
| position_z_pct | numeric | Percentage from bottom (0=frame rail, 100=roof) |
| status | text | planned, ordered, purchased, installed, wired, tested |
| serial_number | text | |
| purchase_date | date | |
| purchase_price | numeric | Actual price paid |
| purchase_source | text | |
| notes | text | |
| created_at | timestamptz | |

## Relationships

```
component_library ──1:N──► component_documents ──1:N──► component_drawings
                   ──1:N──► component_connectors
                   ──1:N──► build_manifest_components ──N:1──► vehicles
```

## Indexes

- component_library: (manufacturer, part_number) UNIQUE
- component_library: GIN on supersedes for array search
- component_documents: (component_id, document_type)
- component_drawings: (component_id, drawing_type)
- component_connectors: (component_id, connector_label) UNIQUE
- build_manifest_components: (vehicle_id, component_id)

## How Wiring Diagrams Use This

The diagram renderer queries:
1. `build_manifest_components` WHERE vehicle_id = X → get all components and their positions
2. For each component → `component_drawings` WHERE drawing_type = 'orthographic_front' (or whatever view matches the diagram perspective)
3. For each component → `component_connectors` → pins → wire routing data
4. The SVG for each component is loaded from `component_drawings.svg_url`
5. Components are positioned on the base layer at their `position_x/y/z_pct` coordinates
6. Wires are routed between connector pins following the harness trunk paths

The same data also generates:
- **BOM**: component_library.price + build_manifest_components.quantity
- **Cut list**: component_connectors.pins → wire gauge, color, length
- **Connector schedule**: component_connectors → pin assignments
- **Installation guide**: component_documents WHERE document_type = 'installation_guide'
- **Troubleshooting**: component_documents WHERE document_type = 'service_bulletin'

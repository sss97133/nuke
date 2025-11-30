# AIDataIngestionSearch Component - Visual Flow Diagram

## Component UI Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Global Search Bar                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [VIN, URL, text...]  [IMG]  [GO]                         │ │
│  │                                                           │ │
│  │ Input Field    │  Image Button  │  Process Button        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Features:                                                     │
│  • Drag & drop images                                          │
│  • Paste images (Ctrl+V / Cmd+V)                              │
│  • Enter key to process                                        │
│  • Escape to cancel                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────┐
│   USER      │
│   INPUT     │
└──────┬──────┘
       │
       ├─────────────────────────────────────────────┐
       │                                             │
       ▼                                             ▼
┌──────────────┐                            ┌──────────────┐
│   TEXT       │                            │   IMAGE      │
│   INPUT      │                            │   FILE       │
└──────┬───────┘                            └──────┬───────┘
       │                                            │
       │                                            │
       └──────────────┬─────────────────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │  processInput()   │
            └─────────┬────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │  aiDataIngestion.extractData() │
        │  • Text analysis              │
        │  • Image OCR/Vision           │
        │  • URL scraping               │
        └─────────────┬───────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │   ExtractionResult           │
        │   • vehicleData               │
        │   • receiptData               │
        │   • inputType                 │
        │   • rawData                   │
        └─────────────┬───────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   ┌────────┐   ┌────────┐   ┌────────┐
   │ SEARCH │   │   URL  │   │  DATA  │
   │ QUERY  │   │LISTING │   │EXTRACT │
   └───┬────┘   └───┬────┘   └───┬────┘
       │            │            │
       │            │            │
       ▼            │            │
   Navigate to      │            │
   /vehicles?       │            │
   search=...       │            │
                    │            │
                    ▼            │
         ┌──────────────────────┐
         │  Vehicle Matching    │
         │  • Check existing     │
         │  • Compare specs      │
         │  • Image matching      │
         └──────────┬────────────┘
                    │
         ┌──────────┼──────────┐
         │          │          │
         ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │ STRONG │ │ MODERATE│ │   LOW  │
    │ MATCH  │ │ MATCH   │ │ MATCH  │
    │ >80%   │ │ 50-80%  │ │ <50%   │
    └───┬────┘ └───┬──────┘ └───┬────┘
        │         │            │
        │         │            │
        ▼         ▼            ▼
    Auto-merge  Show      Create new
    & navigate  Preview   vehicle
```

## Decision Tree / Process Flow

```
                    START
                      │
                      ▼
            ┌─────────────────────┐
            │  User enters input  │
            │  or attaches image  │
            └──────────┬──────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │   Click GO or       │
            │   Press Enter       │
            └──────────┬──────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  Extract data with   │
            │  AI (OpenAI Vision)  │
            └──────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌────────┐    ┌────────┐    ┌────────┐
   │ SEARCH │    │   URL  │    │  TEXT  │
   │ QUERY  │    │LISTING │    │  DATA  │
   └───┬────┘    └───┬────┘    └───┬────┘
       │             │             │
       │             │             │
       ▼             │             │
   Navigate to       │             │
   search page       │             │
                     │             │
                     ▼             │
            ┌─────────────────────┐
            │  Check for existing  │
            │  vehicle match       │
            └──────────┬───────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌────────┐    ┌────────┐    ┌────────┐
   │ MATCH  │    │ MATCH   │    │  NO    │
   │ FOUND  │    │ FOUND   │    │ MATCH  │
   │ >80%   │    │ 50-80%  │    │        │
   └───┬────┘    └───┬──────┘    └───┬────┘
       │             │              │
       │             │              │
       ▼             ▼              ▼
   Auto-merge    Show preview   Generate
   & navigate    with match     operation
                  evidence      plan
                                  │
                                  ▼
                            Show preview
                                  │
                                  ▼
                            User confirms
                                  │
                                  ▼
                            Create/update
                            vehicle
                                  │
                                  ▼
                            Navigate to
                            vehicle profile
```

## User Interaction States

```
┌─────────────────────────────────────────────────────────────┐
│ STATE 1: Empty / Ready                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [VIN, URL, text...]  [IMG]  [GO]                          │
│                                                             │
│  • Input field: empty                                       │
│  • IMG button: enabled                                      │
│  • GO button: disabled (no input)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STATE 2: Image Attached                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Add context...]  [IMG]  [GO]                             │
│                                                             │
│  • Input field: placeholder changed to "Add context..."     │
│  • IMG button: shows "IMG" (image attached)               │
│  • GO button: enabled                                      │
│  • Image preview appears below                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STATE 3: Processing                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [VIN, URL, text...]  [IMG]  [...]                         │
│                                                             │
│  • Input field: disabled                                    │
│  • IMG button: disabled                                    │
│  • GO button: shows "..." (processing)                     │
│  • Loading state                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STATE 4: Preview Shown                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [VIN, URL, text...]  [IMG]  [OK]                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Extracted Data Preview                                │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ Vehicle:                                             │ │
│  │   1974                                                │ │
│  │   Chevrolet                                           │ │
│  │   Blazer                                              │ │
│  │   VIN: ABC123...                                      │ │
│  │                                                       │ │
│  │ ✓ Strong Match Found                                 │ │
│  │   Match Score: 85%                                    │ │
│  │                                                       │ │
│  │ [Confirm & Save]  [Cancel]                           │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  • GO button changed to "OK"                               │
│  • Preview panel shows extracted data                      │
│  • User can confirm or cancel                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AIDataIngestionSearch                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ State Management                                      │  │
│  │ • input (string)                                      │  │
│  │ • isProcessing (boolean)                              │  │
│  │ • attachedImage (File | null)                         │  │
│  │ • imagePreview (string | null)                        │  │
│  │ • extractionPreview (ExtractionPreview | null)        │  │
│  │ • showPreview (boolean)                               │  │
│  │ • error (string | null)                               │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Event Handlers                                        │  │
│  │ • handleFileSelect() - File picker                   │  │
│  │ • handleDragOver/Drop() - Drag & drop                │  │
│  │ • handlePaste() - Clipboard paste                    │  │
│  │ • handleKeyDown() - Enter/Escape                     │  │
│  │ • processInput() - Main processing                    │  │
│  │ • confirmAndSave() - Save to database                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Services Used                                         │  │
│  │ • aiDataIngestion.extractData()                       │  │
│  │   - Text analysis                                     │  │
│  │   - Image OCR/Vision                                  │  │
│  │   - URL scraping                                      │  │
│  │                                                       │  │
│  │ • dataRouter.generateOperationPlan()                   │  │
│  │   - Create database operations                        │  │
│  │                                                       │  │
│  │ • vehicleImageMatcher                                 │  │
│  │   - Find matching vehicles                            │  │
│  │   - Compare specs & images                            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Input Types & Processing

```
┌─────────────────────────────────────────────────────────────┐
│ INPUT TYPE: VIN                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Input: "1G1BL52S7TR123456"                                │
│                                                             │
│  Processing:                                                │
│  1. Validate VIN format                                     │
│  2. Decode VIN (NHTSA API)                                 │
│  3. Extract: year, make, model, specs                      │
│  4. Check for existing vehicle with same VIN               │
│  5. Show preview or auto-merge                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ INPUT TYPE: URL                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Input: "https://craigslist.org/..."                       │
│                                                             │
│  Processing:                                                │
│  1. Scrape listing page                                     │
│  2. Extract: title, description, images, price             │
│  3. Analyze images with AI Vision                           │
│  4. Extract vehicle data from text + images                 │
│  5. Check for matching vehicle                             │
│  6. Show preview with match evidence                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ INPUT TYPE: Image                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Input: [Vehicle photo] + optional text context             │
│                                                             │
│  Processing:                                                │
│  1. Analyze image with OpenAI Vision                        │
│  2. Extract: year, make, model, condition, features         │
│  3. OCR any text in image (VIN, mileage, etc.)            │
│  4. Combine with text context if provided                  │
│  5. Generate operation plan                                 │
│  6. Show preview                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ INPUT TYPE: Text Description                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Input: "1974 Chevy Blazer, 350 V8, 4x4"                    │
│                                                             │
│  Processing:                                                │
│  1. Parse text with AI                                      │
│  2. Extract: year, make, model, engine, features             │
│  3. Generate operation plan                                 │
│  4. Show preview                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Matching & Merging Logic

```
                    Vehicle Data Extracted
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Find by Specs     │
                    │  (year/make/model) │
                    └──────────┬─────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
         ┌──────────┐   ┌──────────┐   ┌──────────┐
         │  FOUND   │   │  FOUND   │   │ NOT      │
         │  1       │   │  MULTIPLE│   │ FOUND    │
         └────┬─────┘   └────┬─────┘   └────┬─────┘
              │              │              │
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐     │      ┌──────────────┐
    │ Image Matching  │     │      │ Create New   │
    │ • Compare images│     │      │ Vehicle      │
    │ • Visual features│    │      └──────────────┘
    │ • Confidence score│   │
    └────────┬────────┘    │
             │              │
    ┌────────┼────────┐      │
    │        │        │      │
    ▼        ▼        ▼      ▼
>80%    50-80%   <50%   Select
Auto    Preview  Create which
merge   match    new    vehicle
        evidence        to match
```

## Database Operations

```
┌─────────────────────────────────────────────────────────────┐
│ Operation Plan Generated                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Vehicle Operation                                     │  │
│  │ • isNew: true/false                                  │  │
│  │ • vehicleId: existing or null                        │  │
│  │ • data: {year, make, model, vin, ...}                │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Image Operations                                      │  │
│  │ • Upload images to storage                           │  │
│  │ • Create image records                               │  │
│  │ • Link to vehicle                                    │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Receipt Operations (if applicable)                    │  │
│  │ • Create receipt record                              │  │
│  │ • Link to vehicle                                    │  │
│  │ • Extract vendor, total, items                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Timeline Events                                       │  │
│  │ • Create "Vehicle added" event                       │  │
│  │ • Create "Receipt added" event (if applicable)        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  User confirms → executeOperationPlan()                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling

```
┌─────────────────────────────────────────────────────────────┐
│ Error States                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Validation Errors                                     │  │
│  │ • "Please enter text or attach an image"             │  │
│  │ • "Image file too large (max 10MB)"                  │  │
│  │ • "Please select an image file"                       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Authentication Errors                                 │  │
│  │ • "Please log in to use this feature"                 │  │
│  │ • "Please log in to save data"                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Processing Errors                                     │  │
│  │ • "Failed to process input"                           │  │
│  │ • "Match confidence too low to merge automatically"   │  │
│  │ • "No operation plan or match result available"       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  Error Display:                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ [Error message in red box below input]              │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Navigation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Navigation Outcomes                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Search Query Detected:                                     │
│    → /vehicles?search=query                                 │
│    → /organizations?search=query                            │
│                                                             │
│  Strong Match (>80%):                                       │
│    → Auto-merge vehicle                                      │
│    → /vehicle/{vehicleId}                                   │
│                                                             │
│  Moderate Match (50-80%):                                   │
│    → Show preview with match evidence                       │
│    → User confirms → /vehicle/{vehicleId}                    │
│                                                             │
│  New Vehicle Created:                                       │
│    → /vehicle/{newVehicleId}                                │
│                                                             │
│  Vehicle Updated:                                           │
│    → /vehicle/{vehicleId}                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


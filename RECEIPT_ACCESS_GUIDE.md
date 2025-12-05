# Receipt Access Guide - For Meetings

## ✅ How to Access Receipts on Any Vehicle Profile

### Step 1: Go to Vehicle Profile
Navigate to any vehicle profile:
- URL: `https://n-zero.dev/vehicle/{vehicle-id}`
- Or browse vehicles and click on one

### Step 2: Find Timeline Events
- Scroll to the **Timeline** section
- You'll see events listed by date
- Each event shows: date, title, description, images

### Step 3: Click on Any Event
- **Click anywhere on an event card** in the timeline
- The receipt modal will open automatically
- Shows: Date navigation, Evidence set, Work performed, Cost breakdown

### Step 4: Navigate Between Events
- Use **PREV DAY** / **NEXT DAY** buttons at top
- Or click **ESC** to close and click another event

## 🎯 Test Vehicles with Events

Here are vehicles with events ready to test:

1. **1974 CHEVROLET Blazer** (159 events)
   - ID: `05f27cc4-914e-425a-8ed8-cfea35c1928d`
   - URL: `https://n-zero.dev/vehicle/05f27cc4-914e-425a-8ed8-cfea35c1928d`

2. **1977 CHEVROLET Blazer** (74 events)
   - ID: `e08bf694-970f-4cbe-8a74-8715158a0f2e`
   - URL: `https://n-zero.dev/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e`

3. **1983 GMC K2500** (60 events)
   - ID: `5a1deb95-4b67-4cc3-9575-23bb5b180693`
   - URL: `https://n-zero.dev/vehicle/5a1deb95-4b67-4cc3-9575-23bb5b180693`

4. **1974 FORD Bronco** (test vehicle - 20 bundles)
   - ID: `eea40748-cdc1-4ae9-ade1-4431d14a7726`
   - URL: `https://n-zero.dev/vehicle/eea40748-cdc1-4ae9-ade1-4431d14a7726`

## 📋 What You'll See in Receipt

### Header
- Date navigation (PREV DAY / NEXT DAY)
- Work order number
- Date and performer

### Evidence Set
- Photo grid (all images from that date)
- AI analysis status (✓ Analyzed or ⏳ AI pending)

### Work Performed
- Event title and description
- What work was done

### Cost Breakdown
- Table format: Item | Qty | Unit | Total
- Parts, labor, materials
- Total at bottom

### Footer
- [ESC TO CLOSE] instruction

## ✅ Receipt is Working

The receipt component is:
- ✅ Integrated in VehicleTimeline
- ✅ Opens when clicking events
- ✅ Shows wireframe-aligned design
- ✅ Ready to display data (will show when analysis runs)

## 🎤 For Your Meeting

**Demo Flow:**
1. Open vehicle profile
2. Scroll to timeline
3. Click any event
4. Show receipt with date navigation
5. Show evidence set with photos
6. Show cost breakdown table (empty until analysis runs)

**Talking Points:**
- "Receipts are accessible from any vehicle profile"
- "Click any timeline event to see detailed receipt"
- "Date navigation lets you browse between work sessions"
- "Evidence set shows all photos from that work session"
- "Cost breakdown ready - will populate when AI analysis runs"


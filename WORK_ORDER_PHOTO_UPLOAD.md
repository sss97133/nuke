# Work Order Request with Photo Upload

## ✅ Implemented Features

### **Customer Request Flow (Web & Mobile)**

#### 1. Click "Request Work" on Organization Profile
- Button appears on all organization profiles
- Works on desktop and mobile

#### 2. Fill Out Work Order Form
**Vehicle Selection:**
- Auto-loads vehicles from customer's garage
- Optional (for general inquiries)

**Work Details:**
- Title: Brief summary (e.g., "Upholstery repair")
- Description: Detailed explanation
- Urgency: Low / Normal / High / Emergency

**📸 Photo Upload (NEW):**
- **Mobile**: Opens camera with `capture="environment"` attribute
  - Triggers native camera on phones
  - Takes photo → uploads immediately
  - Can take multiple photos
- **Desktop**: File picker for selecting images
- **Features**:
  - Upload multiple photos
  - Preview thumbnails (80x80px)
  - Remove button (red × in corner)
  - Upload progress indicator
  - Stores in Supabase storage: `work-orders/{orgId}/{timestamp}.jpg`

**Contact Info:**
- Auto-fills from user profile
- Name, phone, email
- Editable before submission

#### 3. Submit Work Order
- Creates `work_order` record with:
  - All form data
  - `images` array with photo URLs
  - `status='pending'`
  - `request_source='web'`
- Shop owner receives notification
- Customer gets confirmation

---

## 📱 Mobile Experience

### **Camera Integration:**
```html
<input
  type="file"
  accept="image/*"
  multiple
  capture="environment"
  onChange={handleImageUpload}
/>
```

**What happens on mobile:**
1. User taps "📸 Take Photos / Upload"
2. Phone camera opens (back camera)
3. User takes photo
4. Photo uploads to cloud storage
5. Thumbnail appears in form
6. User can take more photos or continue

**Benefits:**
- One-handed operation
- Instant upload (no waiting for form submission)
- Visual evidence for shop to assess work
- Higher accuracy quotes

---

## Shop Owner Flow (What They See)

1. **Notification**: New work order received
2. **View Work Order**:
   - Customer name, vehicle, urgency
   - Description of work needed
   - **Photo attachments** (thumbnails, click to enlarge)
   - Contact info
3. **Provide Quote** (based on photos + description)
4. **Customer approves** → Schedule work
5. **Work completed** → Mark as done

---

## Technical Details

### **Image Storage:**
- Path: `work-orders/{organizationId}/{timestamp}_{random}.{ext}`
- Bucket: `vehicle-data`
- Public URLs for shop owners to view
- Max size: Browser default (~5-10MB per photo)

### **Database Schema:**
```sql
work_orders.images TEXT[]  -- Array of image URLs
```

### **Upload Process:**
1. User selects/captures photo
2. JavaScript uploads to Supabase Storage
3. Public URL returned
4. URL added to `uploadedImages` state
5. On submit, URLs saved to `work_orders.images` column

---

## Next Steps (SMS Integration)

When we add Twilio SMS support:
- Customer texts shop: "Need upholstery repair, sending pics"
- System creates work order with `request_source='sms'`
- Customer sends MMS images → Attached to work order
- Shop replies with quote via SMS

---

## Test It Now

**Mobile:**
1. Visit on phone: `https://n-zero.dev/org/e796ca48-f3af-41b5-be13-5335bb422b41`
2. Tap "Request Work"
3. Tap "📸 Take Photos / Upload"
4. Camera opens → Take photos of the work needed
5. Fill out form → Submit

**Desktop:**
1. Visit on computer: Same URL
2. Click "Request Work"  
3. Click "📸 Take Photos / Upload"
4. Select images from computer
5. Submit

---

## Benefits for Shops

✅ **Accurate Quotes**: Visual evidence = better estimates  
✅ **Faster Response**: Shop can quote immediately  
✅ **Reduced Back-and-Forth**: No "send me a photo" messages  
✅ **Better Documentation**: Photos attached to work order  
✅ **Mobile-First**: Most customers use phones  

---

## Benefits for Customers

✅ **Convenient**: Take photos while looking at problem  
✅ **Better Communication**: Show exactly what's wrong  
✅ **Faster Service**: Shop quotes quicker with photos  
✅ **Transparency**: Visual record of issue  
✅ **Peace of Mind**: "They saw the photos, they know what I need"


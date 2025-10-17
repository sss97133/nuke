# Clickable Elements Audit - What Works, What's Broken

## Main Page (Discovery)

### What Should Be Clickable:

1. **View Mode Buttons** (Gallery/Compact/Technical)
   - Status: ✅ NOW WORKS (just fixed)
   - Action: Changes card layout and image size

2. **Rare Finds Vehicle Cards**
   - Status: ✅ WORKS (just added images)
   - Action: Navigate to vehicle profile

3. **Hot Right Now Vehicle Cards**
   - Status: ✅ WORKS (just added images)
   - Action: Navigate to vehicle profile

4. **Recent Images**
   - Status: ⚠️ CHECK - Should open lightbox or vehicle
   - Action: TBD

5. **Active Shops**
   - Status: ✅ WORKS
   - Action: Navigate to shop page

6. **Feed Items (DiscoveryFeed)**
   - Status: ✅ WORKS
   - Action: Navigate to vehicle/event

---

## Vehicle Profile Page

### Header Section:

1. **Vehicle Title/Name**
   - Status: ❌ NOT CLICKABLE (should be)
   - Should: Allow editing (if owner)

2. **"Add to Favorites" / "Follow Vehicle"**
   - Status: ❌ MISSING
   - Should: Let users follow vehicle for updates

3. **"Review AI Tags" Button**
   - Status: ❌ MISSING (need to add)
   - Should: Link to /vehicle/:id/verify-tags

### Overview Tab:

4. **VehiclePricingWidget "BUILD INVESTMENT" Section**
   - Status: ⚠️ Shows AI parts but not clickable
   - Should: Click part → Show all images with that part

5. **Statistics Numbers**
   - Status: ❌ NOT CLICKABLE
   - Should: Click "145 photos" → Jump to Images tab

### Timeline Tab:

6. **Timeline Event Cards**
   - Status: ✅ NOW CLICKABLE (just fixed)
   - Action: Opens EventDetailModal

7. **Images in Event Cards**
   - Status: ⚠️ VISIBLE but what happens on click?
   - Should: Open lightbox with session context

8. **AI-Detected Part Tags**
   - Status: ✅ CLICKABLE
   - Action: Opens PartHistoryModal

9. **"+ Add Event" Button**
   - Status: ❌ MISSING
   - Should: Open QuickEventCreate form

10. **Date Headers**
    - Status: ⚠️ CLICKABLE but broken
    - Should: Show all images from that date

### Images Tab:

11. **Image Thumbnails**
    - Status: ✅ CLICKABLE
    - Action: Opens lightbox

12. **Upload Area**
    - Status: ✅ CLICKABLE (just rebuilt)
    - Action: SafeImageUpload workflow

13. **Filter/Sort Controls**
    - Status: ❌ MISSING
    - Should: Filter by date, tag, untagged

### Comments Tab:

14. **"Add Comment" Button**
    - Status: ⚠️ CHECK
    - Action: Should open comment form

---

## Lightbox (ImageLightbox)

### Controls:

15. **Zoom Buttons (-/+/Reset)**
    - Status: ⚠️ CHECK - Do they work?
    - Should: Zoom image

16. **Navigation (Prev/Next)**
    - Status: ✅ WORKS
    - Action: Navigate images

17. **Close Button (X)**
    - Status: ✅ WORKS
    - Action: Close lightbox

18. **AI Analyze Button**
    - Status: ❌ MISSING or hidden
    - Should: Trigger AI analysis on current image

### Sidebar:

19. **AI-Supervised Tag Cards**
    - Status: ✅ VISIBLE
    - Clickable: ⚠️ Should link to part catalog

20. **Verify Button (on each tag)**
    - Status: ✅ ADDED
    - Action: Mark tag as verified

21. **Reject Button (on each tag)**
    - Status: ✅ ADDED
    - Action: Delete tag

22. **Vendor Links**
    - Status: ✅ CLICKABLE
    - Action: Open vendor page in new tab

23. **Generic Tags Dropdown**
    - Status: ✅ WORKS (collapsible)
    - Action: Expand/collapse

---

## Tag Verification Dashboard (/verify-tags)

24. **Previous/Next Buttons**
    - Status: ✅ ADDED
    - Action: Navigate tag queue

25. **Verify and Continue**
    - Status: ✅ ADDED
    - Action: Approve tag, move to next

26. **Reject and Continue**
    - Status: ✅ ADDED
    - Action: Delete tag, move to next

27. **Skip Button**
    - Status: ✅ ADDED
    - Action: Move to next without action

28. **Filter Dropdown**
    - Status: ✅ ADDED
    - Action: Filter AI-supervised vs generic

---

## Broken/Missing Clickables - Priority Order

### CRITICAL (Fix Now):

1. **Add "Review AI Tags" button to vehicle profile header**
   - 2,616 tags need review, no way to access verification page

2. **Add "+ Add Event" button to timeline**
   - Users have no way to manually create events

3. **Fix timeline date click**
   - Currently broken, should show images from that date

4. **Add filter controls to image gallery**
   - Can't filter 532 images by date or tag

### HIGH:

5. **Make statistics clickable in vehicle profile**
   - "145 photos" → Jump to Images tab
   - "72 events" → Jump to Timeline tab

6. **Add "AI Analyze" button to lightbox**
   - Visible when no tags, lets user trigger analysis

7. **Make part tags in pricing widget clickable**
   - Click part → Show all images with that part

### MEDIUM:

8. **Add session context to lightbox**
   - Show "Image 23 of 60 from Paint Prep session"
   - Filmstrip of other images from session

9. **Add image gallery sort/filter bar**
   - By date, by tag, by untagged only

10. **Add vehicle follow/favorite button**
    - Let users track vehicles they're interested in


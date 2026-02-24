# 📸 MANUAL SCREENSHOT GUIDE - Production Testing

**Playwright tools unavailable - manual browser testing required**

---

## 🎯 **WHAT TO SCREENSHOT:**

### **Screenshot 1: Homepage**
```
URL: https://nuke.ag
File: screenshot-1-homepage.png

Capture:
- Vehicle list view
- Check if thumbnails load
- Verify data displays correctly
```

### **Screenshot 2: Vehicle Profile**
```
URL: https://nuke.ag/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c
File: screenshot-2-profile-page.png

Capture:
- Vehicle header with info
- Image gallery section
- Timeline section
```

### **Screenshot 3: Console BEFORE Click**
```
Open Console: Cmd+Option+J
Clear: Cmd+K
File: screenshot-3-console-before.png

Capture:
- Empty/cleared console
- Shows you're starting fresh
```

### **Screenshot 4: Click Image + Console**
```
Action: Click blue truck image
File: screenshot-4-clicked-image-console.png

Capture:
- Console output showing:
  - "✅ Loaded 3 tags for image..."
  - "🔍 TAG DEBUG: {...}"
- Page showing lightbox (if it opens)
```

### **Screenshot 5: Lightbox Full View**
```
File: screenshot-5-lightbox-view.png

Capture:
- Full lightbox if it opened
- Look for green dots on image
- Capture entire screen
```

### **Screenshot 6: Console Debug Output (CLOSE UP)**
```
File: screenshot-6-console-debug-closeup.png

Capture:
- Zoom in on the "🔍 TAG DEBUG:" section
- Make numbers clearly readable
- Show totalTags, visibleTags, spatialTags values
```

### **Screenshot 7: Any Errors**
```
File: screenshot-7-errors.png

Capture:
- Any red error messages in console
- Full error text visible
```

---

## 📱 **HOW TO TAKE SCREENSHOTS:**

### **macOS:**
```bash
# Full screen
Cmd + Shift + 3

# Selected area (RECOMMENDED)
Cmd + Shift + 4
  → Drag to select area
  → Release to capture

# Window capture
Cmd + Shift + 4
  → Press Spacebar
  → Click window
  
# Screenshots save to Desktop by default
```

### **Windows:**
```bash
# Full screen
PrtScn (Print Screen)

# Active window
Alt + PrtScn

# Snip tool (RECOMMENDED)
Win + Shift + S
  → Select area
  → Auto-copies to clipboard
```

---

## 🔍 **CRITICAL DATA TO CAPTURE:**

### **From Console Output:**
```javascript
// Find this and capture it:
🔍 TAG DEBUG: {
  totalTags: X,      // ← THIS NUMBER
  tagView: "all",    // ← THIS VALUE
  visibleTags: Y,    // ← THIS NUMBER
  spatialTags: Z,    // ← THIS NUMBER
  sampleTag: {...}   // ← THIS OBJECT
}
```

### **What I Need to See:**
1. The exact numbers for totalTags, visibleTags, spatialTags
2. Whether lightbox opened or not
3. Whether green dots are visible or not
4. Any error messages in red

---

## 📊 **ALTERNATIVE: JUST TELL ME THE NUMBERS**

If screenshots are difficult, just copy-paste from console:

**Report Format:**
```
Lightbox opened: Yes/No
Console output:
totalTags: ?
visibleTags: ?
spatialTags: ?

Green dots visible: Yes/No
Errors: [paste any red errors]
```

That's all I need to diagnose and fix!

---

## 🎯 **OR USE BUILT-IN BROWSER TOOLS:**

### **Chrome DevTools Screenshot:**
```
1. Open DevTools (Cmd+Option+J)
2. Press Cmd+Shift+P (command palette)
3. Type "screenshot"
4. Select "Capture full size screenshot"
5. Saves automatically to Downloads
```

### **Firefox Developer Tools:**
```
1. Open DevTools (Cmd+Option+I)
2. Click three-dot menu (⋯)
3. Select "Take a screenshot"
4. Choose "Save full page" or "Save visible area"
```

---

## 🚀 **QUICK TEST (30 SECONDS):**

1. Open: https://nuke.ag/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c
2. Console: Cmd+Option+J
3. Click: Blue truck
4. Look: For "🔍 TAG DEBUG:"
5. Report: The 3 numbers (totalTags, visibleTags, spatialTags)

**That's it! Those 3 numbers will tell me exactly what's broken.** 🔍


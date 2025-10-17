# Clear Browser Cache - Fix Old UI Showing

## The Problem
You're seeing the old "Tag Image" sidebar because your browser cached the old JavaScript bundle.

## Solution: Hard Refresh

### **Chrome/Edge (Mac):**
```
Cmd + Shift + R
```

### **Chrome/Edge (Windows):**
```
Ctrl + Shift + R
```

### **Safari:**
```
Cmd + Option + R
```

### **Firefox:**
```
Ctrl + F5
```

## Nuclear Option (If Hard Refresh Doesn't Work)

### **1. Clear Site Data:**
1. Open DevTools (F12)
2. Go to "Application" tab
3. Click "Clear site data"
4. Refresh page

### **2. Clear Cache via Browser Settings:**
**Chrome:**
1. Settings → Privacy and Security → Clear browsing data
2. Check "Cached images and files"
3. Clear data
4. Refresh site

### **3. Disable Cache During Development:**
**Chrome DevTools:**
1. Open DevTools (F12)
2. Go to Network tab
3. Check "Disable cache"
4. Keep DevTools open while developing

## Verify It's Fixed

After clearing cache, you should see:
- ✅ Clean Windows 95 sidebar (gray with blue title bar)
- ✅ "Tags (X)" heading, not "Tag Image"
- ✅ Blue/teal squares for tag source, not emojis
- ✅ Tags listed with part numbers and vendor links
- ❌ NO "Tag Image" button
- ❌ NO "Tagged Parts (0)" section
- ❌ NO "Enable tagging and click" message

## Alternative: Force New Build

```bash
cd nuke_frontend
rm -rf dist node_modules/.vite
npm run build
# Then hard refresh browser
```

**The old UI is NOT in the current code - it's just cached in your browser!**


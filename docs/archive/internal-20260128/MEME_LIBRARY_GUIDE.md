# Meme Library Guide

## Adding Reaction Meme Images

The meme library supports image-based reaction memes (PNG, JPG, WebP, GIF) for dropping on vehicle profiles.

### Quick Start

1. **Via Admin UI** (Recommended):
   - Go to `/admin/meme-library`
   - Select a pack (e.g., "Essentials")
   - Fill in meme details:
     - Title: Name of the meme (e.g., "Drake No", "Wojak")
     - Slug: Auto-generated from title
     - Tags: Comma-separated (e.g., "reaction, drake, no")
   - Either:
     - **Upload file**: Choose a PNG/JPG/WebP/GIF file
     - **Import from URL**: Paste direct image URL (must be from allowed hosts)

2. **Via Script**:
   ```bash
   npm run import:memes
   ```
   Edit `scripts/import-popular-memes.ts` to add meme URLs.

### Finding Meme Images

For 4chan/YouTube-style reaction memes:

1. **Direct Image URLs**: Find direct links to PNG/JPG files
   - Right-click on meme image → "Copy image address"
   - Use URLs from imgur.com (direct .png/.jpg links)
   - Use URLs from known meme repositories

2. **Safe Sources**:
   - Wikimedia Commons (CC0/Public Domain)
   - Your own uploads
   - Meme generator sites (save and upload)

### Allowed Hosts for URL Imports

Currently allowed:
- `upload.wikimedia.org`
- `commons.wikimedia.org`
- `i.imgur.com`
- `imgur.com`

To add more hosts, update `supabase/functions/admin-import-meme-url/index.ts`.

### Popular Reaction Memes to Add

Classic 4chan/YouTube reaction memes:
- Wojak variations (Feels Guy, Sad Wojak, etc.)
- Pepe the Frog variations
- Drake pointing (approving/disapproving)
- Expanding Brain
- Distracted Boyfriend
- Change My Mind
- Woman Yelling at Cat
- Stonks
- This is Fine (dog in burning room)
- Drakeposting variations
- Chad vs Wojak comparisons

### Tips

- **File Size**: Keep images under 2MB for best performance
- **Format**: PNG for text overlays, JPG for photos, WebP for best compression
- **Resolution**: 400-800px width is ideal for meme overlays
- **License**: Always verify you have rights to use the image

### Example: Adding via Admin UI

1. Find a meme image URL (e.g., from imgur: `https://i.imgur.com/example.png`)
2. Go to `/admin/meme-library`
3. Select "Essentials" pack
4. Fill in:
   - Title: "Sad Wojak"
   - Import URL: `https://i.imgur.com/example.png`
   - License: "Fair Use" or appropriate license
   - Tags: "wojak, sad, reaction"
5. Click "IMPORT URL"

The image will be downloaded, stored in Supabase Storage, and made available in the meme library!


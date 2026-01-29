# Meme Packs Reference

## Available Packs

### Core Packs
- **essentials** - Core reactions and text popups (18 actions)
- **frog** - Frog templates and reactions
- **pepe** - Pepe (Frog) templates/reactions
- **meat_pipeline** - High-signal meme templates

### Spectrum Packs (New)
- **hater** - Hater reactions and negative energy memes
- **incel** - Incel reactions and memes
- **left_wing** - Left wing political reactions and memes
- **right_wing** - Right wing political reactions and memes
- **youtube** - YouTube reactions and meme culture
- **negative_energy** - Negative reactions and downer memes
- **chad** - Chad reactions and alpha memes
- **reactions** - General reaction GIFs and memes

## Adding GIPHY GIFs

To add GIFs from GIPHY:

1. Find the GIF on GIPHY
2. Right-click → "Copy image address" or use the direct URL format:
   - `https://i.giphy.com/[ID].gif` (direct image URL)
   - `https://media.giphy.com/media/[ID]/giphy.gif` (also works)

3. In admin UI (`/admin/meme-library`):
   - Select appropriate pack
   - Paste GIPHY direct URL
   - Fill in title, tags, license (usually "Fair Use")
   - Click "IMPORT URL"

## Meme Templates Needed

Based on the spectrum request, here are the memes to add:

### Reactions Pack
- Arthur Fist (angry Arthur)
- Confused Charlie (Always Sunny)
- Crying Dawson
- Hair Flip (Ariana Grande)
- Like a Boss (Andy Samberg SNL)
- Sips Tea

### Negative Energy Pack
- Fail - Kids Falling
- Forever Alone

### Hater Pack
- No Fucks Given (IDGAF)
- Look at All the Fucks I Give

### Chad Pack
- Steal Yo Girl
- Money Swag
- Deal With It

### YouTube Pack
- Judge Judy
- Dank Memes
- Cuca (TV Globo)
- Feels

To add these, find the GIPHY direct URLs and import via admin UI or add to `scripts/import-popular-memes.ts`.


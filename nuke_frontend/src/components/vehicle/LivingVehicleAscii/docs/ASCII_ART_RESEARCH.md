# ASCII art research: how it’s made & image → ASCII

## 1. What ASCII art is

- **Definition:** Pictures made from the **95 printable ASCII characters** (codes 32–126), or from extended/Unicode sets. Usually shown in a **fixed-width (monospace) font** so alignment is predictable.
- **History:** Line printers, teletypes, BBSes; early work at Bell Labs (Knowlton, Harmon). Used when graphics weren’t available or for banners, emails, and terminals.
- **Styles (from Wikipedia):**
  - **Typewriter:** Letters only (e.g. “HELLO” built from H, E, L, L, O).
  - **Line art:** `.\_-/|` etc. for outlines and shapes.
  - **Solid / shading:** Characters chosen by “darkness” to suggest fill and gradient.
  - **Block / high ASCII:** Extended characters (e.g. Code page 437: ▓ ▒ ░ █) for more tonal range.
  - **Newskool:** Dense character strings like `$#Xxo` for texture.

---

## 2. Image → ASCII (how conversion works)

Automatic conversion is a form of **vector quantization**: reduce the image to a grid of “cells,” then represent each cell by one character.

### Core steps

1. **Input image**  
   Any bitmap (PNG, JPG, canvas, etc.).

2. **Downsample to character grid**  
   - Target size is in “characters” (e.g. 80 cols × 40 rows).  
   - Each character cell corresponds to a **block of pixels** in the image.  
   - For each cell, compute a single value (or a few) from that block.

3. **Luminance (grayscale)**  
   - Convert the block to one brightness value.  
   - **Rec. 601 (TV):** `Y = 0.299*R + 0.587*G + 0.114*B` — good default for “perceived” brightness.  
   - **Simple average:** `(R + G + B) / 3` — fast, less accurate.  
   - **Canvas `getImageData()`** gives sRGB values; for strict correctness you can linearize first, but the 0.299/0.587/0.114 formula on sRGB is common and looks fine.  
   - Optionally normalize (e.g. 0–1 or 0–255).

4. **Map luminance → character**  
   - Define a **character set** ordered by “darkness” or “fill.”  
   - Example (dark → light): `$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\|()1{}[]?-_+~<>i!lI;:,"^'\`.  
   - Or simpler: `. : - = + * # % @` (fewer steps).  
   - For each cell, pick the character whose “weight” is closest to that cell’s luminance.

5. **Output**  
   - One character per cell → string per row → lines joined by `\n`.  
   - Can be drawn in a `<pre>`, or on a canvas with `fillText`, or sent to a terminal.

### What limits quality (Wikipedia)

- **Depth / tonal range:** Few characters → banding. Improve with: more characters, block elements (░ █ ▄ ▀), Braille, or colored output.
- **Sharpness:** Large cells → blurry. Improve with: smaller font, more columns/rows, or edge-aware sampling.
- **Aspect ratio:** Characters are usually taller than wide. Improve with: square-ish font, or scaling the sample grid (e.g. sample more horizontally than vertically).

### Libraries and tools

- **AAlib:** Classic C library; grayscale image/video → ASCII (terminal).  
- **libcaca:** Colour ASCII art (e.g. used by VLC, mpv).  
- **Browser/JS:** No single standard. Typical approach:  
  - Draw image (or load into) `<canvas>` → `getImageData()` → sample by blocks → luminance → character map → build string (or draw with `fillText`).

---

## 3. Implementing “image → ASCII” in the browser

### Data flow

```
Image (file or URL)
  → draw onto Canvas
  → getImageData(x, y, w, h)
  → for each character-sized block:
       average R,G,B (or use luminance formula)
       clamp to [0, 1]
       index into charset by luminance
       append character
  → join rows with \n
  → display in <pre> or second canvas (fillText per line)
```

### Pseudocode

```text
charset = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. "
cols = 80
rows = 40
cellW = imageWidth / cols
cellH = imageHeight / rows

for row in 0..rows:
  line = ""
  for col in 0..cols:
    x = col * cellW
    y = row * cellH
    block = getBlockPixels(imageData, x, y, cellW, cellH)
    lum = averageLuminance(block)
    idx = round(lum * (len(charset) - 1))
    line += charset[idx]
  output += line + "\n"
```

### Optional improvements

- **Edge detection:** Use gradient magnitude so edges get “sharper” characters (e.g. `/\|_-`).
- **Color ASCII:** Keep RGB per cell; output HTML/ANSI or draw colored glyphs on canvas.
- **Block elements:** Use Unicode (e.g. ░ ▒ ▓ █) for more levels than 95 ASCII.
- **Aspect correction:** Sample with `cellW = imageWidth/cols` and `cellH = 2*imageHeight/rows` (or similar) so result isn’t stretched when rendered in monospace.

---

## 4. From a source file (image): loading and converting

“Source file” here means any **image file** (PNG, JPEG, GIF, WebP, etc.) that you load in the browser or in Node, then run through the same pipeline above.

### 4.1 Getting image data in the browser

| Source | How to get pixel data |
|--------|------------------------|
| **File input** | User picks file → `FileReader.readAsDataURL()` or `createObjectURL()` → set as `img.src` → when `img.onload`, draw to canvas → `getImageData()`. |
| **URL** | Set `img.src = url` (same-origin or CORS-enabled) → `onload` → draw to canvas → `getImageData()`. |
| **Drag-and-drop** | `dataTransfer.files` → get first image file → same as file input. |
| **Canvas** | Already have a canvas → `ctx.getImageData(0, 0, w, h)`. |
| **Blob / ArrayBuffer** | `createImageBitmap(blob)` → draw bitmap to canvas → `getImageData()`. |

Important: **CORS.** If the image is from another origin, the server must send `Access-Control-Allow-Origin` (or you use a proxy), and you may need `img.crossOrigin = "anonymous"` before setting `src`, or `getImageData()` can be tainted and throw.

### 4.2 Pipeline from “file” to ASCII

1. **Load** the image (from file, URL, or blob) into an `HTMLImageElement` or `ImageBitmap`.
2. **Draw** it onto a temporary `<canvas>` (same width/height as the image, or scaled to your desired sample size).
3. **Read** pixels with `ctx.getImageData(0, 0, width, height)`.
4. **Downsample** to a character grid (e.g. 80×40): for each cell, average (or luminance) of the block.
5. **Map** each cell luminance to a character from your charset.
6. **Output** a string (lines joined by `\n`) and render in `<pre>` or with canvas `fillText()`.

So “from a source file” = load file → image → canvas → steps 2–5 in section 2.

### 4.3 Aspect ratio and cell shape

Monospace characters are usually **~2:1 height:width**. So one character is taller than it is wide. If you sample the image in a 1:1 grid, the ASCII art will look **vertically stretched**. Common fixes:

- **Sample with non-square cells:** e.g. make each “logical” character cell cover more horizontal pixels than vertical. Example: `cellW = imageWidth / cols`, `cellH = (imageHeight / rows) * 2` (or use a ratio that matches your font).
- **Use a square-ish font** (e.g. “Square” or similar) so 1:1 sampling is acceptable.
- **Pre-scale the image** so that after 1:1 sampling the display aspect looks right (e.g. squash image height by 0.5 before sampling).

### 4.4 Video as “source”

A **video file** (e.g. WebM, MP4) is just a sequence of frames. To get ASCII from a video:

1. Play the video in a `<video>` (or decode with Web Codecs / ffmpeg.wasm).
2. For each frame (or at a chosen interval): draw the current frame to a canvas → `getImageData()`.
3. Run the same **image → ASCII** pipeline (downsample, luminance, character map).
4. Render the resulting string (e.g. in `<pre>`) and repeat for the next frame.

So “source file = video” = treat each frame as an image and run the image→ASCII steps. Performance depends on resolution, grid size, and how often you sample (e.g. 10–30 fps).

---

## 6. References

- **Wikipedia – ASCII art:**  
  https://en.wikipedia.org/wiki/ASCII_art  
  (history, styles, “Image to text conversion,” AAlib, libcaca, fidelity limits.)
- **Wikipedia – Vector quantization:**  
  (conceptual link for “one symbol per block”.)
- **AAlib:**  
  https://en.wikipedia.org/wiki/AAlib  
- **libcaca:**  
  https://en.wikipedia.org/wiki/Libcaca  

---

## 7. Next steps in this repo

- Add a small **image-to-ASCII** helper:  
  - Input: image URL or `HTMLImageElement` / `HTMLCanvasElement`.  
  - Params: `cols`, `rows`, `charset` (optional).  
  - Output: `string` (one line per row, `\n`-separated).  
- Optionally a React component that takes `src`, runs the conversion, and renders the result in a `<pre>` or canvas so you can try different images (e.g. vehicle thumbnails, logos).

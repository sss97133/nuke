# LivingVehicleAscii — sample output

Style matches **Cursor CLI** (cursor.com/cli) + **Firecrawl** (firecrawl.dev): terminal frames, `[ badge ]` lines, `. : - = + X` texture. Canvas 431×431, displayed at **215.984px** (2x), class **`page_gridCanvas__GK3dR`**.

**Live preview:** **`/ascii-samples`**

---

## 1. Shape

Terminal frame `+-- vehicle ---+` with identity line + Firecrawl texture strip (`. : - = + X`).

```
+-- vehicle -----------------+
| 2024 Toyota Camry          |
+----------------------------+
  . : + - = X . : + - = X . :
```

---

## 2. Identity

Cursor-style terminal frame only.

```
+-- identity -----------------+
| 2024 Toyota Camry           |
+----------------------------+
```

---

## 3. Pulse

Firecrawl-style badge `[ ... ]` + texture strip.

```
  [ LIVE · $42,000 · 12 bids  ]
  . : + - = X . : + - = X . :
```

```
  [ SOLD · $48,500             ]
  . : + - = X . : + - = X . :
```

```
  [ Reserve not met            ]
  . : + - = X . : + - = X . :
```

---

## Rotation

**shape → identity → pulse** every `rotateIntervalMs` (default 3s). Colors: bg `#0c0c0c`, text `#e4e4e7`. Legacy car silhouettes still available via `getShapeLines(key)`.

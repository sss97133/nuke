// FormboardView.tsx — Canvas 2D formboard, 200×96" pegboard at 1:1 scale.
// Figma-like camera: scroll-to-zoom on cursor, smooth lerp, pinch, space+drag pan.
// 5 LOD levels. Connector click → detail panel (via parent onDeviceClick).

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { ManifestDevice, WireSpec, OverlayResult } from './overlayCompute';
import { K5_HARNESS_GRAPH, routeWiresAlongHarness, computeTrunkSegments } from './harnessRouting';
import type { TrunkRenderSegment } from './harnessRouting';

// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#1a1a2e',
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
};

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

const WIRE_DISPLAY_COLORS: Record<string, string> = {
  RED: '#ff4444', BLK: '#888888', GRN: '#22cc44', WHT: '#ffffff',
  BLU: '#4488ff', YEL: '#ffdd00', ORG: '#ff8800', VIO: '#aa44ff',
  TAN: '#cc9966', PPL: '#9944cc', PNK: '#ff88aa', BRN: '#884422',
  GRY: '#999999', 'LT GRN': '#66ee66', 'LT BLU': '#66aaff',
  'DK GRN': '#228822', 'DK BLU': '#2244aa',
};

// Board dimensions in inches (the physical formboard)
const BOARD_W = 200;
const BOARD_H = 96;
// Scale: 1 board inch = 5 canvas pixels (base)
const PX_PER_INCH = 5;
const CANVAS_W = BOARD_W * PX_PER_INCH; // 1000
const CANVAS_H = BOARD_H * PX_PER_INCH; // 480

interface CameraState { x: number; y: number; zoom: number; }

interface Props {
  devices: ManifestDevice[];
  result: OverlayResult;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, shiftKey?: boolean) => void;
  onWireClick: (wireNumber: number) => void;
  onDeselect: () => void;
  fitRequested: number;
  zoneColors: Record<string, string>;
  cameraRef: CameraState;
}

export function FormboardView({
  devices, result, selectedDeviceId, selectedDeviceIds, selectedWireId,
  onDeviceClick, onWireClick, onDeselect, fitRequested, cameraRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Camera (lerp target + current) ──
  const targetCam = useRef<CameraState>({ ...cameraRef });
  const currentCam = useRef<CameraState>({ ...cameraRef });
  const animFrame = useRef(0);
  const isPanning = useRef(false);
  const spaceDown = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const mouseCanvas = useRef({ x: 0, y: 0 }); // mouse pos in canvas coords

  // ── Precomputed routing data ──
  const routingRef = useRef<{ trunks: TrunkRenderSegment[] }>({ trunks: [] });

  // Compute trunk segments once
  useEffect(() => {
    const requests = result.wires.map(w => {
      const fromDev = devices.find(d => d.device_name === w.from.split(':')[0]);
      const toDev = devices.find(d => d.device_name === w.to);
      return {
        wireNumber: w.wireNumber,
        fromX: (fromDev?.pos_x_pct ?? 50) * PX_PER_INCH,
        fromY: (fromDev?.pos_y_pct ?? 50) * PX_PER_INCH,
        toX: (toDev?.pos_x_pct ?? 50) * PX_PER_INCH,
        toY: (toDev?.pos_y_pct ?? 50) * PX_PER_INCH,
      };
    });
    const routed = routeWiresAlongHarness(requests);
    routingRef.current.trunks = computeTrunkSegments(routed);
  }, [devices, result.wires]);

  // ── Screen <-> canvas coordinate transforms ──
  const screenToCanvas = useCallback((sx: number, sy: number): { x: number; y: number } => {
    const cam = currentCam.current;
    return {
      x: (sx - cam.x) / cam.zoom,
      y: (sy - cam.y) / cam.zoom,
    };
  }, []);

  // ── Smooth camera animation loop ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const container = containerRef.current;
    if (container) {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    // Lerp camera toward target
    const lerp = 0.15;
    const cam = currentCam.current;
    const tgt = targetCam.current;
    cam.x += (tgt.x - cam.x) * lerp;
    cam.y += (tgt.y - cam.y) * lerp;
    cam.zoom += (tgt.zoom - cam.zoom) * lerp;

    // Sync back to parent ref
    cameraRef.x = cam.x;
    cameraRef.y = cam.y;
    cameraRef.zoom = cam.zoom;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    // Apply camera transform
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    const zoom = cam.zoom;

    // ── LOD Rendering ──
    drawBoard(ctx, zoom);
    drawZones(ctx, devices, zoom);
    drawTrunks(ctx, routingRef.current.trunks, zoom, selectedWireId);
    drawWires(ctx, result.wires, devices, zoom, selectedWireId);
    drawConnectors(ctx, devices, zoom, selectedDeviceId, selectedDeviceIds);

    ctx.restore();

    // ── HUD overlay ──
    drawHUD(ctx, w, h, zoom);

    // Continue loop
    animFrame.current = requestAnimationFrame(render);
  }, [devices, result.wires, selectedDeviceId, selectedDeviceIds, selectedWireId, cameraRef, screenToCanvas]);

  // Start/stop render loop
  useEffect(() => {
    animFrame.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrame.current);
  }, [render]);

  // ── Fit-to-view ──
  useEffect(() => {
    if (fitRequested <= 0) return;
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const padding = 40;
    const zx = (w - padding * 2) / CANVAS_W;
    const zy = (h - padding * 2) / CANVAS_H;
    const z = Math.min(zx, zy, 1);
    targetCam.current = {
      zoom: z,
      x: (w - CANVAS_W * z) / 2,
      y: (h - CANVAS_H * z) / 2,
    };
  }, [fitRequested]);

  // Initial fit
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const padding = 40;
    const zx = (w - padding * 2) / CANVAS_W;
    const zy = (h - padding * 2) / CANVAS_H;
    const z = Math.min(zx, zy, 1);
    const cam = { zoom: z, x: (w - CANVAS_W * z) / 2, y: (h - CANVAS_H * z) / 2 };
    targetCam.current = { ...cam };
    currentCam.current = { ...cam };
  }, []);

  // ── Scroll-to-zoom (Figma behavior: zoom on cursor) ──
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const cam = targetCam.current;

    if (e.ctrlKey) {
      // Trackpad pinch-to-zoom
      const zoomFactor = 1 - e.deltaY * 0.01;
      const newZoom = Math.max(0.3, Math.min(15, cam.zoom * zoomFactor));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Zoom around cursor
      const scale = newZoom / cam.zoom;
      cam.x = mx - (mx - cam.x) * scale;
      cam.y = my - (my - cam.y) * scale;
      cam.zoom = newZoom;
    } else {
      // Scroll wheel zoom or pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal scroll = pan
        cam.x -= e.deltaX;
      } else {
        // Vertical scroll = zoom on cursor
        const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
        const newZoom = Math.max(0.3, Math.min(15, cam.zoom * zoomFactor));
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const scale = newZoom / cam.zoom;
        cam.x = mx - (mx - cam.x) * scale;
        cam.y = my - (my - cam.y) * scale;
        cam.zoom = newZoom;
      }
    }
  }, []);

  // Attach wheel handler (passive: false to prevent default)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Mouse handlers for pan + click ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const isMiddle = e.button === 1;
    if (isMiddle || spaceDown.current) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    // Left click — check for device hit
    if (e.button === 0) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const c = screenToCanvas(sx, sy);
      mouseCanvas.current = c;

      // Hit test devices
      const hit = hitTestDevice(c.x, c.y, devices, currentCam.current.zoom);
      if (hit) {
        onDeviceClick(hit.id, e.shiftKey);
      } else {
        // Hit test wires
        const wireHit = hitTestWire(c.x, c.y, result.wires, devices);
        if (wireHit) {
          onWireClick(wireHit.wireNumber);
        } else {
          onDeselect();
        }
      }
    }
  }, [devices, result.wires, onDeviceClick, onWireClick, onDeselect, screenToCanvas]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      targetCam.current.x += dx;
      targetCam.current.y += dy;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // ── Double-click: zoom to element ──
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const c = screenToCanvas(sx, sy);
    const hit = hitTestDevice(c.x, c.y, devices, currentCam.current.zoom);
    if (hit) {
      const dx = (hit.pos_x_pct ?? 50) * PX_PER_INCH;
      const dy = (hit.pos_y_pct ?? 50) * PX_PER_INCH;
      const container = containerRef.current;
      if (!container) return;
      const newZoom = 6;
      targetCam.current = {
        zoom: newZoom,
        x: container.clientWidth / 2 - dx * newZoom,
        y: container.clientHeight / 2 - dy * newZoom,
      };
      onDeviceClick(hit.id);
    }
  }, [devices, onDeviceClick, screenToCanvas]);

  // ── Space key for pan mode ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input, textarea')) {
        e.preventDefault();
        spaceDown.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%',
        cursor: spaceDown.current || isPanning.current ? 'grabbing' : 'crosshair',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        style={{ display: 'block' }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Drawing functions
// ══════════════════════════════════════════════════════════════════════

function drawBoard(ctx: CanvasRenderingContext2D, zoom: number) {
  // Board outline
  ctx.strokeStyle = '#333355';
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid lines (pegboard holes at 1" intervals)
  if (zoom > 0.8) {
    ctx.strokeStyle = '#222244';
    ctx.lineWidth = 0.5 / zoom;
    const step = PX_PER_INCH;
    for (let x = 0; x <= CANVAS_W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
  }

  // Board dimension labels
  if (zoom > 0.4) {
    ctx.fillStyle = '#666680';
    ctx.font = `bold ${Math.max(8, 10 / zoom)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('200"', CANVAS_W / 2, -6 / zoom);
    ctx.save();
    ctx.translate(-6 / zoom, CANVAS_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('96"', 0, 0);
    ctx.restore();
  }
}

function drawZones(ctx: CanvasRenderingContext2D, devices: ManifestDevice[], zoom: number) {
  // Draw zone color fills behind everything
  const zoneDevices: Record<string, ManifestDevice[]> = {};
  for (const d of devices) {
    if (d.location_zone && d.pos_x_pct != null && d.pos_y_pct != null) {
      if (!zoneDevices[d.location_zone]) zoneDevices[d.location_zone] = [];
      zoneDevices[d.location_zone].push(d);
    }
  }

  for (const [zone, devs] of Object.entries(zoneDevices)) {
    if (devs.length < 2) continue;
    const xs = devs.map(d => (d.pos_x_pct ?? 0) * PX_PER_INCH);
    const ys = devs.map(d => (d.pos_y_pct ?? 0) * PX_PER_INCH);
    const pad = 20;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    const color = ZONE_COLORS[zone] || '#444';

    ctx.fillStyle = color + '10'; // very faint fill
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    ctx.strokeStyle = color + '30';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    // Zone label
    if (zoom > 0.4) {
      ctx.fillStyle = color + '80';
      ctx.font = `bold ${Math.max(6, 9 / zoom)}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(zone.replace(/_/g, ' ').toUpperCase(), minX + 4 / zoom, minY + 12 / zoom);
    }
  }
}

function drawTrunks(ctx: CanvasRenderingContext2D, trunks: TrunkRenderSegment[], zoom: number, selectedWireId: number | null) {
  if (zoom < 0.4) {
    // At very low zoom, show trunk centerlines
    for (const t of trunks) {
      const color = ZONE_COLORS[t.zone] || '#444';
      ctx.strokeStyle = color + '60';
      ctx.lineWidth = Math.max(1, Math.min(t.wireCount * 0.5, 6)) / zoom;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
  } else if (zoom < 2) {
    // At medium zoom, show wire bundles as thick paths
    for (const t of trunks) {
      const color = ZONE_COLORS[t.zone] || '#444';
      ctx.strokeStyle = color + '40';
      ctx.lineWidth = Math.max(2, Math.min(t.wireCount * 0.8, 12)) / zoom;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
  }
}

function drawWires(
  ctx: CanvasRenderingContext2D,
  wires: WireSpec[],
  devices: ManifestDevice[],
  zoom: number,
  selectedWireId: number | null,
) {
  if (zoom < 2) return; // Only show individual wires at higher zoom

  const deviceMap = new Map(devices.map(d => [d.device_name, d]));

  for (const w of wires) {
    const fromName = w.from.split(':')[0];
    const fromDev = deviceMap.get(fromName);
    const toDev = deviceMap.get(w.to);
    if (!fromDev || !toDev) continue;
    if (fromDev.pos_x_pct == null || toDev.pos_x_pct == null) continue;

    const x1 = (fromDev.pos_x_pct ?? 0) * PX_PER_INCH;
    const y1 = (fromDev.pos_y_pct ?? 0) * PX_PER_INCH;
    const x2 = (toDev.pos_x_pct ?? 0) * PX_PER_INCH;
    const y2 = (toDev.pos_y_pct ?? 0) * PX_PER_INCH;

    const isSelected = w.wireNumber === selectedWireId;
    const baseColor = w.color.split('/')[0];
    const displayColor = WIRE_DISPLAY_COLORS[baseColor] || '#888';

    ctx.strokeStyle = isSelected ? C.active : (selectedWireId != null ? displayColor + '30' : displayColor + '80');
    ctx.lineWidth = (isSelected ? 2 : 0.8) / zoom;
    ctx.beginPath();
    // Manhattan routing: horizontal then vertical
    const midX = x2;
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX, y1);
    ctx.lineTo(midX, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Wire labels at zoom > 4
    if (zoom > 4) {
      ctx.fillStyle = isSelected ? C.active : displayColor + '90';
      ctx.font = `bold ${8 / zoom}px Courier New`;
      ctx.textAlign = 'center';
      const labelX = (x1 + x2) / 2;
      const labelY = y1 - 3 / zoom;
      ctx.fillText(`${w.gauge}AWG ${w.color}`, labelX, labelY);
    }
  }
}

function drawConnectors(
  ctx: CanvasRenderingContext2D,
  devices: ManifestDevice[],
  zoom: number,
  selectedDeviceId: string | null,
  selectedDeviceIds: Set<string>,
) {
  for (const d of devices) {
    if (d.pos_x_pct == null || d.pos_y_pct == null) continue;

    const x = d.pos_x_pct * PX_PER_INCH;
    const y = d.pos_y_pct * PX_PER_INCH;
    const isSelected = d.id === selectedDeviceId || selectedDeviceIds.has(d.id);
    const hasSelection = selectedDeviceId !== null;
    const zoneColor = ZONE_COLORS[d.location_zone || ''] || '#666';

    // Dim non-selected when a selection exists
    const alpha = hasSelection && !isSelected ? 0.3 : 1;

    if (zoom < 0.5) {
      // ── LOD 1: colored dots ──
      ctx.fillStyle = isSelected ? C.active : (zoneColor + (hasSelection && !isSelected ? '4d' : 'cc'));
      ctx.beginPath();
      ctx.arc(x, y, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
    } else if (zoom < 2) {
      // ── LOD 2: small blocks with abbreviated names ──
      const bw = 24 / zoom;
      const bh = 14 / zoom;
      ctx.fillStyle = isSelected ? C.active + '30' : C.elevated;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.strokeStyle = isSelected ? C.active : zoneColor;
      ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      // 3-char abbreviation
      const abbr = d.device_name.substring(0, 3).toUpperCase();
      ctx.fillStyle = isSelected ? C.active : C.text;
      ctx.font = `bold ${Math.max(6, 8 / zoom)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(abbr, x, y);
      ctx.globalAlpha = 1;
    } else if (zoom < 4) {
      // ── LOD 3: full device name, connector outlines ──
      const pinCount = d.pin_count || 2;
      const bw = Math.max(30, pinCount * 2 + 10) / zoom;
      const bh = 20 / zoom;
      ctx.fillStyle = isSelected ? C.active + '20' : C.surface;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.strokeStyle = isSelected ? C.active : zoneColor;
      ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      ctx.fillStyle = isSelected ? C.active : C.text;
      ctx.font = `bold ${9 / zoom}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.device_name.toUpperCase(), x, y);
      ctx.globalAlpha = 1;
    } else if (zoom < 8) {
      // ── LOD 4: pins visible, wire gauge labels ──
      const pinCount = d.pin_count || 2;
      const cols = Math.min(pinCount, 6);
      const rows = Math.ceil(pinCount / cols);
      const pinR = 2 / zoom;
      const pinSpacing = 5 / zoom;
      const bw = cols * pinSpacing + 20 / zoom;
      const bh = rows * pinSpacing + 24 / zoom;

      ctx.fillStyle = isSelected ? C.active + '15' : C.bg;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.strokeStyle = isSelected ? C.active : zoneColor;
      ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      // Device name
      ctx.fillStyle = isSelected ? C.active : C.text;
      ctx.font = `bold ${8 / zoom}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(d.device_name.toUpperCase(), x, y - bh / 2 + 8 / zoom);

      // Pins
      const pinStartY = y - bh / 2 + 16 / zoom;
      for (let i = 0; i < pinCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = x - (cols - 1) * pinSpacing / 2 + col * pinSpacing;
        const py = pinStartY + row * pinSpacing;
        ctx.fillStyle = isSelected ? C.active : zoneColor;
        ctx.beginPath();
        ctx.arc(px, py, pinR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Power draw
      if (d.power_draw_amps) {
        ctx.fillStyle = C.muted;
        ctx.font = `bold ${7 / zoom}px Courier New`;
        ctx.fillText(`${d.power_draw_amps}A`, x, y + bh / 2 - 3 / zoom);
      }
      ctx.globalAlpha = 1;
    } else {
      // ── LOD 5: maximum detail ──
      const pinCount = d.pin_count || 2;
      const cols = Math.min(pinCount, 6);
      const rows = Math.ceil(pinCount / cols);
      const pinR = 2 / zoom;
      const pinSpacing = 5 / zoom;
      const bw = Math.max(cols * pinSpacing + 30 / zoom, 60 / zoom);
      const bh = rows * pinSpacing + 50 / zoom;

      ctx.fillStyle = isSelected ? C.active + '10' : '#0d0d1a';
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.strokeStyle = isSelected ? C.active : zoneColor;
      ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      // Name
      ctx.fillStyle = isSelected ? C.active : C.text;
      ctx.font = `bold ${8 / zoom}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(d.device_name.toUpperCase(), x, y - bh / 2 + 8 / zoom);

      // Connector type
      ctx.fillStyle = C.muted;
      ctx.font = `bold ${6 / zoom}px Arial`;
      ctx.fillText((d.connector_type || '').replace(/_/g, ' ').toUpperCase(), x, y - bh / 2 + 15 / zoom);

      // Pins with numbers
      const pinStartY = y - bh / 2 + 22 / zoom;
      for (let i = 0; i < pinCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = x - (cols - 1) * pinSpacing / 2 + col * pinSpacing;
        const py = pinStartY + row * pinSpacing;
        ctx.fillStyle = isSelected ? C.active : zoneColor;
        ctx.beginPath();
        ctx.arc(px, py, pinR, 0, Math.PI * 2);
        ctx.fill();

        // Pin number
        ctx.fillStyle = C.muted;
        ctx.font = `${5 / zoom}px Courier New`;
        ctx.fillText(String(i + 1), px, py + pinR + 4 / zoom);
      }

      // Power + gauge
      const infoY = y + bh / 2 - 12 / zoom;
      ctx.fillStyle = C.label;
      ctx.font = `bold ${6 / zoom}px Courier New`;
      if (d.power_draw_amps) ctx.fillText(`${d.power_draw_amps}A`, x - 10 / zoom, infoY);
      if (d.wire_gauge_recommended) ctx.fillText(`${d.wire_gauge_recommended}AWG`, x + 10 / zoom, infoY);

      // Price
      if (d.price) {
        ctx.fillStyle = d.purchased ? '#22c55e' : '#ef4444';
        ctx.font = `bold ${6 / zoom}px Courier New`;
        ctx.fillText(`$${d.price}`, x, infoY + 7 / zoom);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number) {
  // Zoom level indicator
  ctx.fillStyle = '#666680';
  ctx.font = 'bold 9px Courier New';
  ctx.textAlign = 'left';
  ctx.fillText(`ZOOM: ${zoom.toFixed(2)}x`, 8, h - 8);

  // Controls hint
  ctx.textAlign = 'right';
  ctx.fillText('SCROLL=ZOOM  SPACE+DRAG=PAN  DBL-CLICK=FOCUS  F=FIT', w - 8, h - 8);
}

// ── Hit testing ─────────────────────────────────────────────────────
function hitTestDevice(
  cx: number, cy: number,
  devices: ManifestDevice[],
  zoom: number,
): ManifestDevice | null {
  const hitR = Math.max(8, 20 / zoom);
  for (const d of devices) {
    if (d.pos_x_pct == null || d.pos_y_pct == null) continue;
    const dx = d.pos_x_pct * PX_PER_INCH;
    const dy = d.pos_y_pct * PX_PER_INCH;
    if (Math.abs(cx - dx) < hitR && Math.abs(cy - dy) < hitR) return d;
  }
  return null;
}

function hitTestWire(
  cx: number, cy: number,
  wires: WireSpec[],
  devices: ManifestDevice[],
): WireSpec | null {
  const threshold = 5;
  const deviceMap = new Map(devices.map(d => [d.device_name, d]));

  for (const w of wires) {
    const fromName = w.from.split(':')[0];
    const fromDev = deviceMap.get(fromName);
    const toDev = deviceMap.get(w.to);
    if (!fromDev || !toDev) continue;
    if (fromDev.pos_x_pct == null || toDev.pos_x_pct == null) continue;

    const x1 = (fromDev.pos_x_pct ?? 0) * PX_PER_INCH;
    const y1 = (fromDev.pos_y_pct ?? 0) * PX_PER_INCH;
    const x2 = (toDev.pos_x_pct ?? 0) * PX_PER_INCH;
    const y2 = (toDev.pos_y_pct ?? 0) * PX_PER_INCH;

    // Manhattan path: horiz then vert
    // Segment 1: (x1,y1) to (x2,y1)
    if (cy >= Math.min(y1, y1) - threshold && cy <= Math.max(y1, y1) + threshold &&
        cx >= Math.min(x1, x2) - threshold && cx <= Math.max(x1, x2) + threshold) {
      if (Math.abs(cy - y1) < threshold) return w;
    }
    // Segment 2: (x2,y1) to (x2,y2)
    if (cx >= x2 - threshold && cx <= x2 + threshold &&
        cy >= Math.min(y1, y2) - threshold && cy <= Math.max(y1, y2) + threshold) {
      return w;
    }
  }
  return null;
}

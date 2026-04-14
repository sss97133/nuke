// FormboardCanvas.tsx — Canvas 2D pegboard formboard with connector blocks,
// wire routing, pin tables (zoom > 4x), DRC indicators, and print enhancement.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManifestDevice, WireSpec, PDMChannel } from './overlayCompute';
import type { DRCDeviceResult } from './useDRC';
import { supabase } from '../../lib/supabase';

// ── Constants ────────────────────────────────────────────────────────
const BOARD_W = 200; // inches
const BOARD_H = 96;  // inches
const PX_PER_INCH = 10; // base pixels per inch at zoom=1
const GRID = 1; // 1-inch grid snap
const CANVAS_W = BOARD_W * PX_PER_INCH;
const CANVAS_H = BOARD_H * PX_PER_INCH;

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222', firewall: '#cc6600', dash: '#2266cc',
  doors: '#8822cc', rear: '#22aa44', underbody: '#cc8833',
};

const DRC_COLORS: Record<string, string> = {
  pass: '#22aa44', warn: '#ccaa00', fail: '#cc2222',
};

// ── Pin Cache ────────────────────────────────────────────────────────
interface PinData {
  pin_number: string;
  pin_function: string;
  default_wire_gauge_awg: number | null;
  default_wire_color: string | null;
  connected_to_device: string | null;
}

// ── Props ────────────────────────────────────────────────────────────
interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  pdmChannels: PDMChannel[];
  drcMap: Map<string, DRCDeviceResult>;
  selectedDeviceId: string | null;
  selectedDeviceIds: Set<string>;
  selectedWireId: number | null;
  onDeviceClick: (id: string, e: React.MouseEvent) => void;
  onWireClick: (wireNumber: number) => void;
  vehicleId?: string;
}

export function FormboardCanvas({
  devices, wires, pdmChannels, drcMap,
  selectedDeviceId, selectedDeviceIds, selectedWireId,
  onDeviceClick, onWireClick, vehicleId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport
  const [zoom, setZoom] = useState(0.6);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Pin data cache: model → pins
  const [pinCache, setPinCache] = useState<Map<string, PinData[]>>(new Map());
  const pendingModels = useRef<Set<string>>(new Set());

  // Loom tab filter
  const [activeLoom, setActiveLoom] = useState<string | null>(null);
  const looms = useMemo(() => {
    const zones = [...new Set(devices.map(d => d.location_zone).filter(Boolean))] as string[];
    return zones.sort();
  }, [devices]);

  // Device positions (grid-snapped formboard coordinates)
  const devicePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    // Group by zone for layout
    const byZone = new Map<string, ManifestDevice[]>();
    for (const d of devices) {
      const zone = d.location_zone || 'dash';
      const list = byZone.get(zone) || [];
      list.push(d);
      byZone.set(zone, list);
    }

    // Zone X regions on 200" board
    const zoneRegions: Record<string, { xStart: number; yStart: number }> = {
      engine_bay: { xStart: 10, yStart: 10 },
      firewall: { xStart: 45, yStart: 10 },
      dash: { xStart: 70, yStart: 10 },
      doors: { xStart: 110, yStart: 10 },
      rear: { xStart: 145, yStart: 10 },
      underbody: { xStart: 10, yStart: 55 },
    };

    byZone.forEach((devs, zone) => {
      const region = zoneRegions[zone] || { xStart: 100, yStart: 45 };
      const cols = Math.ceil(Math.sqrt(devs.length));
      devs.forEach((d, i) => {
        // Use saved positions if available, otherwise auto-layout
        if (d.pos_x_pct != null && d.pos_y_pct != null) {
          const x = Math.round((d.pos_x_pct / 100) * BOARD_W / GRID) * GRID;
          const y = Math.round((d.pos_y_pct / 100) * BOARD_H / GRID) * GRID;
          positions.set(d.id, { x, y });
        } else {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = Math.round((region.xStart + col * 4) / GRID) * GRID;
          const y = Math.round((region.yStart + row * 4) / GRID) * GRID;
          positions.set(d.id, { x, y });
        }
      });
    });
    return positions;
  }, [devices]);

  // Fetch pin data for a device model on demand
  const fetchPins = useCallback(async (model: string) => {
    if (pinCache.has(model) || pendingModels.current.has(model)) return;
    pendingModels.current.add(model);
    const { data } = await supabase
      .from('device_pin_maps')
      .select('pin_number, pin_function, default_wire_gauge_awg, default_wire_color, connected_to_device')
      .eq('device_model', model)
      .order('pin_number');
    if (data) {
      setPinCache(prev => {
        const next = new Map(prev);
        next.set(model, data as PinData[]);
        return next;
      });
    }
    pendingModels.current.delete(model);
  }, [pinCache]);

  // Load pins for all visible device models when zoom > 4
  useEffect(() => {
    if (zoom < 4) return;
    const models = [...new Set(devices.map(d => d.model_number).filter(Boolean))] as string[];
    for (const m of models) {
      if (!pinCache.has(m)) fetchPins(m);
    }
  }, [zoom, devices, pinCache, fetchPins]);

  // ── Drawing ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // ── Grid ──
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 0.5 / zoom;
    for (let x = 0; x <= CANVAS_W; x += PX_PER_INCH) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += PX_PER_INCH) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }

    // ── Ruler marks ──
    ctx.fillStyle = '#555577';
    ctx.font = `${7 / zoom}px Arial`;
    ctx.textAlign = 'center';
    for (let x = 0; x <= BOARD_W; x += 10) {
      ctx.fillText(`${x}"`, x * PX_PER_INCH, -3);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= BOARD_H; y += 10) {
      ctx.fillText(`${y}"`, -3, y * PX_PER_INCH + 3);
    }

    // ── Zone boundaries ──
    const zoneRegions: Record<string, { x: number; y: number; w: number; h: number }> = {
      engine_bay: { x: 5, y: 5, w: 35, h: 45 },
      firewall: { x: 42, y: 5, w: 25, h: 45 },
      dash: { x: 69, y: 5, w: 38, h: 45 },
      doors: { x: 109, y: 5, w: 33, h: 45 },
      rear: { x: 144, y: 5, w: 50, h: 45 },
      underbody: { x: 5, y: 52, w: 189, h: 40 },
    };
    for (const [zone, r] of Object.entries(zoneRegions)) {
      if (activeLoom && activeLoom !== zone) continue;
      const color = ZONE_COLORS[zone] || '#555577';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(r.x * PX_PER_INCH, r.y * PX_PER_INCH, r.w * PX_PER_INCH, r.h * PX_PER_INCH);
      ctx.setLineDash([]);
      // Zone label
      ctx.fillStyle = color;
      ctx.font = `bold ${9 / zoom}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(zone.replace(/_/g, ' ').toUpperCase(), (r.x + 0.5) * PX_PER_INCH, (r.y + 1.5) * PX_PER_INCH);
    }

    // ── Wire routing (quadratic bezier) ──
    const deviceByName = new Map<string, ManifestDevice>();
    for (const d of devices) deviceByName.set(d.device_name, d);

    for (const wire of wires) {
      if (activeLoom) {
        const toDevice = deviceByName.get(wire.to);
        if (toDevice && toDevice.location_zone !== activeLoom) continue;
      }

      const toDevice = deviceByName.get(wire.to);
      if (!toDevice) continue;
      const toPos = devicePositions.get(toDevice.id);
      if (!toPos) continue;

      // Source position (PDM or ECU — center-top of board for now)
      const fromX = wire.from.startsWith('PDM') ? 55 * PX_PER_INCH : 75 * PX_PER_INCH;
      const fromY = 2 * PX_PER_INCH;
      const toX = toPos.x * PX_PER_INCH;
      const toY = toPos.y * PX_PER_INCH;

      const isHighlighted = selectedWireId === wire.wireNumber;
      const isDimmed = selectedWireId != null && !isHighlighted;

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      const cpX = (fromX + toX) / 2;
      const cpY = Math.min(fromY, toY) - 30;
      ctx.quadraticCurveTo(cpX, cpY, toX, toY);

      if (isHighlighted) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00ddff';
        ctx.strokeStyle = '#00ddff';
        ctx.lineWidth = 3 / zoom;
      } else {
        ctx.shadowBlur = 0;
        const wireColor = wire.color.includes('RED') ? '#cc4444' :
          wire.color.includes('GRN') ? '#44aa44' :
          wire.color.includes('BLU') ? '#4488cc' :
          wire.color.includes('WHT') ? '#aaaaaa' :
          wire.color.includes('BLK') ? '#888888' :
          wire.color.includes('VIO') ? '#9966cc' :
          wire.color.includes('ORG') ? '#cc8833' :
          wire.color.includes('YEL') ? '#ccaa33' :
          wire.color.includes('TAN') ? '#aa8866' :
          wire.color.includes('PNK') ? '#cc6688' :
          '#777777';
        ctx.strokeStyle = wireColor;
        ctx.lineWidth = 1.5 / zoom;
        ctx.globalAlpha = isDimmed ? 0.15 : 0.6;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // ── Connector blocks ──
    const blockW = 3 * PX_PER_INCH;
    const blockH = 2 * PX_PER_INCH;

    for (const device of devices) {
      if (activeLoom && device.location_zone !== activeLoom) continue;
      const pos = devicePositions.get(device.id);
      if (!pos) continue;

      const px = pos.x * PX_PER_INCH;
      const py = pos.y * PX_PER_INCH;
      const isSelected = device.id === selectedDeviceId || selectedDeviceIds.has(device.id);
      const isDimmed = (selectedDeviceId != null || selectedDeviceIds.size > 0) && !isSelected;
      const isWireHighlighted = selectedWireId != null && wires.some(w => w.wireNumber === selectedWireId && w.to === device.device_name);

      ctx.globalAlpha = isDimmed && !isWireHighlighted ? 0.25 : 1;

      // Block background
      const zoneColor = ZONE_COLORS[device.location_zone || ''] || '#444466';
      ctx.fillStyle = '#252540';
      ctx.fillRect(px, py, blockW, blockH);

      // Block border
      if (isSelected) {
        ctx.strokeStyle = '#00ddff';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash(selectedDeviceIds.has(device.id) ? [4 / zoom, 2 / zoom] : []);
      } else if (isWireHighlighted) {
        ctx.strokeStyle = '#00ddff';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = zoneColor;
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([]);
      }
      ctx.strokeRect(px, py, blockW, blockH);
      ctx.setLineDash([]);

      // Device name
      ctx.fillStyle = '#e0e0e8';
      ctx.font = `bold ${7 / zoom}px Arial`;
      ctx.textAlign = 'left';
      const name = device.device_name.length > 18 ? device.device_name.slice(0, 17) + '...' : device.device_name;
      ctx.fillText(name.toUpperCase(), px + 3, py + 8 / zoom);

      // Connector type + pin count
      ctx.fillStyle = '#8888aa';
      ctx.font = `${6 / zoom}px "Courier New"`;
      ctx.fillText(
        `${device.connector_type || '—'} | ${device.pin_count || 0}p`,
        px + 3, py + blockH - 5 / zoom,
      );

      // DRC indicator dot (top-right)
      const drc = drcMap.get(device.id);
      if (drc) {
        const dotR = 3 / zoom;
        ctx.beginPath();
        ctx.arc(px + blockW - 5 / zoom, py + 5 / zoom, dotR, 0, Math.PI * 2);
        ctx.fillStyle = DRC_COLORS[drc.severity];
        ctx.fill();
      }

      // Pin count badge (zoom < 4) or pin table (zoom >= 4)
      if (zoom < 4) {
        // Small pin count badge
        if (device.pin_count) {
          ctx.fillStyle = '#333355';
          const badgeW = 20 / zoom;
          const badgeH = 10 / zoom;
          ctx.fillRect(px + blockW + 2, py, badgeW, badgeH);
          ctx.strokeStyle = '#555577';
          ctx.lineWidth = 0.5 / zoom;
          ctx.strokeRect(px + blockW + 2, py, badgeW, badgeH);
          ctx.fillStyle = '#8888aa';
          ctx.font = `bold ${7 / zoom}px "Courier New"`;
          ctx.textAlign = 'center';
          ctx.fillText(`${device.pin_count}p`, px + blockW + 2 + badgeW / 2, py + badgeH / 2 + 2.5 / zoom);
          ctx.textAlign = 'left';
        }
      } else {
        // Full pin table at zoom >= 4
        const pins = device.model_number ? pinCache.get(device.model_number) : undefined;
        if (pins && pins.length > 0) {
          const tableX = px + blockW + 4;
          const tableY = py;
          const rowH = 8 / zoom;
          const colWidths = [18, 50, 16, 22, 40]; // PIN FUNC AWG COLOR TO
          const tableW = colWidths.reduce((a, b) => a + b, 0) / zoom;
          const tableH = (pins.length + 1) * rowH;

          // Table background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(tableX, tableY, tableW, tableH);
          ctx.strokeStyle = isSelected ? '#00ddff' : '#000000';
          ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
          ctx.strokeRect(tableX, tableY, tableW, tableH);

          // Header row
          ctx.fillStyle = '#333333';
          ctx.font = `bold ${5.5 / zoom}px "Courier New"`;
          let cx = tableX + 2 / zoom;
          for (const [i, hdr] of ['PIN', 'FUNC', 'AWG', 'COLOR', 'TO'].entries()) {
            ctx.fillText(hdr, cx, tableY + rowH - 2 / zoom);
            cx += colWidths[i] / zoom;
          }

          // Data rows
          ctx.font = `${5 / zoom}px "Courier New"`;
          for (let r = 0; r < pins.length; r++) {
            const pin = pins[r];
            const ry = tableY + (r + 1) * rowH;
            // Alternating row background
            if (r % 2 === 1) {
              ctx.fillStyle = '#f8f8f8';
              ctx.fillRect(tableX, ry, tableW, rowH);
            }
            ctx.fillStyle = '#333333';
            cx = tableX + 2 / zoom;
            const fields = [
              pin.pin_number,
              (pin.pin_function || '—').slice(0, 12),
              pin.default_wire_gauge_awg != null ? String(pin.default_wire_gauge_awg) : '—',
              pin.default_wire_color || '—',
              (pin.connected_to_device || '—').slice(0, 10),
            ];
            for (let i = 0; i < fields.length; i++) {
              ctx.fillText(fields[i], cx, ry + rowH - 2 / zoom);
              cx += colWidths[i] / zoom;
            }
          }
        }
      }

      ctx.globalAlpha = 1;
    }

    // ── Net badge (when wire is selected) ──
    if (selectedWireId != null) {
      const wire = wires.find(w => w.wireNumber === selectedWireId);
      if (wire) {
        // Count wires in same net (same PDM channel group or signal type)
        const netWires = wires.filter(w =>
          (wire.pdmChannel && w.pdmChannel === wire.pdmChannel) ||
          (wire.signalType === 'can_bus' && w.signalType === 'can_bus')
        );
        const netLabel = wire.pdmChannel ? `PDM CH${wire.pdmChannel}` : wire.to;
        const badgeText = `NET: ${netLabel} — ${netWires.length > 1 ? netWires.length + ' WIRES' : '1 WIRE'}`;

        ctx.fillStyle = 'rgba(0, 221, 255, 0.9)';
        const bw = ctx.measureText(badgeText).width + 12 / zoom;
        ctx.fillRect(20, CANVAS_H - 30 / zoom, bw, 20 / zoom);
        ctx.fillStyle = '#1a1a2e';
        ctx.font = `bold ${8 / zoom}px Arial`;
        ctx.textAlign = 'left';
        ctx.fillText(badgeText, 20 + 6 / zoom, CANVAS_H - 30 / zoom + 14 / zoom);
      }
    }

    ctx.restore();
  }, [
    devices, wires, zoom, panX, panY, devicePositions, drcMap, pinCache,
    selectedDeviceId, selectedDeviceIds, selectedWireId, activeLoom,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw]);

  // ── Event Handlers ──
  const toBoard = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / zoom / PX_PER_INCH,
      y: (clientY - rect.top - panY) / zoom / PX_PER_INCH,
    };
  }, [panX, panY, zoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(z => Math.max(0.1, Math.min(20, z * factor)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or alt+click = pan
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    // Check if clicking on a device
    const pt = toBoard(e.clientX, e.clientY);
    for (const device of devices) {
      if (activeLoom && device.location_zone !== activeLoom) continue;
      const pos = devicePositions.get(device.id);
      if (!pos) continue;
      if (pt.x >= pos.x && pt.x <= pos.x + 3 && pt.y >= pos.y && pt.y <= pos.y + 2) {
        onDeviceClick(device.id, e);
        return;
      }
    }

    // Check if clicking on a wire (rough hit test)
    // For now, start panning if no hit
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }, [devices, devicePositions, panX, panY, toBoard, onDeviceClick, activeLoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanX(panStart.current.px + (e.clientX - panStart.current.x));
    setPanY(panStart.current.py + (e.clientY - panStart.current.y));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  // ── Print Handler ──
  const handlePrint = useCallback(() => {
    const printCanvas = document.createElement('canvas');
    const scale = 4; // High-res print
    printCanvas.width = CANVAS_W * scale;
    printCanvas.height = CANVAS_H * scale;
    const ctx = printCanvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.3;
    for (let x = 0; x <= CANVAS_W; x += PX_PER_INCH) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += PX_PER_INCH) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    // Grid coordinates: A-H rows, 1-17 columns
    const rowLabels = 'ABCDEFGH'.split('');
    const rowH = CANVAS_H / 8;
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    for (let i = 0; i < rowLabels.length; i++) {
      ctx.fillText(rowLabels[i], 8, i * rowH + rowH / 2 + 3);
      ctx.fillText(rowLabels[i], CANVAS_W - 8, i * rowH + rowH / 2 + 3);
    }
    for (let c = 1; c <= 17; c++) {
      const cx = (c / 18) * CANVAS_W;
      ctx.fillText(String(c), cx, 10);
      ctx.fillText(String(c), cx, CANVAS_H - 4);
    }

    // Zone labels
    const zoneRegionsPrint: Record<string, { x: number; y: number }> = {
      engine_bay: { x: 20, y: 20 },
      firewall: { x: 45, y: 20 },
      dash: { x: 70, y: 20 },
      doors: { x: 110, y: 20 },
      rear: { x: 145, y: 20 },
      underbody: { x: 20, y: 60 },
    };
    ctx.font = 'bold 12px Arial';
    for (const [zone, pos] of Object.entries(zoneRegionsPrint)) {
      ctx.fillStyle = ZONE_COLORS[zone] || '#333';
      ctx.textAlign = 'left';
      ctx.fillText(zone.replace(/_/g, ' ').toUpperCase(), pos.x * PX_PER_INCH, pos.y * PX_PER_INCH);
    }

    // Connector blocks (simplified for print)
    ctx.font = 'bold 6px Arial';
    for (const device of devices) {
      const pos = devicePositions.get(device.id);
      if (!pos) continue;
      const px = pos.x * PX_PER_INCH;
      const py = pos.y * PX_PER_INCH;
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(px, py, 30, 20);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, 30, 20);
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      const nm = device.device_name.length > 18 ? device.device_name.slice(0, 17) + '...' : device.device_name;
      ctx.fillText(nm.toUpperCase(), px + 2, py + 8);
      ctx.font = '5px "Courier New"';
      ctx.fillText(`${device.connector_type || ''} ${device.pin_count || 0}p`, px + 2, py + 16);
      ctx.font = 'bold 6px Arial';

      // Print pin tables adjacent to connectors
      const pins = device.model_number ? pinCache.get(device.model_number) : undefined;
      if (pins && pins.length > 0) {
        const tableX = px + 34;
        const tRowH = 6;
        ctx.font = '4.5px "Courier New"';
        ctx.fillStyle = '#ffffff';
        const tH = (pins.length + 1) * tRowH;
        ctx.fillRect(tableX, py, 110, tH);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tableX, py, 110, tH);

        ctx.fillStyle = '#333';
        ctx.font = 'bold 4.5px "Courier New"';
        ctx.fillText('PIN  FUNC          AWG  COLOR  TO', tableX + 2, py + tRowH - 1);
        ctx.font = '4px "Courier New"';
        for (let r = 0; r < Math.min(pins.length, 20); r++) {
          const pin = pins[r];
          const ry = py + (r + 1) * tRowH;
          if (r % 2 === 1) {
            ctx.fillStyle = '#f8f8f8';
            ctx.fillRect(tableX, ry, 110, tRowH);
          }
          ctx.fillStyle = '#333';
          const line = `${(pin.pin_number + '    ').slice(0, 5)}${((pin.pin_function || '—') + '              ').slice(0, 14)}${((pin.default_wire_gauge_awg ?? '—') + '   ').toString().slice(0, 4)}${((pin.default_wire_color || '—') + '      ').slice(0, 7)}${(pin.connected_to_device || '—').slice(0, 10)}`;
          ctx.fillText(line, tableX + 2, ry + tRowH - 1);
        }
        ctx.font = 'bold 6px Arial';
      }
    }

    // Wire color legend (bottom-left)
    const usedColors = [...new Set(wires.map(w => w.color))].sort();
    const legendX = 10;
    const legendY = CANVAS_H - 20 - usedColors.length * 10;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(legendX * PX_PER_INCH, legendY, 120, usedColors.length * 10 + 16);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX * PX_PER_INCH, legendY, 120, usedColors.length * 10 + 16);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 6px Arial';
    ctx.fillText('WIRE COLOR LEGEND', legendX * PX_PER_INCH + 4, legendY + 10);
    ctx.font = '5px "Courier New"';
    usedColors.forEach((color, i) => {
      const ly = legendY + 16 + i * 10;
      // Color swatch
      const swatchColor = color.includes('RED') ? '#cc4444' :
        color.includes('GRN') ? '#44aa44' :
        color.includes('BLU') ? '#4488cc' :
        color.includes('WHT') ? '#cccccc' :
        color.includes('BLK') ? '#333333' :
        color.includes('VIO') ? '#9966cc' :
        color.includes('ORG') ? '#cc8833' :
        '#777777';
      ctx.fillStyle = swatchColor;
      ctx.fillRect(legendX * PX_PER_INCH + 4, ly, 8, 6);
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(legendX * PX_PER_INCH + 4, ly, 8, 6);
      ctx.fillStyle = '#333';
      ctx.fillText(color, legendX * PX_PER_INCH + 16, ly + 5);
    });

    // Scale bar (bottom-center)
    const sbX = CANVAS_W / 2 - 30;
    const sbY = CANVAS_H - 20;
    ctx.fillStyle = '#333';
    ctx.font = 'bold 7px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCALE 1:1', sbX + 30, sbY - 4);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sbX, sbY);
    ctx.lineTo(sbX + 60, sbY);
    ctx.stroke();
    // 6" tick marks
    for (let i = 0; i <= 6; i++) {
      const tx = sbX + i * 10;
      ctx.beginPath();
      ctx.moveTo(tx, sbY - 3);
      ctx.lineTo(tx, sbY + 3);
      ctx.stroke();
      ctx.fillText(`${i}"`, tx, sbY + 10);
    }

    // Title block (bottom-right)
    const tbW = 200;
    const tbH = 60;
    const tbX = CANVAS_W - tbW - 10;
    const tbY = CANVAS_H - tbH - 10;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tbX, tbY, tbW, tbH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(tbX, tbY, tbW, tbH);
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    ctx.font = 'bold 8px Arial';
    ctx.fillText('NUKE VEHICLE PLATFORM', tbX + 6, tbY + 14);
    ctx.font = 'bold 7px Arial';
    ctx.fillText('1977 K5 BLAZER — WIRING FORMBOARD', tbX + 6, tbY + 26);
    ctx.font = '6px "Courier New"';
    ctx.fillText(`DWG: NUKE-K5-FB-001    REV: A`, tbX + 6, tbY + 38);
    ctx.fillText(`DATE: ${new Date().toISOString().split('T')[0]}    SCALE: 1:1`, tbX + 6, tbY + 48);

    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const imgData = printCanvas.toDataURL('image/png');
      printWindow.document.write(`
        <html><head><title>Formboard Print</title>
        <style>@media print { body { margin: 0; } img { width: 100%; } }</style>
        </head><body>
        <img src="${imgData}" style="width:100%;" />
        </body></html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    }
  }, [devices, wires, devicePositions, pinCache]);

  // Listen for Ctrl+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlePrint]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
        borderBottom: '2px solid #2a2a5e', background: '#1e1e32', flexShrink: 0,
      }}>
        {/* Loom tabs */}
        <button
          onClick={() => setActiveLoom(null)}
          style={{
            fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', textTransform: 'uppercase',
            letterSpacing: '0.5px', padding: '3px 8px', border: '2px solid #2a2a5e',
            background: activeLoom === null ? '#00ddff' : 'transparent',
            color: activeLoom === null ? '#1a1a2e' : '#8888aa', cursor: 'pointer',
          }}
        >ALL</button>
        {looms.map(zone => (
          <button
            key={zone}
            onClick={() => setActiveLoom(zone === activeLoom ? null : zone)}
            style={{
              fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', textTransform: 'uppercase',
              letterSpacing: '0.5px', padding: '3px 8px', border: `2px solid ${ZONE_COLORS[zone] || '#2a2a5e'}`,
              background: activeLoom === zone ? (ZONE_COLORS[zone] || '#2a2a5e') : 'transparent',
              color: activeLoom === zone ? '#ffffff' : (ZONE_COLORS[zone] || '#8888aa'), cursor: 'pointer',
            }}
          >{zone.replace(/_/g, ' ')}</button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700, color: '#8888aa' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => { setZoom(0.6); setPanX(0); setPanY(0); }}
            style={{
              fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', padding: '3px 8px',
              border: '2px solid #2a2a5e', background: 'transparent', color: '#8888aa', cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >RESET</button>
          <button
            onClick={handlePrint}
            style={{
              fontSize: '7px', fontWeight: 700, fontFamily: 'Arial', padding: '3px 8px',
              border: '2px solid #2a2a5e', background: 'transparent', color: '#8888aa', cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >PRINT</button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1, cursor: isPanning ? 'grabbing' : 'crosshair', display: 'block',
        }}
      />
    </div>
  );
}

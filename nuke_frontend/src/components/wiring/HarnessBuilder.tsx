// HarnessBuilder.tsx — Main orchestrator for the visual harness builder

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useHarnessState } from './useHarnessState';
import { HarnessCanvas } from './HarnessCanvas';
import { HarnessToolbar } from './HarnessToolbar';
import { HarnessSidebar } from './HarnessSidebar';
import { HarnessLoadSummary } from './HarnessLoadSummary';
import { HarnessSystemsPalette } from './HarnessSystemsPalette';
import { HarnessCompletenessPanel } from './HarnessCompletenessPanel';
import { selectWireGauge, suggestFuseRating } from './harnessCalculations';
import { suggestWireColor, estimateLength } from './harnessConstants';
import { NODE_WIDTH } from './HarnessCanvasNode';
import type { HarnessEndpoint, WiringConnection, ElectricalSystemCatalogItem } from './harnessTypes';

interface Props {
  designId: string;
  vehicleId: string;
  vehicleType: string | null;
}

export function HarnessBuilder({ designId, vehicleId, vehicleType }: Props) {
  const {
    state, setDesign, addNode, updateNode, removeNode, moveNode,
    addConnection, updateConnection, removeConnection,
    addSection, select, setMode, setDrawWire, setViewport,
  } = useHarnessState();

  const [isSaving, setIsSaving] = useState(false);
  const [addNodePrompt, setAddNodePrompt] = useState<{ x: number; y: number } | null>(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showCompleteness, setShowCompleteness] = useState(false);

  // Load design data
  useEffect(() => {
    async function load() {
      const [designRes, sectionsRes, endpointsRes, connectionsRes] = await Promise.all([
        supabase.from('harness_designs').select('*').eq('id', designId).single(),
        supabase.from('harness_sections').select('*').eq('design_id', designId).order('sort_order'),
        supabase.from('harness_endpoints').select('*').eq('design_id', designId),
        supabase.from('wiring_connections').select('*').eq('design_id', designId),
      ]);
      if (designRes.data) {
        setDesign(
          designRes.data,
          sectionsRes.data || [],
          endpointsRes.data || [],
          connectionsRes.data || [],
        );
      }
    }
    load();
  }, [designId, setDesign]);

  // Debounced save
  useEffect(() => {
    if (!state.isDirty || !state.design) return;
    const timer = setTimeout(async () => {
      setIsSaving(true);
      try {
        // Save canvas viewport
        await supabase.from('harness_designs').update({
          canvas_state: { viewport: state.viewport },
          total_endpoints: state.endpoints.length,
          total_connections: state.connections.length,
          updated_at: new Date().toISOString(),
        }).eq('id', designId);
      } finally {
        setIsSaving(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [state.isDirty, state.viewport, state.endpoints.length, state.connections.length, designId, state.design]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'v' || e.key === 'Escape') setMode('select');
      if (e.key === 'w') setMode('draw_wire');
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.id) {
        handleDelete();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.selection, setMode]);

  // Add endpoint to canvas + DB
  const handleAddEndpoint = useCallback(async (x: number, y: number, name: string) => {
    const id = crypto.randomUUID();
    const endpoint: HarnessEndpoint = {
      id,
      design_id: designId,
      section_id: null,
      name,
      endpoint_type: 'actuator',
      system_category: null,
      amperage_draw: null,
      peak_amperage: null,
      voltage: 12,
      wattage: null,
      is_switched: true,
      duty_cycle: null,
      connector_type: null,
      pin_count: null,
      estimated_length_ft: null,
      location_zone: null,
      canvas_x: x,
      canvas_y: y,
      catalog_part_id: null,
      part_number: null,
      is_required: true,
      is_ai_suggested: false,
      notes: null,
    };

    addNode(endpoint);
    select({ type: 'node', id });

    // Persist
    await supabase.from('harness_endpoints').insert(endpoint);
  }, [designId, addNode, select]);

  // Create connection between two endpoints
  const handleCreateConnection = useCallback(async (fromId: string, toId: string) => {
    const fromEp = state.endpoints.find(ep => ep.id === fromId);
    const toEp = state.endpoints.find(ep => ep.id === toId);
    if (!fromEp || !toEp || fromId === toId) return;

    // Auto-calculate
    const amps = toEp.amperage_draw || fromEp.amperage_draw || 0;
    const lengthFt = estimateLength(vehicleType, fromEp.location_zone, toEp.location_zone);
    const gaugeResult = amps > 0 ? selectWireGauge({ amperage: amps, lengthFt }) : null;
    const wireColor = suggestWireColor(fromEp.system_category, toEp.system_category, fromEp.endpoint_type, toEp.endpoint_type);
    const fuse = amps > 0 ? suggestFuseRating(amps) : null;

    const id = crypto.randomUUID();
    const connection: WiringConnection = {
      id,
      design_id: designId,
      section_id: fromEp.section_id || toEp.section_id,
      vehicle_id: vehicleId,
      build_id: null,
      connection_name: `${fromEp.name} → ${toEp.name}`,
      from_component: fromEp.name,
      to_component: toEp.name,
      from_endpoint_id: fromId,
      to_endpoint_id: toId,
      wire_gauge: gaugeResult?.gauge || null,
      wire_color: wireColor,
      connector_type: toEp.connector_type || fromEp.connector_type || null,
      status: 'planned',
      is_critical: false,
      amperage_load: amps || null,
      voltage_drop: gaugeResult?.actualVoltageDrop || null,
      calculated_gauge: gaugeResult?.gauge || null,
      length_ft: lengthFt,
      fuse_rating: fuse,
      circuit_number: null,
      is_shielded: false,
      is_twisted_pair: false,
      route_path: null,
      notes: null,
    };

    addConnection(connection);
    select({ type: 'edge', id });

    // Persist
    await supabase.from('wiring_connections').insert(connection);
  }, [state.endpoints, vehicleType, designId, vehicleId, addConnection, select]);

  // Port click handler — starts or completes a wire
  const handlePortClick = useCallback((endpointId: string, x: number, y: number) => {
    if (state.mode !== 'draw_wire' && state.mode !== 'select') return;

    if (!state.drawWire) {
      // Start drawing
      setDrawWire({ fromEndpointId: endpointId, fromX: x, fromY: y });
      if (state.mode === 'select') setMode('draw_wire');
    } else {
      // Complete drawing
      if (endpointId !== state.drawWire.fromEndpointId) {
        handleCreateConnection(state.drawWire.fromEndpointId, endpointId);
      }
      setDrawWire(null);
      setMode('select');
    }
  }, [state.mode, state.drawWire, setDrawWire, setMode, handleCreateConnection]);

  // Canvas click for add_node mode
  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (state.mode === 'add_node') {
      setAddNodePrompt({ x, y });
    }
  }, [state.mode]);

  // Delete selected
  const handleDelete = useCallback(async () => {
    if (!state.selection.id) return;
    if (state.selection.type === 'node') {
      // Also delete connections to this node from DB
      const relatedConns = state.connections.filter(
        c => c.from_endpoint_id === state.selection.id || c.to_endpoint_id === state.selection.id
      );
      for (const conn of relatedConns) {
        await supabase.from('wiring_connections').delete().eq('id', conn.id);
      }
      await supabase.from('harness_endpoints').delete().eq('id', state.selection.id);
      removeNode(state.selection.id);
    } else if (state.selection.type === 'edge') {
      await supabase.from('wiring_connections').delete().eq('id', state.selection.id);
      removeConnection(state.selection.id);
    }
  }, [state.selection, state.connections, removeNode, removeConnection]);

  // Move node + persist
  const handleMoveNode = useCallback(async (id: string, x: number, y: number) => {
    moveNode(id, x, y);
    // Debounced persist happens via canvas_state save
    // But also update the endpoint position in DB
    // Use a simple debounce by only saving on pointer up (handled in canvas)
  }, [moveNode]);

  // Node move complete — save to DB
  const handleMoveComplete = useCallback(async (id: string) => {
    const ep = state.endpoints.find(e => e.id === id);
    if (ep) {
      await supabase.from('harness_endpoints').update({ canvas_x: ep.canvas_x, canvas_y: ep.canvas_y }).eq('id', id);
    }
  }, [state.endpoints]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setViewport({ ...state.viewport, zoom: Math.min(5, state.viewport.zoom * 1.2) });
  }, [state.viewport, setViewport]);

  const handleZoomOut = useCallback(() => {
    setViewport({ ...state.viewport, zoom: Math.max(0.15, state.viewport.zoom / 1.2) });
  }, [state.viewport, setViewport]);

  const handleZoomFit = useCallback(() => {
    if (state.endpoints.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const xs = state.endpoints.map(ep => ep.canvas_x);
    const ys = state.endpoints.map(ep => ep.canvas_y);
    const minX = Math.min(...xs) - 40;
    const minY = Math.min(...ys) - 40;
    const maxX = Math.max(...xs) + NODE_WIDTH + 40;
    const maxY = Math.max(...ys) + 80 + 40;
    const width = maxX - minX;
    const height = maxY - minY;
    // Assume canvas is ~800x500
    const zoom = Math.min(800 / width, 500 / height, 2);
    setViewport({ x: -minX * zoom + 20, y: -minY * zoom + 20, zoom });
  }, [state.endpoints, setViewport]);

  // Update node in DB
  const handleUpdateNode = useCallback(async (id: string, changes: Partial<HarnessEndpoint>) => {
    updateNode(id, changes);
    await supabase.from('harness_endpoints').update(changes).eq('id', id);
  }, [updateNode]);

  // Update connection in DB
  const handleUpdateConnection = useCallback(async (id: string, changes: Partial<WiringConnection>) => {
    updateConnection(id, changes);
    await supabase.from('wiring_connections').update(changes).eq('id', id);
  }, [updateConnection]);

  // Add endpoint from catalog item (palette or completeness panel)
  const handleAddFromCatalog = useCallback(async (item: ElectricalSystemCatalogItem) => {
    // Place at a staggered position based on existing endpoint count
    const col = Math.floor(state.endpoints.length / 8);
    const row = state.endpoints.length % 8;
    const x = 40 + col * 200;
    const y = 40 + row * 90;

    const id = crypto.randomUUID();
    const endpoint: HarnessEndpoint = {
      id,
      design_id: designId,
      section_id: null,
      name: item.system_name,
      endpoint_type: (item.default_endpoint_type as HarnessEndpoint['endpoint_type']) || 'actuator',
      system_category: item.system_category,
      amperage_draw: item.typical_amperage || null,
      peak_amperage: null,
      voltage: 12,
      wattage: item.typical_amperage ? item.typical_amperage * 12 : null,
      is_switched: true,
      duty_cycle: null,
      connector_type: item.typical_connector || null,
      pin_count: null,
      estimated_length_ft: null,
      location_zone: null,
      canvas_x: x,
      canvas_y: y,
      catalog_part_id: item.id,
      part_number: null,
      is_required: item.is_required,
      is_ai_suggested: false,
      notes: null,
    };

    addNode(endpoint);
    select({ type: 'node', id });
    await supabase.from('harness_endpoints').insert(endpoint);
  }, [designId, state.endpoints.length, addNode, select]);

  // Add node prompt modal
  const handleAddNodeConfirm = useCallback(() => {
    if (addNodePrompt && newNodeName.trim()) {
      handleAddEndpoint(addNodePrompt.x, addNodePrompt.y, newNodeName.trim());
      setAddNodePrompt(null);
      setNewNodeName('');
      setMode('select');
    }
  }, [addNodePrompt, newNodeName, handleAddEndpoint, setMode]);

  if (!state.design) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading harness design...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 500 }}>
      {/* Toolbar */}
      <HarnessToolbar
        mode={state.mode}
        onModeChange={setMode}
        onAddEndpoint={() => setMode('add_node')}
        onDelete={handleDelete}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onToggleCompleteness={() => setShowCompleteness(v => !v)}
        showCompleteness={showCompleteness}
        selection={state.selection}
        endpointCount={state.endpoints.length}
        connectionCount={state.connections.length}
      />

      {/* Main area: palette + canvas + sidebar */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left systems palette */}
        <HarnessSystemsPalette
          designId={designId}
          vehicleType={vehicleType}
          existingEndpoints={state.endpoints}
          onAddFromCatalog={handleAddFromCatalog}
          collapsed={paletteCollapsed}
          onToggle={() => setPaletteCollapsed(v => !v)}
        />

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <HarnessCanvas
            state={state}
            onSelectNode={(id) => select({ type: 'node', id })}
            onSelectEdge={(id) => select({ type: 'edge', id })}
            onDeselect={() => select({ type: null, id: null })}
            onMoveNode={handleMoveNode}
            onPortClick={handlePortClick}
            onCanvasClick={handleCanvasClick}
            onViewportChange={setViewport}
          />

          {/* Add node prompt overlay */}
          {addNodePrompt && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              padding: '12px',
              zIndex: 10,
              minWidth: 240,
            }}>
              <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>
                NEW ENDPOINT
              </div>
              <input
                autoFocus
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddNodeConfirm(); if (e.key === 'Escape') { setAddNodePrompt(null); setMode('select'); } }}
                placeholder="e.g. Left Headlight, Starter Motor..."
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  fontSize: '11px',
                  fontFamily: 'Arial, sans-serif',
                  border: '2px solid var(--border)',
                  background: 'var(--bg)',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                <button className="button-win95" onClick={handleAddNodeConfirm} disabled={!newNodeName.trim()}>ADD</button>
                <button className="button-win95" onClick={() => { setAddNodePrompt(null); setMode('select'); }}>CANCEL</button>
              </div>
            </div>
          )}

          {/* Completeness panel overlay */}
          {showCompleteness && (
            <HarnessCompletenessPanel
              vehicleType={vehicleType}
              buildIntent="street"
              existingEndpoints={state.endpoints}
              onAddMissing={handleAddFromCatalog}
              onClose={() => setShowCompleteness(false)}
            />
          )}

          {/* Save indicator */}
          {isSaving && (
            <div style={{
              position: 'absolute', bottom: 8, right: 8,
              fontSize: '8px', color: 'var(--text-muted)', fontFamily: '"Courier New", monospace',
            }}>
              SAVING...
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <HarnessSidebar
          state={state}
          onUpdateNode={handleUpdateNode}
          onUpdateConnection={handleUpdateConnection}
          sections={state.sections}
          vehicleType={vehicleType}
        />
      </div>

      {/* Bottom load summary */}
      <HarnessLoadSummary
        endpoints={state.endpoints}
        connections={state.connections}
        sections={state.sections}
        vehicleType={vehicleType}
      />
    </div>
  );
}

// useComponentLibrary.ts — Fetch components, connectors, drawings from DB
// Replaces hardcoded DEVICE_TEMPLATES with real component_library data.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────

export interface ComponentPin {
  number: string;
  designation: string;
  full_name: string;
  function: string;
  direction: string;
  wire_gauge_awg?: number;
}

export interface ComponentConnector {
  id: string;
  component_id: string;
  connector_label: string;
  connector_type: string | null;
  component_side_pn: string | null;
  harness_side_pn: string | null;
  pin_count: number | null;
  keying: string | null;
  sealed: boolean | null;
  pins: ComponentPin[];
  face_view_drawing_id: string | null;
  notes: string | null;
}

export interface ComponentDrawing {
  id: string;
  component_id: string;
  document_id: string | null;
  drawing_type: string;
  view_angle: string | null;
  image_path: string | null;
  svg_path: string | null;
  storage_url: string | null;
  source_page: number | null;
  scale: string | null;
  dimensions_extracted: Record<string, unknown> | null;
  notes: string | null;
}

export interface LibraryComponent {
  id: string;
  manufacturer: string;
  part_number: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  dimensions_mm: Record<string, unknown> | null;
  electrical_spec: Record<string, unknown> | null;
  connector_summary: Record<string, unknown> | null;
  manufacturer_url: string | null;
  datasheet_url: string | null;
  price_usd: number | null;
  price_source: string | null;
  verified: boolean | null;
  notes: string | null;
  connectors: ComponentConnector[];
  drawings: ComponentDrawing[];
}

// ── Fetch ────────────────────────────────────────────────────────────

async function fetchComponentLibrary(): Promise<LibraryComponent[]> {
  const [compRes, connRes, drawRes] = await Promise.all([
    supabase
      .from('component_library')
      .select('id, manufacturer, part_number, name, category, subcategory, description, dimensions_mm, electrical_spec, connector_summary, manufacturer_url, datasheet_url, price_usd, price_source, verified, notes')
      .order('category')
      .order('name'),
    supabase
      .from('component_connectors')
      .select('id, component_id, connector_label, connector_type, component_side_pn, harness_side_pn, pin_count, keying, sealed, pins, face_view_drawing_id, notes'),
    supabase
      .from('component_drawings')
      .select('id, component_id, document_id, drawing_type, view_angle, image_path, svg_path, storage_url, source_page, scale, dimensions_extracted, notes'),
  ]);

  if (compRes.error) throw compRes.error;

  const connByComponent = new Map<string, ComponentConnector[]>();
  if (connRes.data) {
    for (const c of connRes.data) {
      const arr = connByComponent.get(c.component_id) || [];
      arr.push(c as ComponentConnector);
      connByComponent.set(c.component_id, arr);
    }
  }

  const drawByComponent = new Map<string, ComponentDrawing[]>();
  if (drawRes.data) {
    for (const d of drawRes.data) {
      const arr = drawByComponent.get(d.component_id) || [];
      arr.push(d as ComponentDrawing);
      drawByComponent.set(d.component_id, arr);
    }
  }

  return (compRes.data || []).map(comp => ({
    ...comp,
    connectors: connByComponent.get(comp.id) || [],
    drawings: drawByComponent.get(comp.id) || [],
  })) as LibraryComponent[];
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useComponentLibrary() {
  const query = useQuery({
    queryKey: ['component-library'],
    queryFn: fetchComponentLibrary,
    staleTime: 10 * 60 * 1000, // 10 min — component library rarely changes
  });

  // Group by category for quick-add palette
  const byCategory = new Map<string, LibraryComponent[]>();
  if (query.data) {
    for (const comp of query.data) {
      const cat = comp.category || 'other';
      const arr = byCategory.get(cat) || [];
      arr.push(comp);
      byCategory.set(cat, arr);
    }
  }

  // Lookup by ID
  const byId = new Map<string, LibraryComponent>();
  if (query.data) {
    for (const comp of query.data) byId.set(comp.id, comp);
  }

  // Get connector for a component by label (e.g. "A", "B")
  function getConnector(componentId: string, label: string): ComponentConnector | undefined {
    const comp = byId.get(componentId);
    return comp?.connectors.find(c => c.connector_label === label);
  }

  // Get all connectors for a component
  function getConnectors(componentId: string): ComponentConnector[] {
    return byId.get(componentId)?.connectors || [];
  }

  // Get dimensional drawing
  function getDrawing(componentId: string, type?: string): ComponentDrawing | undefined {
    const comp = byId.get(componentId);
    if (!comp) return undefined;
    if (type) return comp.drawings.find(d => d.drawing_type === type);
    return comp.drawings[0];
  }

  // Total pin count across all connectors
  function getTotalPins(componentId: string): number {
    return getConnectors(componentId).reduce((sum, c) => sum + (c.pin_count || c.pins.length), 0);
  }

  return {
    components: query.data || [],
    byCategory,
    byId,
    isLoading: query.isLoading,
    error: query.error,
    getConnector,
    getConnectors,
    getDrawing,
    getTotalPins,
  };
}

// harnessTypes.ts — TypeScript interfaces for the Wiring Harness Builder

export interface HarnessDesign {
  id: string;
  vehicle_id: string | null;
  build_id: string | null;
  user_id: string;
  name: string;
  description: string | null;
  vehicle_type: string | null;
  engine_type: string | null;
  ecu_platform: string | null;
  pdm_platform: string | null;
  template_id: string | null;
  canvas_state: CanvasState;
  total_endpoints: number;
  total_connections: number;
  total_amperage: number;
  recommended_alternator_amps: number | null;
  recommended_battery_ah: number | null;
  completeness_score: number;
  missing_systems: string[];
  status: 'draft' | 'in_progress' | 'review' | 'finalized' | 'ordered';
  created_at: string;
  updated_at: string;
}

export interface CanvasState {
  viewport: { x: number; y: number; zoom: number };
}

export interface HarnessSection {
  id: string;
  design_id: string;
  name: string;
  section_type: SectionType;
  color: string | null;
  sort_order: number;
  bounds_x: number | null;
  bounds_y: number | null;
  bounds_w: number | null;
  bounds_h: number | null;
  notes: string | null;
}

export type SectionType =
  | 'engine' | 'transmission' | 'chassis' | 'interior' | 'body'
  | 'lighting' | 'fuel' | 'cooling' | 'audio' | 'accessories' | 'custom';

export interface HarnessEndpoint {
  id: string;
  design_id: string;
  section_id: string | null;
  name: string;
  endpoint_type: EndpointType;
  system_category: string | null;
  amperage_draw: number | null;
  peak_amperage: number | null;
  voltage: number;
  wattage: number | null;
  is_switched: boolean;
  duty_cycle: number | null;
  connector_type: string | null;
  pin_count: number | null;
  estimated_length_ft: number | null;
  location_zone: string | null;
  canvas_x: number;
  canvas_y: number;
  catalog_part_id: string | null;
  part_number: string | null;
  is_required: boolean;
  is_ai_suggested: boolean;
  notes: string | null;
}

export type EndpointType =
  | 'power_source' | 'power_distribution' | 'ecu' | 'sensor' | 'actuator'
  | 'switch' | 'ground' | 'connector' | 'splice' | 'relay' | 'fuse'
  | 'display' | 'custom';

export interface WiringConnection {
  id: string;
  design_id: string | null;
  section_id: string | null;
  vehicle_id: string | null;
  build_id: string | null;
  connection_name: string;
  from_component: string;
  to_component: string;
  from_endpoint_id: string | null;
  to_endpoint_id: string | null;
  wire_gauge: string | null;
  wire_color: string | null;
  connector_type: string | null;
  status: string;
  is_critical: boolean;
  amperage_load: number | null;
  voltage_drop: number | null;
  calculated_gauge: string | null;
  length_ft: number | null;
  fuse_rating: number | null;
  circuit_number: number | null;
  is_shielded: boolean;
  is_twisted_pair: boolean;
  route_path: string | null;
  notes: string | null;
}

export interface HarnessTemplate {
  id: string;
  name: string;
  description: string | null;
  vehicle_type: string | null;
  engine_type: string | null;
  ecu_platform: string | null;
  template_data: TemplateData;
  source: string;
  source_reference: string | null;
  is_public: boolean;
}

export interface TemplateData {
  sections: TemplateSectionDef[];
  endpoints: TemplateEndpointDef[];
  estimated_labor_hours?: number;
  total_parts_cost?: number;
  total_labor_cost?: number;
}

export interface TemplateSectionDef {
  name: string;
  section_type: SectionType;
  color: string;
  sort_order: number;
}

export interface TemplateEndpointDef {
  name: string;
  endpoint_type: EndpointType;
  system_category: string;
  section: string; // matches section_type in TemplateSectionDef
  amperage_draw?: number;
  peak_amperage?: number;
  voltage?: number;
  connector_type?: string;
  pin_count?: number;
  location_zone?: string;
  part_number?: string;
}

export interface ElectricalSystemCatalogItem {
  id: string;
  system_name: string;
  system_category: string;
  is_required: boolean;
  is_required_for: string[];
  typical_amperage: number | null;
  typical_peak_amperage: number | null;
  typical_wire_gauge: string | null;
  typical_connector: string | null;
  default_wire_color: string | null;
  default_endpoint_type: string;
  default_location_zone: string | null;
  description: string | null;
  applies_to_vehicle_types: string[];
  sort_order: number;
}

export interface MotecPinMap {
  id: string;
  device: string;
  connector: string;
  pin_number: string;
  pin_function: string;
  signal_type: string | null;
  max_current: number | null;
  default_wire_color: string | null;
  notes: string | null;
}

// Canvas interaction state
export interface HarnessSelection {
  type: 'node' | 'edge' | null;
  id: string | null;
}

export type CanvasMode = 'select' | 'add_node' | 'draw_wire';

export interface DrawWireState {
  fromEndpointId: string;
  fromX: number;
  fromY: number;
}

// Calculation results
export interface LoadSummary {
  totalContinuousAmps: number;
  totalPeakAmps: number;
  perSection: { sectionId: string; name: string; amps: number }[];
  perCircuit: CircuitCalc[];
  alternatorSizing: { minimumAmps: number; recommended: string };
  batterySizing: { minimumAh: number; recommended: string };
  pdmChannels: { channel: number; assignment: string; amps: number }[];
  warnings: string[];
}

export interface CircuitCalc {
  connectionId: string;
  amps: number;
  gauge: string;
  voltageDrop: number;
  voltageDropPercent: number;
  lengthFt: number;
}

export interface GaugeResult {
  gauge: string;
  actualVoltageDrop: number;
  voltageDropPercent: number;
  recommendation: string;
}

// Reducer
export type HarnessAction =
  | { type: 'SET_DESIGN'; payload: { design: HarnessDesign; sections: HarnessSection[]; endpoints: HarnessEndpoint[]; connections: WiringConnection[] } }
  | { type: 'ADD_NODE'; payload: HarnessEndpoint }
  | { type: 'UPDATE_NODE'; payload: { id: string; changes: Partial<HarnessEndpoint> } }
  | { type: 'REMOVE_NODE'; payload: string }
  | { type: 'MOVE_NODE'; payload: { id: string; x: number; y: number } }
  | { type: 'ADD_CONNECTION'; payload: WiringConnection }
  | { type: 'UPDATE_CONNECTION'; payload: { id: string; changes: Partial<WiringConnection> } }
  | { type: 'REMOVE_CONNECTION'; payload: string }
  | { type: 'ADD_SECTION'; payload: HarnessSection }
  | { type: 'UPDATE_SECTION'; payload: { id: string; changes: Partial<HarnessSection> } }
  | { type: 'REMOVE_SECTION'; payload: string }
  | { type: 'SET_VIEWPORT'; payload: { x: number; y: number; zoom: number } }
  | { type: 'SELECT'; payload: HarnessSelection }
  | { type: 'SET_MODE'; payload: CanvasMode }
  | { type: 'SET_DRAW_WIRE'; payload: DrawWireState | null }
  | { type: 'UPDATE_DESIGN'; payload: Partial<HarnessDesign> };

export interface HarnessState {
  design: HarnessDesign | null;
  sections: HarnessSection[];
  endpoints: HarnessEndpoint[];
  connections: WiringConnection[];
  viewport: { x: number; y: number; zoom: number };
  selection: HarnessSelection;
  mode: CanvasMode;
  drawWire: DrawWireState | null;
  isDirty: boolean;
}

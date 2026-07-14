// connector-inspector/types.ts — the ONE data object behind every skin.
// Winamp model (Skylar's directive 2026-06-10): a ConnectorModel is built once
// from the derivation; FACE / TABLE / BUILD / PRINT are instantly-swappable
// presentations of it. Skins never fetch, never recompute.

import type { DerivedWire } from '../harnessDerivation';
import type { FunctionGroup } from '../ConnectorFaces';

export type ConnectorId = 'FIREWALL' | 'M130A' | 'M130B' | 'PDM30';
export type SkinId = 'face' | 'table' | 'build' | 'print';

export type CavityGroup = FunctionGroup | 'spare';

export interface InspectorCavity {
  key: string;              // unique within the connector ('w', 'A12', 'B07')
  label: string;            // engraved designator shown on the face
  x: number;                // face coordinates, model view units
  y: number;
  r: number;
  funcLabel?: string;       // PDM pin function (OUT5 / DIG2 / GND / CANHI)
  wires: DerivedWire[];     // empty = spare (seal plug / unused pin)
  group: CavityGroup;
  conflict?: boolean;       // gauge diverged from cut-list spec at derived length
  pdmState?: 'live' | 'freed' | 'spare';
}

// Shell / keyway decoration shapes — builder owns ALL geometry, FaceSkin renders.
export type Outline =
  | { kind: 'circle'; cx: number; cy: number; r: number; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; width: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number };

export interface ConnectorModel {
  id: ConnectorId;
  title: string;
  subTitle: string;
  viewW: number;
  viewH: number;
  cavities: InspectorCavity[];
  overflow: DerivedWire[];    // FIREWALL: crossing wires with no cavity (R6)
  directFeed: DerivedWire[];  // FIREWALL: crossing but not through the D38999 (R2)
  usedCount: number;
  totalCount: number;
  outlines: Outline[];
}

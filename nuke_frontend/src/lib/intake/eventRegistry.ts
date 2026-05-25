// src/lib/intake/eventRegistry.ts
//
// Frontend event-type registry for the intake first ship (F1).
// Canonical schemas live at docs/api/schemas/v1/<event_type>.json.
// Canonical checklist annotations live (today) at supabase/functions/mcp-connector/index.ts
// in EVENT_CHECKLISTS_INLINE (~line 3783).
//
// First ship scope: `note` is fully wired. The other four event types are
// stubbed at the type level so the form generator can be expanded later
// without touching its callers (paper §4: "One event type, one form, one
// route. Then expand.").
//
// Per the paper §F1, the long-term home is one JSON Schema file per event
// type with `x-checklist` extension keywords. For first ship we inline a
// static object that mirrors note.json exactly. When F1 fully consolidates,
// this module becomes a thin re-export of the JSON files.

export type EventType =
  | 'note'
  | 'service'
  | 'inspection'
  | 'modification'
  | 'condition_assessment';

export const EVENT_TYPES: EventType[] = [
  'note',
  'service',
  'inspection',
  'modification',
  'condition_assessment',
];

// ── Checklist annotation type (per paper §F1: x-checklist on each field) ─────

export interface ChecklistAnnotation {
  vision_fillable: boolean;
  context_fillable: boolean;
  tool_fillable: boolean;
  why_it_matters: string;
}

export type EventChecklist = Record<string, ChecklistAnnotation>;

// ── Minimal JSON Schema shape we consume ────────────────────────────────────

export interface EventSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  items?: EventSchemaProperty;
  uniqueItems?: boolean;
}

export interface EventSchema {
  $id?: string;
  title: string;
  description?: string;
  type: 'object';
  required?: string[];
  properties: Record<string, EventSchemaProperty>;
  additionalProperties?: boolean;
}

// ── note.json (mirrored from docs/api/schemas/v1/note.json) ──────────────────

const NOTE_SCHEMA: EventSchema = {
  $id: 'https://nuke.ag/api/schemas/v1/note.json',
  title: 'External Agent Write API — Note Event Payload (v1.0)',
  description:
    "Payload shape for envelope.event_type='note'. Routes to vehicle_observations with observation_kind='comment', source slug 'agent-submission'.",
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: {
      type: 'string',
      description:
        'Short headline (1–280 chars). Vision-fillable from a photo caption; context-fillable from chat scrollback.',
      minLength: 1,
      maxLength: 280,
    },
    narrative: {
      type: 'string',
      description: 'Optional longer body for the note.',
      maxLength: 32768,
    },
    observation_type: {
      type: 'string',
      description:
        'Optional classifier so consumers can filter notes by intent without reading prose.',
      enum: [
        'condition_finding',
        'modification_indicator',
        'ownership_clue',
        'provenance_record',
        'expert_opinion',
        'forum_summary',
        'media_caption',
      ],
    },
    confidence: {
      type: 'string',
      description: "Agent's self-rated confidence in the note's accuracy.",
      enum: ['verified', 'high', 'medium', 'low', 'inferred'],
    },
    zones_mentioned: {
      type: 'array',
      description: 'Subsystems the note refers to.',
      uniqueItems: true,
      items: {
        type: 'string',
        enum: [
          'engine_bay',
          'undercarriage',
          'interior',
          'wheels',
          'drivetrain',
          'cooling',
          'electrical',
          'fuel',
          'ignition',
          'suspension',
          'brakes',
          'body',
          'other',
        ],
      },
    },
    photos_referenced: {
      type: 'array',
      description:
        'Caller-side identifiers (URL or sha256) of photos this note references.',
      items: { type: 'string', maxLength: 1024 },
    },
  },
};

const NOTE_CHECKLIST: EventChecklist = {
  summary: {
    vision_fillable: true,
    context_fillable: true,
    tool_fillable: false,
    why_it_matters: 'Renders as the timeline card title.',
  },
  narrative: {
    vision_fillable: false,
    context_fillable: true,
    tool_fillable: false,
    why_it_matters: "Where the actual content lives when summary is just a label.",
  },
  observation_type: {
    vision_fillable: false,
    context_fillable: true,
    tool_fillable: false,
    why_it_matters:
      "Lets timeline filter 'show me ownership clues' or 'show me modification indicators' without reading every note.",
  },
  confidence: {
    vision_fillable: false,
    context_fillable: true,
    tool_fillable: false,
    why_it_matters:
      "Trust scoring relies on this. 'Inferred' notes get downweighted; 'verified' notes get upweighted.",
  },
  zones_mentioned: {
    vision_fillable: true,
    context_fillable: true,
    tool_fillable: false,
    why_it_matters:
      'Shared enum with service.zones_touched so timeline area filters work across event types.',
  },
  photos_referenced: {
    vision_fillable: false,
    context_fillable: true,
    tool_fillable: true,
    why_it_matters: 'Anchors the note to evidence.',
  },
};

// ── Routing (mirrors api-v1-events EVENT_TYPE_MAP) ──────────────────────────

export interface EventRouting {
  observation_kind: string;
  source_slug: string;
}

const EVENT_ROUTING: Record<EventType, EventRouting> = {
  note: { observation_kind: 'comment', source_slug: 'agent-submission' },
  service: { observation_kind: 'work_record', source_slug: 'shop' },
  inspection: { observation_kind: 'condition', source_slug: 'agent-submission' },
  modification: { observation_kind: 'work_record', source_slug: 'agent-submission' },
  condition_assessment: { observation_kind: 'condition', source_slug: 'agent-submission' },
};

// ── Public API ───────────────────────────────────────────────────────────────

export function getEventSchema(eventType: EventType): EventSchema {
  switch (eventType) {
    case 'note':
      return NOTE_SCHEMA;
    case 'service':
    case 'inspection':
    case 'modification':
    case 'condition_assessment':
      throw new Error(
        `Event type '${eventType}' is registered but its schema is not yet bundled in the frontend (first ship is note-only). See docs/api/schemas/v1/${eventType}.json.`
      );
  }
}

export function getEventChecklist(eventType: EventType): EventChecklist {
  switch (eventType) {
    case 'note':
      return NOTE_CHECKLIST;
    case 'service':
    case 'inspection':
    case 'modification':
    case 'condition_assessment':
      throw new Error(
        `Event type '${eventType}' checklist not yet bundled in the frontend (first ship is note-only).`
      );
  }
}

export function getEventRouting(eventType: EventType): EventRouting {
  return EVENT_ROUTING[eventType];
}

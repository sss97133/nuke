// k5KnowledgeIndex.ts — Query the K5 documentation knowledge base.
//
// 399 documents across 14 source directories, indexed by topic, year,
// section, and doc type. When the agent (or the UI) needs to know
// "what does the GM service manual say about the engine bay wiring on
// a 1977 K5", call findDocs({ topic: 'engine_bay', maxYearDelta: 8 }).
//
// Source: `nuke_frontend/public/data/k5-knowledge-index.json`
// Rebuild: `python3 scripts/build-k5-knowledge-index.py`

export type Document = {
  id: string;
  path: string;
  rel_path: string;
  title: string;
  filename: string;
  ext: string;
  doc_type: 'manual_diagram' | 'datasheet' | 'chapter_md' | 'design_md' | 'render_image' | 'marketing_render' | 'reference_doc';
  year: number;
  vehicle_applicability: string[];
  topics: string[];
  section: string;
  source: string;
  /** 1 = manufacturer, 2 = curated, 3 = marketing/hobbyist */
  trust_tier: 1 | 2 | 3;
  size_kb: number;
};

export type KnowledgeIndex = {
  generated_at: string;
  total_documents: number;
  vehicle: {
    id: string;
    vin: string;
    year: number;
    make: string;
    model: string;
    platform: string;
  };
  documents: Document[];
  indexes: {
    by_topic: Record<string, string[]>;
    by_section: Record<string, string[]>;
    by_year: Record<string, string[]>;
    by_doc_type: Record<string, string[]>;
  };
};

let _index: KnowledgeIndex | null = null;
let _loadPromise: Promise<KnowledgeIndex | null> | null = null;

/** Load the index once. Subsequent calls return the cached value. */
export async function loadKnowledgeIndex(): Promise<KnowledgeIndex | null> {
  if (_index) return _index;
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch('/data/k5-knowledge-index.json')
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      _index = j;
      return j;
    })
    .catch(() => null);
  return _loadPromise;
}

export type FindOptions = {
  /** Filter by topic (e.g. 'engine_bay', 'frame', 'lighting_front') */
  topic?: string;
  /** Filter by GM service manual section (e.g. '8C', '6D', '2A') */
  section?: string;
  /** Filter by document type */
  docType?: Document['doc_type'];
  /** Only return docs within N years of K5 reference year (1977) */
  maxYearDelta?: number;
  /** Only return docs at or above this trust tier */
  minTrustTier?: 1 | 2 | 3;
  /** Limit results */
  limit?: number;
};

const K5_YEAR = 1977;

/** Find documents matching all provided filters, sorted by:
 *   1. Trust tier (T1 first)
 *   2. Year proximity to 1977
 *   3. Title alphabetical
 */
export function findDocs(opts: FindOptions = {}): Document[] {
  if (!_index) return [];

  let candidates = _index.documents;

  if (opts.topic) {
    const ids = new Set(_index.indexes.by_topic[opts.topic] || []);
    candidates = candidates.filter(d => ids.has(d.id));
  }
  if (opts.section) {
    const ids = new Set(_index.indexes.by_section[opts.section] || []);
    candidates = candidates.filter(d => ids.has(d.id));
  }
  if (opts.docType) {
    candidates = candidates.filter(d => d.doc_type === opts.docType);
  }
  if (opts.maxYearDelta !== undefined) {
    candidates = candidates.filter(d => d.year === 0 || Math.abs(d.year - K5_YEAR) <= opts.maxYearDelta!);
  }
  if (opts.minTrustTier) {
    candidates = candidates.filter(d => d.trust_tier <= opts.minTrustTier!);  // tier 1 is best
  }

  // Sort: trust tier asc (T1 first) → year proximity asc → title
  candidates = candidates.slice().sort((a, b) => {
    if (a.trust_tier !== b.trust_tier) return a.trust_tier - b.trust_tier;
    const da = a.year === 0 ? 0 : Math.abs(a.year - K5_YEAR);
    const db = b.year === 0 ? 0 : Math.abs(b.year - K5_YEAR);
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });

  if (opts.limit) candidates = candidates.slice(0, opts.limit);
  return candidates;
}

/** Get a single document by ID. */
export function getDoc(id: string): Document | undefined {
  return _index?.documents.find(d => d.id === id);
}

/** List all known topics (with their doc counts). */
export function listTopics(): Array<{ topic: string; count: number }> {
  if (!_index) return [];
  return Object.entries(_index.indexes.by_topic)
    .map(([topic, ids]) => ({ topic, count: ids.length }))
    .sort((a, b) => b.count - a.count);
}

/** Get all sources that say something about a particular Blender object,
 *  by mapping the object to one or more topics. */
export function findDocsForBlenderObject(objectName: string): Document[] {
  // Map object names to relevant topics
  const lower = objectName.toLowerCase();
  const topics: string[] = [];
  if (lower.includes('frame') || lower.includes('under_frame')) topics.push('frame');
  if (lower.includes('engine') || lower.includes('under_engine')) topics.push('engine_bay');
  if (lower.includes('exterior_body')) topics.push('body');
  if (lower.includes('dash')) topics.push('instrument_cluster');
  if (lower.includes('door')) topics.push('door');
  if (lower.includes('wheel')) topics.push('frame');
  if (lower.includes('headlight') || lower.includes('parking') || lower.includes('turn')) topics.push('lighting_front');
  if (lower.includes('tail') || lower.includes('marker_rear') || lower.includes('backup') || lower.includes('license') || lower.includes('brake_light')) topics.push('lighting_rear');
  if (lower.includes('marker')) topics.push('lighting_marker');
  if (lower.includes('interior')) topics.push('lighting_interior');
  if (lower.includes('steering') || lower.includes('turn')) topics.push('steering');
  if (lower.includes('emblem')) topics.push('photo_marketing');

  if (topics.length === 0) return [];
  const results: Document[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    for (const d of findDocs({ topic: t, minTrustTier: 2, limit: 5 })) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(d);
      }
    }
  }
  return results;
}

/**
 * SCHEMA DISCOVERY: Receipt Field Enumeration (Ollama Local)
 *
 * Runs locally with Ollama vision models - no timeouts, no API costs.
 *
 * Usage:
 *   npx tsx scripts/discover-receipt-fields-ollama.ts
 *   npx tsx scripts/discover-receipt-fields-ollama.ts --vehicle e08bf694-970f-4cbe-8a74-8715158a0f2e
 *   npx tsx scripts/discover-receipt-fields-ollama.ts --sample 50
 *
 * Outputs: docs/schema-discovery/receipts-YYYY-MM-DD.md
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llava'; // or 'bakllava', 'llava:13b'

interface DiscoveredField {
  field_name: string;
  description: string;
  data_type: string;
  sample_value: string;
}

const DISCOVERY_PROMPT = `You are analyzing a receipt/invoice image to discover what fields exist.

List EVERY distinct piece of information visible. For each field:
- field_name: snake_case name
- description: what it contains
- data_type: string, number, date, currency, array, boolean
- sample_value: one example from the image

Be EXHAUSTIVE. Include header, footer, fine print, reference numbers, everything.

Respond with ONLY a JSON array, no other text:
[
  {"field_name": "vendor_name", "description": "Business name", "data_type": "string", "sample_value": "AutoZone"},
  {"field_name": "date", "description": "Transaction date", "data_type": "date", "sample_value": "2021-04-15"}
]`;

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch (e) {
    console.error(`Failed to fetch ${url}:`, e);
    return null;
  }
}

async function discoverFieldsWithOllama(imageBase64: string): Promise<DiscoveredField[] | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: DISCOVERY_PROMPT,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 2000
        }
      })
    });

    if (!response.ok) {
      console.error('Ollama error:', response.status);
      return null;
    }

    const result = await response.json();
    const text = result.response || '';

    // Extract JSON array
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }

    console.error('No JSON found in response:', text.substring(0, 200));
    return null;
  } catch (e) {
    console.error('Ollama request failed:', e);
    return null;
  }
}

function aggregateFields(allFields: DiscoveredField[][], docCount: number): Map<string, any> {
  const fieldMap = new Map<string, {
    field_name: string;
    descriptions: Set<string>;
    data_types: Set<string>;
    sample_values: Set<string>;
    count: number;
  }>();

  for (const docFields of allFields) {
    const seenInDoc = new Set<string>();

    for (const field of docFields) {
      const key = field.field_name.toLowerCase().replace(/\s+/g, '_');

      if (!seenInDoc.has(key)) {
        seenInDoc.add(key);

        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            field_name: field.field_name,
            descriptions: new Set(),
            data_types: new Set(),
            sample_values: new Set(),
            count: 0
          });
        }

        const entry = fieldMap.get(key)!;
        entry.count++;
        if (field.description) entry.descriptions.add(field.description);
        if (field.data_type) entry.data_types.add(field.data_type);
        if (field.sample_value) entry.sample_values.add(String(field.sample_value));
      }
    }
  }

  const result = new Map<string, any>();
  for (const [key, entry] of fieldMap) {
    result.set(key, {
      field_name: entry.field_name,
      description: Array.from(entry.descriptions)[0] || '',
      data_type: Array.from(entry.data_types).join(' | '),
      sample_values: Array.from(entry.sample_values).slice(0, 5),
      frequency: entry.count,
      frequency_pct: Math.round((entry.count / docCount) * 100)
    });
  }

  return result;
}

function generateMarkdown(fields: Map<string, any>, docType: string, processed: number, total: number): string {
  const sorted = Array.from(fields.values()).sort((a, b) => b.frequency_pct - a.frequency_pct);

  let md = `# Schema Discovery: ${docType}\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Model:** ${OLLAMA_MODEL}\n`;
  md += `**Processed:** ${processed} of ${total} documents\n`;
  md += `**Fields Discovered:** ${sorted.length}\n\n`;
  md += `---\n\n`;

  md += `## Field Catalog\n\n`;
  md += `| Field | Type | Frequency | Description |\n`;
  md += `|-------|------|-----------|-------------|\n`;
  for (const field of sorted) {
    md += `| \`${field.field_name}\` | ${field.data_type} | ${field.frequency_pct}% | ${field.description} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Recommended Schema Additions\n\n`;

  md += `### Required (90%+ frequency)\n\`\`\`sql\n`;
  for (const f of sorted.filter(f => f.frequency_pct >= 90)) {
    const sqlType = f.data_type.includes('date') ? 'DATE' :
                    f.data_type.includes('number') || f.data_type.includes('currency') ? 'NUMERIC' :
                    f.data_type.includes('boolean') ? 'BOOLEAN' : 'TEXT';
    md += `${f.field_name} ${sqlType},\n`;
  }
  md += `\`\`\`\n\n`;

  md += `### Optional (50-89%)\n\`\`\`sql\n`;
  for (const f of sorted.filter(f => f.frequency_pct >= 50 && f.frequency_pct < 90)) {
    const sqlType = f.data_type.includes('date') ? 'DATE' :
                    f.data_type.includes('number') || f.data_type.includes('currency') ? 'NUMERIC' : 'TEXT';
    md += `${f.field_name} ${sqlType},\n`;
  }
  md += `\`\`\`\n\n`;

  md += `### Metadata (10-49%) - store in JSONB\n`;
  for (const f of sorted.filter(f => f.frequency_pct >= 10 && f.frequency_pct < 50)) {
    md += `- \`${f.field_name}\`: ${f.description}\n`;
  }

  md += `\n---\n\n## Sample Values\n\n`;
  for (const f of sorted.slice(0, 20)) {
    if (f.sample_values.length > 0) {
      md += `**${f.field_name}:** ${f.sample_values.slice(0, 3).map((v: string) => `\`${v}\``).join(', ')}\n`;
    }
  }

  return md;
}

async function main() {
  const args = process.argv.slice(2);
  let vehicleId: string | null = null;
  let sampleSize = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vehicle' && args[i + 1]) vehicleId = args[++i];
    if (args[i] === '--sample' && args[i + 1]) sampleSize = parseInt(args[++i]);
  }

  console.log(`\n🔍 Schema Discovery: Receipts`);
  console.log(`   Model: ${OLLAMA_MODEL}`);
  console.log(`   Sample size: ${sampleSize}`);
  if (vehicleId) console.log(`   Vehicle: ${vehicleId}`);
  console.log('');

  // Check Ollama is running
  try {
    const health = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!health.ok) throw new Error('Ollama not responding');
    console.log('✅ Ollama connected\n');
  } catch (e) {
    console.error('❌ Cannot connect to Ollama at', OLLAMA_URL);
    console.error('   Make sure Ollama is running: ollama serve');
    process.exit(1);
  }

  // Fetch documents
  let query = supabase
    .from('vehicle_documents')
    .select('id, file_url')
    .eq('document_type', 'receipt')
    .not('file_url', 'is', null)
    .limit(sampleSize);

  if (vehicleId) query = query.eq('vehicle_id', vehicleId);

  const { data: docs, error } = await query;
  if (error || !docs?.length) {
    console.error('No documents found');
    process.exit(1);
  }

  console.log(`📄 Found ${docs.length} receipts to analyze\n`);

  const allDiscoveredFields: DiscoveredField[][] = [];
  let processed = 0;

  for (const doc of docs) {
    process.stdout.write(`[${++processed}/${docs.length}] Analyzing ${doc.id.substring(0, 8)}...`);

    const imageBase64 = await fetchImageAsBase64(doc.file_url);
    if (!imageBase64) {
      console.log(' ❌ fetch failed');
      continue;
    }

    const fields = await discoverFieldsWithOllama(imageBase64);
    if (fields && fields.length > 0) {
      allDiscoveredFields.push(fields);
      console.log(` ✅ ${fields.length} fields`);
    } else {
      console.log(' ❌ parse failed');
    }
  }

  if (allDiscoveredFields.length === 0) {
    console.error('\n❌ No documents could be processed');
    process.exit(1);
  }

  // Aggregate and generate report
  const aggregated = aggregateFields(allDiscoveredFields, allDiscoveredFields.length);
  const markdown = generateMarkdown(aggregated, 'receipt', allDiscoveredFields.length, docs.length);

  // Save report
  const outputDir = path.join(process.cwd(), 'docs', 'schema-discovery');
  fs.mkdirSync(outputDir, { recursive: true });

  const dateStr = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `receipts-${dateStr}.md`);
  fs.writeFileSync(outputPath, markdown);

  console.log(`\n✅ Discovery complete!`);
  console.log(`   Processed: ${allDiscoveredFields.length}/${docs.length} documents`);
  console.log(`   Fields found: ${aggregated.size}`);
  console.log(`   Report: ${outputPath}\n`);
}

main().catch(console.error);

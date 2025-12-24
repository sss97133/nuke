#!/usr/bin/env tsx
/**
 * Tool Discovery Script
 * 
 * Scans the codebase for tools (Edge Functions, scripts, services)
 * and populates the tool_registry database table.
 * 
 * Usage:
 *   tsx scripts/discover-tools.ts
 *   tsx scripts/discover-tools.ts --update-existing
 */

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { parse } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(process.cwd(), '.env.local') });
dotenv.config({ path: join(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ToolMetadata {
  tool_name: string;
  tool_type: 'edge_function' | 'script' | 'service' | 'database_function';
  category: string;
  file_path: string;
  entry_point?: string;
  purpose: string;
  capabilities: string[];
  supported_sources: string[];
  input_format?: any;
  output_format?: any;
  usage_example?: string;
  api_endpoint?: string;
  required_secrets: string[];
  depends_on: string[];
}

// Extract metadata from Edge Function
async function discoverEdgeFunction(functionPath: string): Promise<ToolMetadata | null> {
  const functionName = parse(functionPath).name;
  const fullPath = join(process.cwd(), 'supabase/functions', functionName, 'index.ts');
  
  try {
    const content = await readFile(fullPath, 'utf-8');
    
    // Extract purpose from comments
    const purposeMatch = content.match(/\/\*\*[\s\S]*?\*\//) || 
                        content.match(/\/\/\s*Purpose:?\s*(.+)/i) ||
                        content.match(/\/\/\s*(.+)/);
    const purpose = purposeMatch?.[1]?.trim() || `Edge function: ${functionName}`;
    
    // Extract capabilities from code patterns
    const capabilities: string[] = [];
    if (content.includes('scrape') || content.includes('extract')) capabilities.push('extract_data');
    if (content.includes('vehicle')) capabilities.push('handle_vehicles');
    if (content.includes('image')) capabilities.push('handle_images');
    if (content.includes('import_queue') || content.includes('import-queue')) capabilities.push('process_queue');
    if (content.includes('organization') || content.includes('business')) capabilities.push('handle_organizations');
    if (content.includes('duplicate') || content.includes('dedupe')) capabilities.push('handle_duplicates');
    if (content.includes('VIN') || content.includes('vin')) capabilities.push('handle_vins');
    if (content.includes('Firecrawl') || content.includes('FIRECRAWL')) capabilities.push('use_firecrawl');
    if (content.includes('OpenAI') || content.includes('OPENAI') || content.includes('gpt')) capabilities.push('use_ai');
    
    // Extract supported sources from code
    const supported_sources: string[] = [];
    const sourcePatterns = [
      /craigslist\.org/gi,
      /bringatrailer\.com/gi,
      /sbxcars\.com/gi,
      /ksl\.com/gi,
      /dupontregistry\.com/gi,
      /classic\.com/gi,
      /facebook\.com/gi,
      /instagram\.com/gi,
    ];
    sourcePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        const domain = matches[0].toLowerCase();
        if (!supported_sources.includes(domain)) {
          supported_sources.push(domain);
        }
      }
    });
    
    // Extract required secrets
    const required_secrets: string[] = [];
    if (content.includes('FIRECRAWL_API_KEY')) required_secrets.push('FIRECRAWL_API_KEY');
    if (content.includes('OPENAI_API_KEY')) required_secrets.push('OPENAI_API_KEY');
    if (content.includes('ANTHROPIC_API_KEY')) required_secrets.push('ANTHROPIC_API_KEY');
    if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) required_secrets.push('SUPABASE_SERVICE_ROLE_KEY');
    
    // Extract dependencies (function invocations)
    const depends_on: string[] = [];
    const invokePattern = /\.functions\.invoke\(['"]([^'"]+)['"]/g;
    let match;
    while ((match = invokePattern.exec(content)) !== null) {
      if (!depends_on.includes(match[1])) {
        depends_on.push(match[1]);
      }
    }
    
    // Determine category
    let category = 'processing';
    if (functionName.includes('scrape') || functionName.includes('extract')) category = 'scraping';
    if (functionName.includes('process') || functionName.includes('queue')) category = 'processing';
    if (functionName.includes('analyze') || functionName.includes('ai-')) category = 'analysis';
    if (functionName.includes('import') || functionName.includes('ingest')) category = 'ingestion';
    if (functionName.includes('backfill')) category = 'backfill';
    if (functionName.includes('discover')) category = 'discovery';
    
    return {
      tool_name: functionName,
      tool_type: 'edge_function',
      category,
      file_path: `supabase/functions/${functionName}/index.ts`,
      entry_point: 'serve',
      purpose: purpose.substring(0, 500), // Limit length
      capabilities,
      supported_sources,
      required_secrets,
      depends_on,
      api_endpoint: `/functions/v1/${functionName}`,
    };
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️  Error reading ${fullPath}: ${error.message}`);
    }
    return null;
  }
}

// Main discovery function
async function discoverAllTools() {
  console.log('🔍 Discovering tools...\n');
  
  const tools: ToolMetadata[] = [];
  
  // Discover Edge Functions
  try {
    const functionsDir = join(process.cwd(), 'supabase/functions');
    const entries = await readdir(functionsDir, { withFileTypes: true });
    
    const functionDirs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
      .map(entry => entry.name);
    
    console.log(`📦 Found ${functionDirs.length} Edge Functions`);
    
    for (const funcName of functionDirs) {
      const metadata = await discoverEdgeFunction(funcName);
      if (metadata) {
        tools.push(metadata);
        console.log(`  ✅ ${funcName}`);
      }
    }
  } catch (error: any) {
    console.error(`❌ Error discovering Edge Functions: ${error.message}`);
  }
  
  console.log(`\n📊 Discovered ${tools.length} tools\n`);
  
  // Upsert to database
  console.log('💾 Saving to database...\n');
  
  for (const tool of tools) {
    try {
      // Upsert tool
      const { error: toolError } = await supabase
        .from('tool_registry')
        .upsert({
          tool_name: tool.tool_name,
          tool_type: tool.tool_type,
          category: tool.category,
          file_path: tool.file_path,
          entry_point: tool.entry_point,
          purpose: tool.purpose,
          capabilities: tool.capabilities,
          supported_sources: tool.supported_sources,
          input_format: tool.input_format || {},
          output_format: tool.output_format || {},
          usage_example: tool.usage_example,
          api_endpoint: tool.api_endpoint,
          required_secrets: tool.required_secrets,
          depends_on: tool.depends_on,
          last_updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tool_name',
        });
      
      if (toolError) {
        console.error(`  ❌ Error saving ${tool.tool_name}: ${toolError.message}`);
        continue;
      }
      
      // Upsert capabilities
      if (tool.capabilities.length > 0) {
        // Get tool ID
        const { data: toolData } = await supabase
          .from('tool_registry')
          .select('id')
          .eq('tool_name', tool.tool_name)
          .single();
        
        if (toolData?.id) {
          const toolId = toolData.id;
          
          // Delete existing capabilities for this tool
          await supabase
            .from('tool_capabilities')
            .delete()
            .eq('tool_id', toolId);
          
          // Insert new capabilities
          const capabilityRecords = tool.capabilities.map(cap => ({
            capability: cap,
            tool_id: toolId,
            confidence: 100,
          }));
          
          await supabase
            .from('tool_capabilities')
            .insert(capabilityRecords);
        }
      }
      
      console.log(`  ✅ Saved ${tool.tool_name}`);
    } catch (error: any) {
      console.error(`  ❌ Error processing ${tool.tool_name}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Discovery complete! Registered ${tools.length} tools`);
  
  // Print summary
  const categories = new Map<string, number>();
  tools.forEach(tool => {
    categories.set(tool.category, (categories.get(tool.category) || 0) + 1);
  });
  
  console.log('\n📊 Summary by category:');
  Array.from(categories.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
}

// Run discovery
discoverAllTools().catch(console.error);


/**
 * Tool Discovery Service
 * 
 * Helper functions for querying the tool registry
 * to discover existing tools before building new ones.
 */

import { supabase } from './supabase';

export interface Tool {
  id: string;
  tool_name: string;
  tool_type: 'edge_function' | 'script' | 'service' | 'database_function';
  category: string;
  file_path: string;
  purpose: string;
  capabilities: string[];
  supported_sources: string[];
  api_endpoint?: string;
  required_secrets: string[];
  depends_on: string[];
  is_active: boolean;
  is_deprecated: boolean;
}

/**
 * Find tools by capability
 * 
 * Example: findToolsFor('extract_vehicle_data')
 */
export async function findToolsFor(capability: string): Promise<Tool[]> {
  const { data, error } = await supabase
    .rpc('find_tools_by_capability', {
      p_capability: capability,
    });

  if (error) {
    console.error('Error finding tools by capability:', error);
    return [];
  }

  return data || [];
}

/**
 * Find tools by source/domain
 * 
 * Example: findToolsForSource('craigslist.org')
 */
export async function findToolsForSource(source: string): Promise<Tool[]> {
  const { data, error } = await supabase
    .rpc('find_tools_by_source', {
      p_source: source,
    });

  if (error) {
    console.error('Error finding tools by source:', error);
    return [];
  }

  return data || [];
}

/**
 * Find tools by category
 * 
 * Example: findToolsByCategory('scraping')
 */
export async function findToolsByCategory(category: string): Promise<Tool[]> {
  const { data, error } = await supabase
    .rpc('find_tools_by_category', {
      p_category: category,
    });

  if (error) {
    console.error('Error finding tools by category:', error);
    return [];
  }

  return data || [];
}

/**
 * Search tools by name or purpose
 */
export async function searchTools(query: string): Promise<Tool[]> {
  const { data, error } = await supabase
    .from('tool_registry')
    .select('*')
    .or(`tool_name.ilike.%${query}%,purpose.ilike.%${query}%`)
    .eq('is_active', true)
    .eq('is_deprecated', false)
    .order('tool_name');

  if (error) {
    console.error('Error searching tools:', error);
    return [];
  }

  return data || [];
}

/**
 * Get tool by name
 */
export async function getTool(toolName: string): Promise<Tool | null> {
  const { data, error } = await supabase
    .from('tool_registry')
    .select('*')
    .eq('tool_name', toolName)
    .maybeSingle();

  if (error) {
    console.error('Error getting tool:', error);
    return null;
  }

  return data;
}

/**
 * Get all active tools
 */
export async function getAllActiveTools(): Promise<Tool[]> {
  const { data, error } = await supabase
    .from('tool_registry')
    .select('*')
    .eq('is_active', true)
    .eq('is_deprecated', false)
    .order('category, tool_name');

  if (error) {
    console.error('Error getting all tools:', error);
    return [];
  }

  return data || [];
}

/**
 * Get tools by type
 */
export async function getToolsByType(
  type: 'edge_function' | 'script' | 'service' | 'database_function'
): Promise<Tool[]> {
  const { data, error } = await supabase
    .from('tool_registry')
    .select('*')
    .eq('tool_type', type)
    .eq('is_active', true)
    .eq('is_deprecated', false)
    .order('tool_name');

  if (error) {
    console.error('Error getting tools by type:', error);
    return [];
  }

  return data || [];
}


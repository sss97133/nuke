import { supabase } from './database-audit';

export interface TableAnalysis {
  tableName: string;
  columns: ColumnInfo[];
  rowCount: number;
  sampleData: any;
  conflicts: string[];
  recommendations: string[];
  compatibility: 'compatible' | 'needs-modification' | 'incompatible';
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  isPrimary: boolean;
}

export async function analyzeExistingTables(): Promise<TableAnalysis[]> {
  const tables = ['profiles', 'vehicles', 'vehicle_images', 'auctions', 'tokens'];
  const results: TableAnalysis[] = [];

  for (const tableName of tables) {
    console.log(`\n🔍 Analyzing table: ${tableName}`);
    
    try {
      // Get sample data to understand structure
      const { data: sampleData, error: sampleError } = await supabase
        .from(tableName)
        .select('*')
        .limit(3);

      if (sampleError) {
        console.log(`❌ Cannot access ${tableName}: ${sampleError.message}`);
        continue;
      }

      // Get row count
      const { count, error: countError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      const rowCount = count || 0;
      console.log(`📊 ${tableName}: ${rowCount} rows, ${sampleData?.length || 0} sample records`);

      // Analyze columns from sample data
      const columns: ColumnInfo[] = [];
      if (sampleData && sampleData.length > 0) {
        const sampleRow = sampleData[0];
        columns.push(...Object.keys(sampleRow).map(key => ({
          name: key,
          type: typeof sampleRow[key],
          nullable: sampleRow[key] === null,
          hasDefault: false, // We'll assume this for now
          isPrimary: key === 'id'
        })));
      }

      // Analyze table for conflicts and recommendations
      const analysis = analyzeTableStructure(tableName, columns, sampleData);
      
      results.push({
        tableName,
        columns,
        rowCount,
        sampleData: sampleData?.slice(0, 2) || [], // Keep first 2 rows for reference
        conflicts: analysis.conflicts,
        recommendations: analysis.recommendations,
        compatibility: analysis.compatibility
      });

    } catch (error) {
      console.error(`❌ Error analyzing ${tableName}:`, error);
    }
  }

  return results;
}

function analyzeTableStructure(tableName: string, columns: ColumnInfo[], sampleData: any[]): {
  conflicts: string[];
  recommendations: string[];
  compatibility: 'compatible' | 'needs-modification' | 'incompatible';
} {
  const conflicts: string[] = [];
  const recommendations: string[] = [];
  let compatibility: 'compatible' | 'needs-modification' | 'incompatible' = 'compatible';

  const columnNames = columns.map(c => c.name.toLowerCase());

  // Analyze based on table type
  if (tableName === 'profiles') {
    // Check for required profile columns
    if (!columnNames.includes('id')) conflicts.push('Missing primary key: id');
    if (!columnNames.includes('email')) conflicts.push('Missing email column');
    if (!columnNames.includes('created_at')) recommendations.push('Consider adding created_at timestamp');
    if (!columnNames.includes('updated_at')) recommendations.push('Consider adding updated_at timestamp');
    
    if (conflicts.length > 0) compatibility = 'needs-modification';
  }

  if (tableName === 'vehicles') {
    // Check for required vehicle columns
    if (!columnNames.includes('id')) conflicts.push('Missing primary key: id');
    if (!columnNames.includes('make')) conflicts.push('Missing make column');
    if (!columnNames.includes('model')) conflicts.push('Missing model column');
    if (!columnNames.includes('year')) conflicts.push('Missing year column');
    if (!columnNames.includes('owner_id')) recommendations.push('Consider adding owner_id for user association');
    if (!columnNames.includes('created_at')) recommendations.push('Consider adding created_at timestamp');
    
    if (conflicts.length > 0) compatibility = 'needs-modification';
  }

  if (tableName === 'vehicle_images') {
    // Check for required image columns
    if (!columnNames.includes('id')) conflicts.push('Missing primary key: id');
    if (!columnNames.includes('vehicle_id')) conflicts.push('Missing vehicle_id foreign key');
    if (!columnNames.includes('url')) conflicts.push('Missing image url column');
    if (!columnNames.includes('created_at')) recommendations.push('Consider adding created_at timestamp');
    
    if (conflicts.length > 0) compatibility = 'needs-modification';
  }

  // General recommendations for all tables
  if (!columnNames.includes('id')) {
    recommendations.push('Consider adding UUID primary key');
  }

  if (!columnNames.includes('created_at')) {
    recommendations.push('Consider adding created_at timestamp');
  }

  if (columns.length === 0) {
    conflicts.push('No columns found - table may be empty or inaccessible');
    compatibility = 'incompatible';
  }

  return { conflicts, recommendations, compatibility };
}

export function generateMigrationPlan(analyses: TableAnalysis[]): string {
  let plan = '# Database Migration Plan\n\n';
  
  plan += '## Summary\n';
  plan += `- Total tables analyzed: ${analyses.length}\n`;
  plan += `- Compatible tables: ${analyses.filter(a => a.compatibility === 'compatible').length}\n`;
  plan += `- Tables needing modification: ${analyses.filter(a => a.compatibility === 'needs-modification').length}\n`;
  plan += `- Incompatible tables: ${analyses.filter(a => a.compatibility === 'incompatible').length}\n\n`;

  plan += '## Table-by-Table Analysis\n\n';
  
  for (const analysis of analyses) {
    plan += `### ${analysis.tableName}\n`;
    plan += `- **Status**: ${analysis.compatibility}\n`;
    plan += `- **Rows**: ${analysis.rowCount}\n`;
    plan += `- **Columns**: ${analysis.columns.length}\n`;
    
    if (analysis.conflicts.length > 0) {
      plan += `- **Conflicts**:\n`;
      analysis.conflicts.forEach(conflict => {
        plan += `  - ${conflict}\n`;
      });
    }
    
    if (analysis.recommendations.length > 0) {
      plan += `- **Recommendations**:\n`;
      analysis.recommendations.forEach(rec => {
        plan += `  - ${rec}\n`;
      });
    }
    
    plan += '\n';
  }

  return plan;
} 
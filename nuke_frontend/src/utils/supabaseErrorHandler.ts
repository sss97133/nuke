// Global error handler for missing tables
export const handleMissingTable = (error: any, tableName: string) => {
  if (error?.code === 'PGRST106' || error?.message?.includes('404') || error?.message?.includes('relation') && error?.message?.includes('does not exist')) {
    console.debug(`Table '${tableName}' not available - feature disabled`);
    return null;
  }
  console.error(`Database error in ${tableName}:`, error);
  return error;
};

// Wrapper for supabase queries that might use missing tables
export const safeQuery = async (queryFn: () => Promise<any>, tableName: string) => {
  try {
    const result = await queryFn();
    if (result.error) {
      return handleMissingTable(result.error, tableName) ? result : { data: null, error: null };
    }
    return result;
  } catch (err) {
    return handleMissingTable(err, tableName) ? { data: null, error: err } : { data: null, error: null };
  }
};
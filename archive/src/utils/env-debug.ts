// Temporary debug file to print environment variables
export const logEnvironmentVariables = () => {
  console.log('======= ENVIRONMENT VARIABLES DEBUG =======');
  console.log('VITE_SUPABASE_URL:', (import.meta as any).env?.VITE_SUPABASE_URL);
  console.log('VITE_SUPABASE_ANON_KEY:', (import.meta as any).env?.VITE_SUPABASE_ANON_KEY);
  
  // Check if environment variables are available
  console.log('Environment variables defined?', 
    Boolean((import.meta as any).env?.VITE_SUPABASE_URL && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY)
  );
  
  console.log('=========================================');
};

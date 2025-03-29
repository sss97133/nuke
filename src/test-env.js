// Simple script to test environment variables
console.log("Testing available environment variables:");

// Check process.env
console.log("process.env keys:", Object.keys(process.env));

// Check import.meta.env if running in Vite
try {
  console.log("import.meta.env:", import.meta.env);
} catch (e) {
  console.log("import.meta.env not available (not running in Vite)");
}

// Check window.__env if in browser
if (typeof window !== 'undefined' && window.__env) {
  console.log("window.__env:", window.__env);
} else {
  console.log("window.__env not available");
}

console.log("Looking for Supabase variables specifically:");
console.log("VITE_SUPABASE_URL in process.env:", process.env.VITE_SUPABASE_URL);
console.log("VITE_SUPABASE_ANON_KEY in process.env:", process.env.VITE_SUPABASE_ANON_KEY);

// In browser context with Vite, this section will be handled automatically
// This conditional check doesn't work in this context as import is a keyword
// The correct approach is to simply check in the runtime context where this is executed

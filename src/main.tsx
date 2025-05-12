import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { getEnvironment } from './lib/environment'; // Import the environment utility
import { AuthProvider } from '@/providers/AuthProvider'; // Import our new AuthProvider
import ErrorBoundary from './components/error/ErrorBoundary'; // Import ErrorBoundary

// Import styles in the correct order (global first, then components)
import './index.css'
import './styles/button-fix.css'
import './styles/global-css-fixes.css'
import './styles/component-classes.css'
// import './dev-styles.css' // Development-only styles - Merged into index.css

// Import additional styles to ensure proper bundling
import './fixes/style-importer.js'
import './css-fixes/index.js' // Enhanced CSS fixes

// Get the root element
const rootElement = document.getElementById('root');

if (rootElement) {
  // Get environment variables
  const env = getEnvironment();

  // Verify critical environment variables
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    console.error('Missing critical environment variables. Application may not function correctly.');
    
    // Display error message to user
    rootElement.innerHTML = `
      <div style="padding: 20px; color: red; text-align: center; font-family: sans-serif;">
        <h1>Configuration Error</h1>
        <p>The application is missing critical configuration. Please contact support or check the setup.</p>
        <p style="font-size: 0.8em; color: grey;">Details: Required Supabase URL or Key is missing.</p>
      </div>
    `;
  } else {
    // Wrap App with AuthProvider and ErrorBoundary
    createRoot(rootElement).render(
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    );
  }
} else {
  console.error("Failed to find the root element. Application cannot start.");
}

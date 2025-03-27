/**
 * CSS and UI Development Mode
 * 
 * This script runs the development server with CSS improvements
 * without performing linting or type checking, allowing you to focus
 * on styling and UI fixes even when there are other codebase issues.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Setup directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Fix Tailwind CSS related issues
const fixCSSIssues = () => {
  console.log('Applying CSS fixes and improvements...');

  // Create CSS dev directory if it doesn't exist
  const cssFixDir = path.join(rootDir, 'src', 'css-fixes');
  if (!fs.existsSync(cssFixDir)) {
    fs.mkdirSync(cssFixDir, { recursive: true });
  }

  // Create enhanced base styles 
  const baseStylesFix = `
/* Enhanced base styles */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    @apply font-sans text-base antialiased;
  }
  body {
    @apply bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100;
  }
  h1, h2, h3, h4, h5, h6 {
    @apply font-bold tracking-tight;
  }
  h1 {
    @apply text-3xl md:text-4xl;
  }
  h2 {
    @apply text-2xl md:text-3xl;
  }
  h3 {
    @apply text-xl md:text-2xl;
  }
  a {
    @apply text-blue-600 dark:text-blue-400 hover:underline;
  }
}

/* Custom utility classes */
@layer utilities {
  .focus-ring {
    @apply focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900;
  }
  .animated-transition {
    @apply transition-all duration-200 ease-in-out;
  }
}
`;

  // Write the enhanced base styles file
  fs.writeFileSync(path.join(cssFixDir, 'base.css'), baseStylesFix);

  // Create a CSS helper that improves component styling
  const componentStylesFix = `
/* Component style enhancements */
@layer components {
  /* Buttons */
  .btn {
    @apply inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm focus-ring animated-transition;
  }
  .btn-primary {
    @apply btn bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600;
  }
  .btn-secondary {
    @apply btn bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-700;
  }
  .btn-danger {
    @apply btn bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600;
  }

  /* Cards */
  .card {
    @apply bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden animated-transition;
  }
  .card-header {
    @apply px-4 py-3 border-b border-gray-200 dark:border-gray-700;
  }
  .card-body {
    @apply p-4;
  }
  .card-footer {
    @apply px-4 py-3 border-t border-gray-200 dark:border-gray-700;
  }

  /* Forms */
  .form-input {
    @apply block w-full rounded-md border-gray-300 shadow-sm focus-ring dark:bg-gray-800 dark:border-gray-700 dark:text-white;
  }
  .form-select {
    @apply block w-full rounded-md border-gray-300 shadow-sm focus-ring dark:bg-gray-800 dark:border-gray-700 dark:text-white;
  }
  .form-checkbox {
    @apply rounded border-gray-300 text-blue-600 shadow-sm focus-ring dark:border-gray-700;
  }
  .form-label {
    @apply block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1;
  }
  .form-helper {
    @apply mt-1 text-sm text-gray-500 dark:text-gray-400;
  }
  .form-error {
    @apply mt-1 text-sm text-red-600 dark:text-red-400;
  }
}
`;

  // Write the component styles file
  fs.writeFileSync(path.join(cssFixDir, 'components.css'), componentStylesFix);

  // Create a fixes loader file to import all CSS fixes
  const fixesLoader = `/**
 * CSS Fixes Loader
 * This file imports all CSS fixes and enhancements to ensure they're properly applied
 */

// Import base fixes
import './base.css';
import './components.css';

// Force import global styles to ensure they're included
import '../../index.css';

console.log('CSS fixes and enhancements loaded successfully');
`;

  // Write the loader file
  fs.writeFileSync(path.join(cssFixDir, 'index.js'), fixesLoader);

  // Update main.tsx to import our CSS fixes
  const mainTsxPath = path.join(rootDir, 'src', 'main.tsx');
  let mainTsxContent = fs.readFileSync(mainTsxPath, 'utf8');

  if (!mainTsxContent.includes('./css-fixes')) {
    // Add import after other CSS imports
    if (mainTsxContent.includes('./fixes/style-importer.js')) {
      mainTsxContent = mainTsxContent.replace(
        "import './fixes/style-importer.js'",
        "import './fixes/style-importer.js'\nimport './css-fixes/index.js' // Enhanced CSS fixes"
      );
    } else if (mainTsxContent.includes('./dev-styles.css')) {
      mainTsxContent = mainTsxContent.replace(
        "import './dev-styles.css'",
        "import './dev-styles.css'\nimport './css-fixes/index.js' // Enhanced CSS fixes"
      );
    } else if (mainTsxContent.includes('./index.css')) {
      mainTsxContent = mainTsxContent.replace(
        "import './index.css'",
        "import './index.css'\nimport './css-fixes/index.js' // Enhanced CSS fixes"
      );
    }
    
    fs.writeFileSync(mainTsxPath, mainTsxContent);
    console.log('Updated main.tsx to include CSS fixes');
  }
};

// Main execution
const main = async () => {
  try {
    // Fix CSS issues
    fixCSSIssues();
    
    // Start the development server with CSS fixes
    console.log('Starting development server in CSS development mode...');
    console.log('This bypasses linting and type checking to focus on UI improvements.');
    
    // Run Vite directly without the npm scripts that include validation
    execSync('npx vite --mode development', { 
      stdio: 'inherit',
      cwd: rootDir
    });
  } catch (error) {
    console.error('Error in CSS development mode:', error);
    process.exit(1);
  }
};

main();

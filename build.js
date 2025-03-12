// Simple build wrapper script
const { execSync } = require('child_process');

try {
  console.log('Executing TypeScript compiler...');
  execSync('npx tsc', { stdio: 'inherit' });
  
  console.log('Executing Vite build...');
  execSync('npx vite build', { stdio: 'inherit' });
  
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed with error:', error.message);
  process.exit(1);
}

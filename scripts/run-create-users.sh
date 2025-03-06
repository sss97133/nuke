#!/bin/bash

# Navigate to the project root
cd "$(dirname "$0")/.."

# Install required dependencies if not already installed
if ! npm list @supabase/supabase-js > /dev/null 2>&1; then
  echo "Installing @supabase/supabase-js..."
  npm install @supabase/supabase-js
fi

# Run the script
echo "Creating test users..."
node scripts/create-test-users.js

echo "Done!" 
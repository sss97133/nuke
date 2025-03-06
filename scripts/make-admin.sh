#!/bin/bash

# Navigate to the project root directory
cd "$(dirname "$0")/.."

# Check if @supabase/supabase-js is installed
if ! npm list @supabase/supabase-js > /dev/null 2>&1; then
  echo "Installing @supabase/supabase-js..."
  npm install @supabase/supabase-js
fi

# Check if an email was provided
if [ -z "$1" ]; then
  echo "Error: No email provided"
  echo "Usage: ./scripts/make-admin.sh user@example.com"
  exit 1
fi

# Load environment variables if .env file exists
if [ -f .env ]; then
  echo "Loading environment variables from .env file"
  export $(grep -v '^#' .env | xargs)
fi

# Run the make-admin script
echo "Making user $1 an admin..."
node scripts/make-admin.js "$1"

# Check if the script was successful
if [ $? -eq 0 ]; then
  echo "✅ User $1 is now an admin"
else
  echo "❌ Failed to make user $1 an admin"
  exit 1
fi 
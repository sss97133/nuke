#!/bin/bash

# This script helps set up your local development environment
# by creating the proper .env.development file for local Supabase

# Define the current directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Create the .env.development file
cat > "$DIR/.env.development" << EOL
# Local Supabase configuration
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

# Debug mode enabled for local development
VITE_DEBUG_MODE=true
EOL

echo "Created .env.development with local Supabase configuration."
echo "You'll need to restart your dev server to apply these changes."

# Make the script executable
chmod +x "$DIR/setup-local-env.sh"

echo "Script completed. Run this script with bash setup-local-env.sh"

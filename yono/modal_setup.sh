#!/bin/bash
# Modal Setup Script for YONO Training

set -e

echo "=========================================="
echo "YONO Modal Setup"
echo "=========================================="

# Check if modal is installed
if ! command -v modal &> /dev/null; then
    echo "Installing Modal..."
    pipx install modal
fi

# Authenticate with Modal
echo ""
echo "Step 1: Authenticate with Modal"
echo "This will open a browser window..."
modal token new

# Load Supabase credentials from .env
echo ""
echo "Step 2: Setting up Supabase credentials..."

cd /Users/skylar/nuke

# Extract credentials using dotenvx
SUPABASE_URL=$(dotenvx run -- bash -c 'echo $VITE_SUPABASE_URL')
SUPABASE_KEY=$(dotenvx run -- bash -c 'echo $SUPABASE_SERVICE_ROLE_KEY')

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
    echo "Error: Could not load Supabase credentials"
    exit 1
fi

echo "Supabase URL: $SUPABASE_URL"
echo "Service key: ***${SUPABASE_KEY: -4}"

# Create Modal secret
echo ""
echo "Creating Modal secret 'supabase-credentials'..."
modal secret create supabase-credentials \
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_KEY" \
    --force

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
echo "To start training:"
echo "  cd /Users/skylar/nuke/yono"
echo "  modal run modal_train.py --limit 100000 --epochs 30"
echo ""
echo "To train on 1M images:"
echo "  modal run modal_train.py --limit 1000000 --epochs 30"
echo ""
echo "To train on all 18M images:"
echo "  modal run modal_train.py --limit 20000000 --epochs 50"
echo "=========================================="

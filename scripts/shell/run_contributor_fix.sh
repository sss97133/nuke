#!/bin/bash

# Fix contributor image upload permissions
# This script updates RLS policies to allow contributors to upload images

echo "🔧 Fixing contributor image upload permissions..."
echo ""

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found"
    echo "Please install it: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "Running migration: 20251018_fix_contributor_image_uploads.sql"
echo ""

# Run the migration
supabase db push --db-url "$DATABASE_URL" --file supabase/migrations/20251018_fix_contributor_image_uploads.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration complete!"
    echo ""
    echo "Changes made:"
    echo "  • Contributors with can_edit=true can now upload images"
    echo "  • Previous owners can now add their photos"
    echo "  • Storage bucket policies updated"
    echo ""
    echo "Test it:"
    echo "  1. Log in as a contributor/previous owner"
    echo "  2. Go to vehicle profile"
    echo "  3. Click 'Upload Images' button"
    echo "  4. Select photos (including from iPhone photo library)"
    echo ""
else
    echo ""
    echo "❌ Migration failed"
    echo "Try running manually in Supabase SQL Editor:"
    echo "  cat supabase/migrations/20251018_fix_contributor_image_uploads.sql"
    exit 1
fi


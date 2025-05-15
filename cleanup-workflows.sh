#!/bin/bash

# This script safely archives all old GitHub Actions workflows 
# while preserving only the new core workflows

# Define paths
WORKFLOWS_DIR="/Users/skylar/nuke/.github/workflows"
ARCHIVE_DIR="/Users/skylar/nuke/.github/workflows-archived"

# Create archive directory if it doesn't exist
mkdir -p "$ARCHIVE_DIR"

# Core workflows to preserve
PRESERVE_FILES=(
  "core-ci.yml"
  "core-deploy.yml"
  "core-security.yml"
  "README.md"
)

echo "Archiving unnecessary GitHub Actions workflows..."
echo ""

# Move each workflow file to archive directory if not in preserve list
cd "$WORKFLOWS_DIR"
for file in *.yml; do
  # Skip files in the preserve list
  if [[ " ${PRESERVE_FILES[@]} " =~ " ${file} " ]]; then
    echo "Preserving core workflow: $file"
    continue
  fi
  
  # Move the file to archive with .archived extension
  echo "Archiving workflow: $file"
  mv "$file" "$ARCHIVE_DIR/${file}.archived"
done

echo ""
echo "Workflow cleanup complete!"
echo ""
echo "Core workflows remaining in .github/workflows:"
ls -1 "$WORKFLOWS_DIR" | grep -v "README.md"
echo ""
echo "Archived workflows in .github/workflows-archived:"
ls -1 "$ARCHIVE_DIR" | wc -l | tr -d ' ' | xargs -I{} echo "{} workflows archived"
echo ""
echo "You can safely delete the archived workflows once you've verified the core workflows are functioning correctly."

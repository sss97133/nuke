#!/bin/bash

# This script archives all old GitHub Actions workflows 
# while preserving the new core workflows

# Create the archive directory if it doesn't exist
mkdir -p ../.github/workflows-archived

# Core workflows to preserve
CORE_WORKFLOWS=(
  "core-ci.yml"
  "core-deploy.yml"
  "core-security.yml"
  "README.md"
)

# Move to workflows directory
cd ../.github/workflows

# Process each workflow file
for file in *.yml; do
  # Skip core workflows
  if [[ " ${CORE_WORKFLOWS[@]} " =~ " ${file} " ]]; then
    echo "Preserving core workflow: $file"
    continue
  fi
  
  # Archive the workflow
  echo "Archiving workflow: $file"
  mv "$file" "../workflows-archived/${file}.archived"
done

echo ""
echo "Workflow archiving complete!"
echo "Core workflows remaining in .github/workflows:"
ls -1 ../.github/workflows/*.yml
echo ""
echo "All other workflows have been moved to .github/workflows-archived with .archived extension"
echo "You can safely remove the archived workflows once you're confident the core workflows are functioning correctly."

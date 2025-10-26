#!/usr/bin/env bash
set -euo pipefail

# PR Audit Agent - Read-only comprehensive analysis
# Repository: sss97133/nuke

REPO="sss97133/nuke"
OUTDIR=$(cat current_audit_dir.txt)

echo "Starting PR audit for $REPO"
echo "Output directory: $OUTDIR"
echo "Timestamp: $(date -u)"

# Redirect all output to logs
exec > >(tee "$OUTDIR/logs.txt")
exec 2>&1

echo "=== Fetching all open PRs ==="

# Get list of all open PR numbers first
echo "Getting PR list..."
gh pr list --repo "$REPO" --state open --json number --jq '.[].number' > "$OUTDIR/pr_numbers.txt"

PR_COUNT=$(wc -l < "$OUTDIR/pr_numbers.txt")
echo "Found $PR_COUNT open PRs"

if [ "$PR_COUNT" -eq 0 ]; then
    echo "No open PRs found. Creating empty report."
    echo "[]" > "$OUTDIR/pr_report.json"
    exit 0
fi

echo "=== Fetching detailed PR information ==="

# Initialize the JSON array
echo "[" > "$OUTDIR/pr_report.json"

# Counter for comma handling
counter=0
total=$(cat "$OUTDIR/pr_numbers.txt" | wc -l)

while IFS= read -r pr_number; do
    echo "Processing PR #$pr_number ($((counter + 1))/$total)..."
    
    # Add comma if not first element
    if [ $counter -gt 0 ]; then
        echo "," >> "$OUTDIR/pr_report.json"
    fi
    
    # Fetch comprehensive PR data
    gh pr view "$pr_number" --repo "$REPO" --json number,title,url,author,createdAt,updatedAt,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,commits,files,statusCheckRollup,body,labels,assignees,milestone,isDraft,additions,deletions,changedFiles >> "$OUTDIR/pr_report.json"
    
    counter=$((counter + 1))
    
    # Small delay to avoid rate limiting
    sleep 0.1
done < "$OUTDIR/pr_numbers.txt"

# Close the JSON array
echo "" >> "$OUTDIR/pr_report.json"
echo "]" >> "$OUTDIR/pr_report.json"

echo "=== PR data collection complete ==="
echo "Saved to: $OUTDIR/pr_report.json"
echo "Total PRs processed: $counter"
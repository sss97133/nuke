#!/bin/bash

echo "🧹 Closing duplicate and obsolete PRs (without comments)..."

# Close duplicates and obsolete PRs
gh pr close 128 129 130 131 132 133 134 135 136 137 138 139 141 142

echo "✅ Cleanup complete!"
echo "Remaining PRs should be:"
echo "- #148: New dependabot update (merge this)"  
echo "- #145: Car photo organization (evaluate)"
echo "- #143: Stripe integration (needs conflict resolution)"
echo "- #140: Mobile photo upload (keep latest version)"
echo "- #126: Mobile AI image capture (evaluate)"
echo "- #125: URL import fix (small fix - merge or close)"
#!/usr/bin/env python3
"""
PR Overlap Analysis and Suggestion Generator
Analyzes PR data to detect duplicates and generate action recommendations
"""

import json
import csv
import re
import sys
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

def load_pr_data(outdir):
    """Load PR data from JSON file"""
    pr_file = Path(outdir) / "pr_report.json"
    if not pr_file.exists():
        print(f"Error: {pr_file} not found")
        sys.exit(1)
    
    with open(pr_file, 'r') as f:
        return json.load(f)

def normalize_title(title):
    """Normalize PR title for comparison"""
    if not title:
        return ""
    
    # Convert to lowercase, remove punctuation, collapse spaces
    normalized = re.sub(r'[^a-z0-9\s]+', ' ', title.lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return normalized

def extract_files(pr):
    """Extract file paths from PR data"""
    files = []
    if 'files' in pr and pr['files']:
        for file_info in pr['files']:
            if isinstance(file_info, dict) and 'path' in file_info:
                files.append(file_info['path'])
            elif isinstance(file_info, str):
                files.append(file_info)
    return files

def calculate_overlap(files1, files2):
    """Calculate file overlap between two PRs"""
    set1 = set(files1)
    set2 = set(files2)
    
    if not set1 or not set2:
        return 0, 0, []
    
    intersection = set1.intersection(set2)
    overlap_pct1 = (len(intersection) / len(set1)) * 100 if set1 else 0
    overlap_pct2 = (len(intersection) / len(set2)) * 100 if set2 else 0
    
    return overlap_pct1, overlap_pct2, list(intersection)

def detect_risky_files(files):
    """Detect files that require manual review"""
    risky_patterns = [
        r'migration', r'prisma', r'\.sql$', r'supabase', r'schema',
        r'payment', r'stripe', r'webhook', r'charge', r'db/migrations',
        r'\.psql$'
    ]
    
    risky_files = []
    for file_path in files:
        for pattern in risky_patterns:
            if re.search(pattern, file_path, re.IGNORECASE):
                risky_files.append(file_path)
                break
    
    return risky_files

def get_commits_count(pr):
    """Get number of commits in PR"""
    if 'commits' in pr and pr['commits']:
        return len(pr['commits'])
    return 0

def get_changed_files_count(pr):
    """Get number of changed files"""
    if 'changedFiles' in pr:
        return pr['changedFiles']
    elif 'files' in pr and pr['files']:
        return len(pr['files'])
    return 0

def is_recent(updated_at, days=14):
    """Check if PR was updated recently"""
    try:
        updated = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
        cutoff = datetime.now().replace(tzinfo=updated.tzinfo) - timedelta(days=days)
        return updated > cutoff
    except:
        return False

def is_stale(updated_at, days=30):
    """Check if PR is stale"""
    try:
        updated = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
        cutoff = datetime.now().replace(tzinfo=updated.tzinfo) - timedelta(days=days)
        return updated < cutoff
    except:
        return True

def analyze_duplicates(prs, outdir):
    """Analyze PRs for duplicates and overlaps"""
    
    # Group by normalized title
    title_groups = defaultdict(list)
    for pr in prs:
        norm_title = normalize_title(pr.get('title', ''))
        if norm_title:
            title_groups[norm_title].append(pr['number'])
    
    # Group by branch name
    branch_groups = defaultdict(list)
    for pr in prs:
        branch = pr.get('headRefName', '')
        if branch:
            branch_groups[branch].append(pr['number'])
    
    # Calculate file overlaps
    overlap_matrix = []
    file_overlap_groups = defaultdict(list)
    
    for i, pr1 in enumerate(prs):
        files1 = extract_files(pr1)
        for j, pr2 in enumerate(prs):
            if i >= j:  # Skip self and already computed pairs
                continue
                
            files2 = extract_files(pr2)
            overlap1, overlap2, shared = calculate_overlap(files1, files2)
            
            overlap_matrix.append({
                'pr1': pr1['number'],
                'pr2': pr2['number'],
                'shared_files': len(shared),
                'total_files_pr1': len(files1),
                'total_files_pr2': len(files2),
                'overlap_pct_pr1': round(overlap1, 2),
                'overlap_pct_pr2': round(overlap2, 2),
                'shared_file_list': shared
            })
            
            # Group high overlap pairs
            if overlap1 >= 40 or overlap2 >= 40:
                key = f"{min(pr1['number'], pr2['number'])}-{max(pr1['number'], pr2['number'])}"
                file_overlap_groups[key] = {
                    'pr1': pr1['number'],
                    'pr2': pr2['number'],
                    'overlap1': overlap1,
                    'overlap2': overlap2,
                    'shared_files': shared
                }
    
    # Build duplicate groups
    duplicate_groups = {
        'title_match': {},
        'branch_match': {},
        'file_overlap': dict(file_overlap_groups)
    }
    
    # Add title duplicates (only groups with >1 PR)
    for title, pr_numbers in title_groups.items():
        if len(pr_numbers) > 1:
            duplicate_groups['title_match'][title] = pr_numbers
    
    # Add branch duplicates (only groups with >1 PR)
    for branch, pr_numbers in branch_groups.items():
        if len(pr_numbers) > 1:
            duplicate_groups['branch_match'][branch] = pr_numbers
    
    # Save overlap matrix as CSV
    csv_file = Path(outdir) / "overlap_matrix.csv"
    with open(csv_file, 'w', newline='') as f:
        if overlap_matrix:
            writer = csv.DictWriter(f, fieldnames=[
                'pr1', 'pr2', 'shared_files', 'total_files_pr1', 'total_files_pr2',
                'overlap_pct_pr1', 'overlap_pct_pr2'
            ])
            writer.writeheader()
            for row in overlap_matrix:
                # Remove shared_file_list for CSV (too verbose)
                csv_row = {k: v for k, v in row.items() if k != 'shared_file_list'}
                writer.writerow(csv_row)
    
    # Save duplicate groups
    groups_file = Path(outdir) / "duplicate_groups.json"
    with open(groups_file, 'w') as f:
        json.dump(duplicate_groups, f, indent=2)
    
    return duplicate_groups, overlap_matrix

def generate_suggestions(prs, duplicate_groups, overlap_matrix, outdir):
    """Generate action suggestions for each PR"""
    
    suggestions = []
    dry_run_commands = []
    
    # Create lookup for duplicates
    duplicate_lookup = {}
    
    # Process title duplicates
    for title, pr_numbers in duplicate_groups['title_match'].items():
        if len(pr_numbers) > 1:
            # Find canonical (most recent with approvals)
            canonical = None
            canonical_score = -1
            
            for pr_num in pr_numbers:
                pr = next((p for p in prs if p['number'] == pr_num), None)
                if not pr:
                    continue
                    
                score = 0
                if pr.get('reviewDecision') == 'APPROVED':
                    score += 10
                if is_recent(pr.get('updatedAt', '')):
                    score += 5
                if pr.get('statusCheckRollupState') == 'SUCCESS':
                    score += 3
                
                if score > canonical_score:
                    canonical = pr_num
                    canonical_score = score
            
            # Mark others as duplicates
            for pr_num in pr_numbers:
                if pr_num != canonical:
                    duplicate_lookup[pr_num] = f"duplicate of #{canonical} (title match)"
    
    # Process branch duplicates
    for branch, pr_numbers in duplicate_groups['branch_match'].items():
        if len(pr_numbers) > 1:
            # Similar logic for branch duplicates
            canonical = max(pr_numbers)  # Simple heuristic: highest number (most recent)
            for pr_num in pr_numbers:
                if pr_num != canonical and pr_num not in duplicate_lookup:
                    duplicate_lookup[pr_num] = f"duplicate of #{canonical} (branch match)"
    
    # Process file overlap duplicates
    for key, overlap_info in duplicate_groups['file_overlap'].items():
        pr1, pr2 = overlap_info['pr1'], overlap_info['pr2']
        if pr1 not in duplicate_lookup and pr2 not in duplicate_lookup:
            # Choose canonical based on approval status and recency
            pr1_data = next((p for p in prs if p['number'] == pr1), None)
            pr2_data = next((p for p in prs if p['number'] == pr2), None)
            
            if pr1_data and pr2_data:
                pr1_approved = pr1_data.get('reviewDecision') == 'APPROVED'
                pr2_approved = pr2_data.get('reviewDecision') == 'APPROVED'
                
                if pr1_approved and not pr2_approved:
                    canonical = pr1
                    duplicate_lookup[pr2] = f"high file overlap with #{canonical}"
                elif pr2_approved and not pr1_approved:
                    canonical = pr2
                    duplicate_lookup[pr1] = f"high file overlap with #{canonical}"
                else:
                    # Choose more recent
                    pr1_recent = is_recent(pr1_data.get('updatedAt', ''))
                    pr2_recent = is_recent(pr2_data.get('updatedAt', ''))
                    
                    if pr1_recent and not pr2_recent:
                        canonical = pr1
                        duplicate_lookup[pr2] = f"high file overlap with #{canonical}"
                    else:
                        canonical = pr2
                        duplicate_lookup[pr1] = f"high file overlap with #{canonical}"
    
    # Generate suggestions for each PR
    for pr in prs:
        pr_num = pr['number']
        files = extract_files(pr)
        risky_files = detect_risky_files(files)
        commits_count = get_commits_count(pr)
        changed_files_count = get_changed_files_count(pr)
        
        suggestion = {
            'pr_number': pr_num,
            'title': pr.get('title', ''),
            'author': pr.get('author', {}).get('login', ''),
            'url': pr.get('url', ''),
            'action': 'unknown',
            'risk_level': 'medium',
            'rationale': '',
            'risky_files': risky_files
        }
        
        # Check if it's a duplicate
        if pr_num in duplicate_lookup:
            suggestion['action'] = 'close'
            suggestion['risk_level'] = 'low'
            suggestion['rationale'] = f"Close as {duplicate_lookup[pr_num]}"
            dry_run_commands.append(f'echo "gh pr close {pr_num} --repo {REPO}"')
        
        # Check if it's stale
        elif is_stale(pr.get('updatedAt', '')) and pr.get('reviewDecision') != 'APPROVED':
            suggestion['action'] = 'close'
            suggestion['risk_level'] = 'low'
            suggestion['rationale'] = 'Close as stale (>30 days, no approvals)'
            dry_run_commands.append(f'echo "gh pr close {pr_num} --repo {REPO}"')
        
        # Check if it has risky files
        elif risky_files:
            suggestion['action'] = 'manual-review'
            suggestion['risk_level'] = 'high'
            suggestion['rationale'] = f'Manual review required - touches sensitive files: {", ".join(risky_files[:3])}'
        
        # Check if it's ready to merge (low risk)
        elif (pr.get('mergeable') == 'MERGEABLE' and
              pr.get('statusCheckRollupState') == 'SUCCESS' and
              (pr.get('reviewDecision') == 'APPROVED' or 
               pr.get('author', {}).get('login') == 'dependabot[bot]') and
              commits_count <= 5 and
              changed_files_count <= 10):
            suggestion['action'] = 'merge'
            suggestion['risk_level'] = 'low'
            suggestion['rationale'] = 'Ready to merge - approved, passing checks, small change'
            
            # Determine merge strategy
            if commits_count == 1:
                dry_run_commands.append(f'echo "gh pr merge {pr_num} --repo {REPO} --rebase"')
            else:
                dry_run_commands.append(f'echo "gh pr merge {pr_num} --repo {REPO} --squash"')
        
        # Check if it needs rebase (conflicts)
        elif pr.get('mergeable') == 'CONFLICTING' or pr.get('mergeStateStatus') == 'BEHIND':
            suggestion['action'] = 'rebase'
            suggestion['risk_level'] = 'medium'
            suggestion['rationale'] = 'Needs rebase - has conflicts or is behind base branch'
        
        # Large feature - keep for review
        elif changed_files_count > 10 or commits_count > 10:
            suggestion['action'] = 'keep'
            suggestion['risk_level'] = 'medium'
            suggestion['rationale'] = f'Large feature - {changed_files_count} files, {commits_count} commits'
        
        # Default: keep for review
        else:
            suggestion['action'] = 'keep'
            suggestion['risk_level'] = 'medium'
            suggestion['rationale'] = 'Keep for manual review'
        
        suggestions.append(suggestion)
    
    # Save suggestions
    suggestions_file = Path(outdir) / "suggested_actions.md"
    with open(suggestions_file, 'w') as f:
        f.write("# PR Action Suggestions\n\n")
        f.write(f"Generated on: {datetime.now().isoformat()}\n")
        f.write(f"Repository: sss97133/nuke\n")
        f.write(f"Total PRs analyzed: {len(prs)}\n\n")
        
        # Group by action
        by_action = defaultdict(list)
        for s in suggestions:
            by_action[s['action']].append(s)
        
        for action in ['merge', 'close', 'rebase', 'manual-review', 'keep']:
            if action in by_action:
                f.write(f"## {action.upper()} ({len(by_action[action])} PRs)\n\n")
                for s in by_action[action]:
                    f.write(f"### PR #{s['pr_number']}: {s['title']}\n")
                    f.write(f"- **Author**: {s['author']}\n")
                    f.write(f"- **Action**: {s['action']}\n")
                    f.write(f"- **Risk Level**: {s['risk_level']}\n")
                    f.write(f"- **Rationale**: {s['rationale']}\n")
                    if s['risky_files']:
                        f.write(f"- **Risky Files**: {', '.join(s['risky_files'])}\n")
                    f.write(f"- **URL**: {s['url']}\n\n")
    
    # Save dry run commands
    commands_file = Path(outdir) / "dry_run_commands.sh"
    with open(commands_file, 'w') as f:
        f.write("#!/bin/bash\n")
        f.write("# Dry run commands - DO NOT EXECUTE without review\n")
        f.write("# Remove 'echo' to execute actual commands\n\n")
        for cmd in dry_run_commands:
            f.write(f"{cmd}\n")
    
    return suggestions

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 analyze_overlap_and_build_suggestions.py <output_directory>")
        sys.exit(1)
    
    outdir = sys.argv[1]
    REPO = "sss97133/nuke"  # Set global for dry run commands
    globals()['REPO'] = REPO
    
    print(f"Loading PR data from {outdir}...")
    prs = load_pr_data(outdir)
    
    if not prs:
        print("No PRs found in data file")
        return
    
    print(f"Analyzing {len(prs)} PRs...")
    
    # Analyze duplicates and overlaps
    duplicate_groups, overlap_matrix = analyze_duplicates(prs, outdir)
    
    # Generate suggestions
    suggestions = generate_suggestions(prs, duplicate_groups, overlap_matrix, outdir)
    
    print(f"\nAnalysis complete!")
    print(f"- Duplicate groups found: {sum(len(v) for v in duplicate_groups.values() if isinstance(v, dict))}")
    print(f"- File overlap pairs: {len(overlap_matrix)}")
    print(f"- Suggestions generated: {len(suggestions)}")
    
    # Summary by action
    by_action = defaultdict(int)
    for s in suggestions:
        by_action[s['action']] += 1
    
    print(f"\nAction summary:")
    for action, count in sorted(by_action.items()):
        print(f"  {action}: {count}")

if __name__ == "__main__":
    main()
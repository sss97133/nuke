# 🚀 Autonomous Auditor - 5 Minute Quickstart

## Step 1: Install (30 seconds)

```bash
cd /Users/skylar/nuke
npm install
```

## Step 2: Deploy database tables (1 minute)

```bash
supabase db push
```

This creates the `audit_runs` and `audit_actions` tables.

## Step 3: Run your first audit (2 minutes)

### Dry run first (see what would happen)
```bash
npm run audit:dry-run
```

Expected output:
```
🤖 Autonomous Data Auditor

Configuration:
  Daily budget: $0
  Dry run: YES (no changes will be made)

🔍 Starting autonomous data audit
📋 Found 127 vehicles needing audit

🔍 Auditing: 1973 Chevrolet C10
  Score: 65/100 (70% complete, 60% correct)
  Missing: mileage, engine_size
  Would execute: Decode VIN to get engine_size

... (more vehicles)

✅ Audit Complete
Vehicles that would be improved: 38
Total fixes that would apply: 87
```

### Run for real
```bash
npm run audit
```

## Step 4: Check results (1 minute)

```sql
-- Open Supabase SQL Editor and run:

-- See what just happened
SELECT 
  run_id,
  started_at,
  vehicles_audited,
  vehicles_improved,
  total_fixes,
  total_cost
FROM audit_runs
ORDER BY started_at DESC
LIMIT 5;

-- See individual actions taken
SELECT 
  action_type,
  description,
  status,
  actual_cost,
  actual_confidence_boost
FROM audit_actions
WHERE run_id = (SELECT run_id FROM audit_runs ORDER BY started_at DESC LIMIT 1)
ORDER BY executed_at;

-- See vehicles still needing work
SELECT * FROM get_vehicles_needing_audit(60, 10);
```

## Step 5: Review and approve pending actions (1 minute)

Some actions need human approval (like expensive API calls or low-confidence fixes):

```sql
-- See what needs approval
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  aa.action_type,
  aa.description,
  aa.estimated_cost,
  aa.expected_confidence_boost
FROM audit_actions aa
JOIN vehicles v ON v.id = aa.vehicle_id
WHERE aa.status = 'needs_approval'
ORDER BY aa.expected_confidence_boost DESC;
```

To approve an action, you can manually execute it or adjust the budget/approval threshold:

```bash
# Allow actions up to $1 to run automatically
npm run audit -- --approval=1.00
```

## Common Usage Patterns

### Daily maintenance (recommended)
```bash
npm run audit -- --vehicles=50 --budget=10
```

### Aggressive cleanup (one-time)
```bash
npm run audit -- --vehicles=500 --budget=100 --confidence=75
```

### Conservative (high confidence only)
```bash
npm run audit -- --confidence=95
```

### Focus on specific issues
```bash
# First, see what needs fixing
SELECT field_name, COUNT(*) 
FROM vehicle_validation_issues 
WHERE status = 'open' 
GROUP BY field_name 
ORDER BY COUNT(*) DESC;

# Then run audit to fix them
npm run audit
```

## Automation

Add to your crontab for nightly runs:

```bash
crontab -e
```

Add this line:
```
0 2 * * * cd /Users/skylar/nuke && npm run audit >> /var/log/nuke-audit.log 2>&1
```

## Monitoring Dashboard (SQL)

Create this view for easy monitoring:

```sql
CREATE OR REPLACE VIEW audit_dashboard AS
SELECT 
  'Last 24 Hours' as period,
  COUNT(*) as runs,
  SUM(vehicles_audited) as vehicles_audited,
  SUM(vehicles_improved) as vehicles_improved,
  SUM(total_fixes) as fixes_applied,
  SUM(total_cost) as cost,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))) as avg_duration_seconds
FROM audit_runs
WHERE started_at >= NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'Last 7 Days',
  COUNT(*),
  SUM(vehicles_audited),
  SUM(vehicles_improved),
  SUM(total_fixes),
  SUM(total_cost),
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))))
FROM audit_runs
WHERE started_at >= NOW() - INTERVAL '7 days'
UNION ALL
SELECT 
  'Last 30 Days',
  COUNT(*),
  SUM(vehicles_audited),
  SUM(vehicles_improved),
  SUM(total_fixes),
  SUM(total_cost),
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))))
FROM audit_runs
WHERE started_at >= NOW() - INTERVAL '30 days';

-- View it
SELECT * FROM audit_dashboard;
```

## Troubleshooting

### Error: "Table audit_runs doesn't exist"
```bash
supabase db push
```

### Error: "Function get_vehicles_needing_audit doesn't exist"
```bash
supabase db push
```

### Nothing happens / no vehicles found
Your database is already clean! Try lowering the threshold:
```sql
SELECT * FROM get_vehicles_needing_audit(80, 10);  -- Check vehicles with score < 80
```

### Want to see more details
```bash
VERBOSE=true npm run audit
```

---

**You're done!** Your database is now self-healing. 🎉

Run `npm run audit` whenever you want to clean up data quality issues.


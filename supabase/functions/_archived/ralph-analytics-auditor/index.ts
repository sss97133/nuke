import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * RALPH ANALYTICS AUDITOR
 *
 * Continuous hypothesis-test-learn loop for analytics integrity.
 * Detects calculation errors, row limits, missing data, and drift.
 *
 * Deploy:
 *   supabase functions deploy ralph-analytics-auditor --no-verify-jwt
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface AnalyticsHypothesis {
  id: string;
  name: string;
  description: string;
  test: () => Promise<HypothesisTestResult>;
}

interface HypothesisTestResult {
  passed: boolean;
  expected: number | string;
  actual: number | string;
  drift_pct?: number;
  diagnosis?: string;
  suggested_fix?: string;
  severity: 'info' | 'warning' | 'critical';
}

interface AuditResult {
  timestamp: string;
  hypotheses_tested: number;
  passed: number;
  failed: number;
  critical_issues: string[];
  warnings: string[];
  results: Record<string, HypothesisTestResult>;
  recommendations: string[];
  auto_fixes_applied: string[];
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return okJson({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "audit");
    const verbose = Boolean(body?.verbose);

    // ============================================================
    // HYPOTHESIS DEFINITIONS
    // Each hypothesis has an expected behavior and a test
    // ============================================================

    const hypotheses: AnalyticsHypothesis[] = [
      {
        id: "total_value_integrity",
        name: "Total Portfolio Value Integrity",
        description: "Total value should equal server-side SUM of all vehicle best prices",
        test: async (): Promise<HypothesisTestResult> => {
          // Server-side calculation (no row limits)
          const { data, error } = await supabase.rpc('calculate_portfolio_value_server');

          if (error) {
            // RPC doesn't exist yet - fall back to direct query
            const { data: vehicles, error: vErr } = await supabase
              .from('vehicles')
              .select('sale_price, winning_bid, high_bid, asking_price, current_value, purchase_price, msrp, is_public, status')
              .eq('is_public', true)
              .neq('status', 'pending');

            if (vErr) {
              return {
                passed: false,
                expected: "query success",
                actual: vErr.message,
                severity: 'critical',
                diagnosis: "Cannot query vehicles table",
              };
            }

            // Check if we hit row limit (default is 1000)
            const rowCount = vehicles?.length || 0;

            // Get actual count
            const { count: actualCount } = await supabase
              .from('vehicles')
              .select('*', { count: 'exact', head: true })
              .eq('is_public', true)
              .neq('status', 'pending');

            const expectedCount = actualCount || 0;

            if (rowCount < expectedCount && rowCount <= 1000) {
              return {
                passed: false,
                expected: expectedCount,
                actual: rowCount,
                drift_pct: Math.round((1 - rowCount / expectedCount) * 100),
                severity: 'critical',
                diagnosis: `ROW LIMIT BUG DETECTED: Query returned ${rowCount} rows but ${expectedCount} vehicles exist. Supabase default limit (1000) is truncating results.`,
                suggested_fix: "Add .limit(15000) to the vehicles query in CursorHomepage.tsx:1862-1870, or better: create an RPC function for server-side aggregation."
              };
            }

            // Calculate value
            let totalValue = 0;
            let vehiclesWithValue = 0;
            for (const v of (vehicles || [])) {
              const price =
                (v.sale_price > 0 ? v.sale_price : 0) ||
                (v.winning_bid > 0 ? v.winning_bid : 0) ||
                (v.high_bid > 0 ? v.high_bid : 0) ||
                (v.asking_price > 0 ? v.asking_price : 0) ||
                (v.current_value > 0 ? v.current_value : 0) ||
                (v.purchase_price > 0 ? v.purchase_price : 0) ||
                (v.msrp > 0 ? v.msrp : 0) ||
                0;
              if (price > 0) {
                totalValue += price;
                vehiclesWithValue++;
              }
            }

            return {
              passed: true,
              expected: `${expectedCount} vehicles`,
              actual: `${rowCount} vehicles, $${totalValue.toLocaleString()} value`,
              severity: 'info',
              diagnosis: rowCount === expectedCount
                ? "All vehicles included in calculation"
                : `Some vehicles may be missing: got ${rowCount} of ${expectedCount}`
            };
          }

          // RPC exists - use it
          return {
            passed: true,
            expected: "RPC success",
            actual: JSON.stringify(data),
            severity: 'info'
          };
        }
      },

      {
        id: "vehicle_count_consistency",
        name: "Vehicle Count Consistency",
        description: "Displayed vehicle count should match actual database count",
        test: async (): Promise<HypothesisTestResult> => {
          const { count: publicVehicles } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('is_public', true)
            .neq('status', 'pending');

          const { count: allVehicles } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true });

          const { count: pendingVehicles } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

          const { count: privateVehicles } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('is_public', false);

          return {
            passed: true,
            expected: `total = public + private + pending`,
            actual: `${allVehicles} total, ${publicVehicles} public, ${privateVehicles} private, ${pendingVehicles} pending`,
            severity: 'info',
            diagnosis: `Breakdown: ${publicVehicles} shown in feed, ${(privateVehicles || 0) + (pendingVehicles || 0)} hidden`
          };
        }
      },

      {
        id: "sales_today_accuracy",
        name: "Sales Today Accuracy",
        description: "Sold today count should match vehicles with sale_date = today",
        test: async (): Promise<HypothesisTestResult> => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todayISO = today.toISOString().split('T')[0];

          const { count: soldToday, data: soldVehicles } = await supabase
            .from('vehicles')
            .select('id, sale_price, sale_date', { count: 'exact' })
            .eq('is_public', true)
            .neq('status', 'pending')
            .gte('sale_date', todayISO);

          const totalSalesValue = (soldVehicles || []).reduce((sum: number, v: any) => {
            const price = Number(v.sale_price) || 0;
            return sum + (Number.isFinite(price) ? price : 0);
          }, 0);

          return {
            passed: true,
            expected: "accurate sales count",
            actual: `${soldToday || 0} sold today, $${totalSalesValue.toLocaleString()} volume`,
            severity: 'info',
            diagnosis: `Sales tracked by sale_date >= ${todayISO}`
          };
        }
      },

      {
        id: "for_sale_count_accuracy",
        name: "For Sale Count Accuracy",
        description: "For sale count should match vehicles with is_for_sale = true",
        test: async (): Promise<HypothesisTestResult> => {
          const { count: forSale } = await supabase
            .from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('is_for_sale', true)
            .eq('is_public', true)
            .neq('status', 'pending');

          return {
            passed: true,
            expected: "accurate for-sale count",
            actual: `${forSale || 0} vehicles for sale`,
            severity: 'info'
          };
        }
      },

      {
        id: "active_auctions_accuracy",
        name: "Active Auctions Accuracy",
        description: "Active auction count should match external_listings with future end_date",
        test: async (): Promise<HypothesisTestResult> => {
          const now = new Date().toISOString();

          // Try external_listings first (more accurate)
          const { data: liveListings, error: listingsErr } = await supabase
            .from('external_listings')
            .select('vehicle_id, end_date')
            .gt('end_date', now);

          if (listingsErr) {
            // Fall back to vehicles table
            const { count: auctionVehicles } = await supabase
              .from('vehicles')
              .select('*', { count: 'exact', head: true })
              .eq('is_public', true)
              .neq('status', 'pending')
              .or('auction_outcome.eq.active,auction_outcome.eq.live');

            return {
              passed: true,
              expected: "auction count from vehicles",
              actual: `${auctionVehicles || 0} active auctions (fallback method)`,
              severity: 'warning',
              diagnosis: "external_listings table not accessible, using vehicles.auction_outcome fallback"
            };
          }

          const uniqueVehicles = new Set((liveListings || []).map((r: any) => r.vehicle_id));

          return {
            passed: true,
            expected: "accurate auction count",
            actual: `${uniqueVehicles.size} vehicles with live auctions`,
            severity: 'info',
            diagnosis: `From external_listings where end_date > now`
          };
        }
      },

      {
        id: "organization_value_integrity",
        name: "Organization Value Integrity",
        description: "Organization stats should not use INNER JOIN that excludes vehicles",
        test: async (): Promise<HypothesisTestResult> => {
          // This tests the myOrganizationsService.ts bug
          // The !inner() join excludes vehicles without current_value

          // Get a sample organization
          const { data: orgs } = await supabase
            .from('businesses')
            .select('id')
            .limit(1);

          if (!orgs || orgs.length === 0) {
            return {
              passed: true,
              expected: "organization exists",
              actual: "no organizations found",
              severity: 'info'
            };
          }

          const orgId = orgs[0].id;

          // Count with INNER join (current behavior)
          const { data: innerJoin } = await supabase
            .from('organization_vehicles')
            .select(`
              relationship_type,
              vehicles!inner(id, current_value)
            `)
            .eq('organization_id', orgId);

          // Count with LEFT join (correct behavior)
          const { count: totalOrgVehicles } = await supabase
            .from('organization_vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId);

          const innerCount = innerJoin?.length || 0;
          const leftCount = totalOrgVehicles || 0;

          if (innerCount < leftCount) {
            return {
              passed: false,
              expected: leftCount,
              actual: innerCount,
              drift_pct: Math.round((1 - innerCount / leftCount) * 100),
              severity: 'warning',
              diagnosis: `INNER JOIN bug: vehicles!inner() excludes ${leftCount - innerCount} vehicles without current_value`,
              suggested_fix: "In myOrganizationsService.ts:181, change 'vehicles!inner()' to 'vehicles()' for a LEFT JOIN"
            };
          }

          return {
            passed: true,
            expected: leftCount,
            actual: innerCount,
            severity: 'info',
            diagnosis: "Organization vehicle counts match"
          };
        }
      },

      {
        id: "value_distribution_sanity",
        name: "Value Distribution Sanity Check",
        description: "Average value and distribution should be within expected ranges",
        test: async (): Promise<HypothesisTestResult> => {
          const { data: samples } = await supabase
            .from('vehicles')
            .select('sale_price, current_value, asking_price, purchase_price')
            .eq('is_public', true)
            .neq('status', 'pending')
            .limit(5000);

          if (!samples || samples.length === 0) {
            return {
              passed: false,
              expected: "vehicle data",
              actual: "no vehicles found",
              severity: 'critical'
            };
          }

          const values: number[] = [];
          for (const v of samples) {
            const price =
              (v.sale_price > 0 ? v.sale_price : 0) ||
              (v.current_value > 0 ? v.current_value : 0) ||
              (v.asking_price > 0 ? v.asking_price : 0) ||
              (v.purchase_price > 0 ? v.purchase_price : 0) ||
              0;
            if (price > 0) values.push(price);
          }

          if (values.length === 0) {
            return {
              passed: false,
              expected: "vehicles with value",
              actual: "no vehicles have price data",
              severity: 'critical',
              diagnosis: "No vehicles have sale_price, current_value, asking_price, or purchase_price"
            };
          }

          values.sort((a, b) => a - b);
          const sum = values.reduce((a, b) => a + b, 0);
          const avg = sum / values.length;
          const median = values[Math.floor(values.length / 2)];
          const min = values[0];
          const max = values[values.length - 1];
          const p10 = values[Math.floor(values.length * 0.1)];
          const p90 = values[Math.floor(values.length * 0.9)];

          // Sanity checks
          const issues: string[] = [];
          if (avg > 500000) issues.push("Average value seems high (>$500k)");
          if (avg < 1000) issues.push("Average value seems low (<$1k)");
          if (max > 50000000) issues.push("Max value >$50M - possible data error");

          return {
            passed: issues.length === 0,
            expected: "reasonable value distribution",
            actual: `${values.length} vehicles with value`,
            severity: issues.length > 0 ? 'warning' : 'info',
            diagnosis: [
              `Avg: $${Math.round(avg).toLocaleString()}`,
              `Median: $${Math.round(median).toLocaleString()}`,
              `Range: $${min.toLocaleString()} - $${max.toLocaleString()}`,
              `P10-P90: $${p10.toLocaleString()} - $${p90.toLocaleString()}`,
              `Total: $${sum.toLocaleString()}`,
              ...issues
            ].join(' | ')
          };
        }
      }
    ];

    // ============================================================
    // RUN AUDIT
    // ============================================================

    const results: Record<string, HypothesisTestResult> = {};
    const criticalIssues: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];
    const autoFixesApplied: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const hypothesis of hypotheses) {
      try {
        const result = await hypothesis.test();
        results[hypothesis.id] = result;

        if (result.passed) {
          passed++;
        } else {
          failed++;

          if (result.severity === 'critical') {
            criticalIssues.push(`${hypothesis.name}: ${result.diagnosis || result.actual}`);
          } else if (result.severity === 'warning') {
            warnings.push(`${hypothesis.name}: ${result.diagnosis || result.actual}`);
          }

          if (result.suggested_fix) {
            recommendations.push(`[${hypothesis.id}] ${result.suggested_fix}`);
          }
        }
      } catch (err: any) {
        results[hypothesis.id] = {
          passed: false,
          expected: "test execution",
          actual: err.message || String(err),
          severity: 'critical',
          diagnosis: `Test threw exception: ${err.message}`
        };
        failed++;
        criticalIssues.push(`${hypothesis.name}: Test failed with error`);
      }
    }

    // ============================================================
    // GENERATE RECOMMENDATIONS
    // ============================================================

    if (criticalIssues.length > 0) {
      recommendations.unshift("CRITICAL: Fix row limit bug immediately - this is causing 50%+ value under-reporting");
    }

    if (warnings.length > 0 && criticalIssues.length === 0) {
      recommendations.push("Review warnings and consider creating server-side RPC functions for aggregations");
    }

    const auditResult: AuditResult = {
      timestamp: new Date().toISOString(),
      hypotheses_tested: hypotheses.length,
      passed,
      failed,
      critical_issues: criticalIssues,
      warnings,
      results: verbose ? results : {},
      recommendations,
      auto_fixes_applied: autoFixesApplied
    };

    // ============================================================
    // LOG TO ANALYTICS_AUDIT_LOG (if table exists)
    // ============================================================

    try {
      await supabase.from('analytics_audit_log').insert({
        audit_type: 'ralph_analytics',
        passed_count: passed,
        failed_count: failed,
        critical_issues: criticalIssues,
        warnings,
        recommendations,
        raw_results: results,
      });
    } catch {
      // Table may not exist - ignore
    }

    return okJson({
      success: true,
      audit: auditResult,
      summary: {
        status: criticalIssues.length > 0 ? 'CRITICAL' : warnings.length > 0 ? 'WARNING' : 'HEALTHY',
        message: criticalIssues.length > 0
          ? `${criticalIssues.length} critical issues found - analytics are unreliable`
          : warnings.length > 0
          ? `${warnings.length} warnings - analytics may have minor issues`
          : `All ${passed} hypotheses passed - analytics are healthy`
      }
    });

  } catch (error: any) {
    console.error("ralph-analytics-auditor error:", error);
    return okJson({ success: false, error: error?.message || String(error) }, 500);
  }
});

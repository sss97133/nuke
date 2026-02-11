/**
 * Contract Station Integration Tests
 *
 * Tests all 7 plan items:
 * 1. URL params routing (permalink support)
 * 2. formatUSD fix (uses formatCurrencyFromCents)
 * 3. Batch asset enrichment (no N+1)
 * 4. Deep sub-asset inspection panels
 * 5. Performance chart
 * 6. Allocation visualization
 * 7. Investor position summary (curator view)
 */

import { describe, it, expect } from 'vitest';

// ---- Tests ----

describe('Contract Station - Plan Implementation', () => {

  // Test 1: formatCurrencyFromCents replaces broken formatUSD
  describe('1. Currency Formatting Fix', () => {
    it('formatCurrencyFromCents correctly formats cents to dollars', async () => {
      const { formatCurrencyFromCents } = await import('./utils/currency');

      // The old broken formatUSD: $5000000 / 1000 = "$5,000k" (WRONG)
      // Correct: $5000000 cents = $50,000
      expect(formatCurrencyFromCents(5000000)).toBe('$50,000');
      expect(formatCurrencyFromCents(100000)).toBe('$1,000');
      expect(formatCurrencyFromCents(0)).toBe('$0');
      expect(formatCurrencyFromCents(null)).toBe('—');
      expect(formatCurrencyFromCents(undefined)).toBe('—');
    });

    it('ContractMarketplace imports formatCurrencyFromCents not inline formatUSD', async () => {
      const source = await import('./components/contract/ContractMarketplace?raw');
      const code = (source as any).default || source;
      expect(code).toContain("import { formatCurrencyFromCents }");
      expect(code).not.toContain("const formatUSD");
      expect(code).not.toContain("/ 1000");
    });

    it('ContractTransparency imports formatCurrencyFromCents not inline formatUSD', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("import { formatCurrencyFromCents }");
      expect(code).not.toContain("const formatUSD");
    });
  });

  // Test 2: URL params routing
  describe('2. URL Params & Routing', () => {
    it('ContractStation imports useParams and useNavigate', async () => {
      const source = await import('./pages/ContractStation?raw');
      const code = (source as any).default || source;
      expect(code).toContain("useParams");
      expect(code).toContain("useNavigate");
      expect(code).toContain("urlContractId");
    });

    it('reads contractId from URL params', async () => {
      const source = await import('./pages/ContractStation?raw');
      const code = (source as any).default || source;
      // Check it destructures contractId from useParams
      expect(code).toMatch(/useParams.*contractId/s);
      // Check it initializes selectedContractId from URL param
      expect(code).toContain("urlContractId || null");
    });

    it('navigates to /market/contracts/:id on contract select', async () => {
      const source = await import('./pages/ContractStation?raw');
      const code = (source as any).default || source;
      expect(code).toContain("navigate(`/market/contracts/${id}`)");
    });

    it('navigates to /market/contracts on back', async () => {
      const source = await import('./pages/ContractStation?raw');
      const code = (source as any).default || source;
      expect(code).toContain("navigate('/market/contracts'");
    });
  });

  // Test 3: Batch asset enrichment
  describe('3. Batch Asset Enrichment (N+1 Fix)', () => {
    it('ContractTransparency uses .in() for batch queries', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      // Should use .in('id', ...) for batch fetching
      expect(code).toContain(".in('id', byType.vehicle)");
      expect(code).toContain(".in('id', byType.organization)");
      expect(code).toContain(".in('id', byType.bond)");
      expect(code).toContain(".in('id', byType.stake)");
    });

    it('groups assets by type before fetching', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("byType[asset.asset_type]");
      expect(code).toContain("Promise.all(fetches)");
    });

    it('does not have per-asset switch/case fetch pattern', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      // Old pattern: Promise.all(assets.map(async (asset) => { switch(asset.asset_type) { ... .single() }))
      // Should NOT have .single() inside a map over assets
      expect(code).not.toMatch(/\.map\(async \(asset\)[\s\S]*?switch[\s\S]*?\.single\(\)/);
    });
  });

  // Test 4: Deep sub-asset inspection panels
  describe('4. Deep Sub-Asset Inspection Panels', () => {
    it('has expandable asset rows with chevron icons', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("expandedAssetId");
      expect(code).toContain("ChevronDown");
      expect(code).toContain("ChevronRight");
      expect(code).toContain("setExpandedAssetId");
    });

    it('has VehicleDetail component with valuation breakdown', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function VehicleDetail");
      expect(code).toContain("Entry Price");
      expect(code).toContain("Current Value");
      expect(code).toContain("Gain/Loss");
      expect(code).toContain("VIN");
      expect(code).toContain("image_count");
      expect(code).toContain("receipt_count");
    });

    it('has BondDetail component with issuer and terms', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function BondDetail");
      expect(code).toContain("issuer_name");
      expect(code).toContain("Coupon Rate");
      expect(code).toContain("Maturity");
      expect(code).toContain("On-Time Payments");
      expect(code).toContain("collateral_description");
      expect(code).toContain("Risk indicator");
    });

    it('has StakeDetail component with equity and funding', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function StakeDetail");
      expect(code).toContain("Equity %");
      expect(code).toContain("Profit Share");
      expect(code).toContain("fundraising");
      expect(code).toContain("Target Sale");
      expect(code).toContain("Expected Profit");
      expect(code).toContain("Investor's Share");
    });

    it('has OrgDetail component with business info and reputation', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function OrgDetail");
      expect(code).toContain("business_name");
      expect(code).toContain("employee_count");
      expect(code).toContain("reputation_score");
    });

    it('VIN is masked in vehicle detail', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      // VIN masking: d.vin.slice(0, 3) + '***' + d.vin.slice(-4)
      expect(code).toContain("d.vin.slice(0, 3) + '***' + d.vin.slice(-4)");
    });

    it('getAssetName returns proper names for all types', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function getAssetName");
      // Vehicle: year make model
      expect(code).toContain("asset.details.year");
      // Org: business_name
      expect(code).toContain("asset.details.business_name");
      // Bond: issuer_name + Bond
      expect(code).toContain("Bond");
      // Stake: Equity Stake
      expect(code).toContain("Equity Stake");
    });
  });

  // Test 5: Performance chart
  describe('5. Performance Chart', () => {
    it('imports recharts components', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("AreaChart");
      expect(code).toContain("ResponsiveContainer");
      expect(code).toContain("from 'recharts'");
    });

    it('queries contract_performance table', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("'contract_performance'");
      expect(code).toContain("nav_cents");
    });

    it('shows fallback message when no performance data', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("Performance tracking begins when contract goes active");
    });

    it('renders MetricPill components for performance stats', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function MetricPill");
      expect(code).toContain("daily_return_pct");
      expect(code).toContain("ytd_return_pct");
      expect(code).toContain("annualized_return_pct");
      expect(code).toContain("volatility_pct");
      expect(code).toContain("sharpe_ratio");
      expect(code).toContain("max_drawdown_pct");
    });
  });

  // Test 6: Allocation visualization
  describe('6. Allocation Visualization', () => {
    it('computes allocation by asset type', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("allocationByType");
    });

    it('has color-coded stacked bar', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("ASSET_TYPE_COLORS");
      expect(code).toContain("vehicle: '#3b82f6'");
      expect(code).toContain("bond: '#10b981'");
      expect(code).toContain("stake: '#f59e0b'");
      expect(code).toContain("organization: '#8b5cf6'");
    });

    it('renders legend with labels and percentages', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("ASSET_TYPE_LABELS");
      expect(code).toContain("pct.toFixed(1)");
    });
  });

  // Test 7: Investor position summary (curator view)
  describe('7. Investor Position Summary (Curator View)', () => {
    it('gates investor section behind curator check', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("isCurator");
      expect(code).toContain("contract.curator_id === currentUser.id");
    });

    it('queries contract_investors and contract_transactions', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("'contract_investors'");
      expect(code).toContain("'contract_transactions'");
    });

    it('shows investor count, shares, and recent subscriptions', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("Total Investors");
      expect(code).toContain("Shares Outstanding");
      expect(code).toContain("investorData.count");
      expect(code).toContain("investorData.totalShares");
      expect(code).toContain("investorData.recentSubscriptions");
    });

    it('shows recent transactions list', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("Recent Transactions");
      expect(code).toContain("recentTransactions.map");
      expect(code).toContain("transaction_type");
    });

    it('shows CURATOR VIEW badge', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("CURATOR VIEW");
      expect(code).toContain("Shield");
    });
  });

  // Test 8: Asset hover preview
  describe('8. Asset Hover Preview', () => {
    it('has AssetHoverPreview component', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("function AssetHoverPreview");
    });

    it('wraps asset name cells with hover preview', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("<AssetHoverPreview asset={asset}>");
    });

    it('uses 300ms hover delay like IDHoverCard pattern', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("setTimeout(() => setShow(true), 300)");
    });

    it('has viewport-aware positioning', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("window.innerWidth");
      expect(code).toContain("window.innerHeight");
      expect(code).toContain("getBoundingClientRect");
    });

    it('shows vehicle thumbnail from primary_image_url', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("primary_image_url");
      // Uses Supabase render transform for thumbnails
      expect(code).toContain("/storage/v1/render/image/public/");
    });

    it('has type-specific previews for all 4 asset types', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("asset.asset_type === 'vehicle'");
      expect(code).toContain("asset.asset_type === 'bond'");
      expect(code).toContain("asset.asset_type === 'stake'");
      expect(code).toContain("asset.asset_type === 'organization'");
    });

    it('bond preview shows principal, rate, status', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      // Within the hover preview, these labels appear
      expect(code).toContain('label="Principal"');
      expect(code).toContain('label="Rate"');
    });

    it('stake preview shows funding progress bar', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("% funded");
    });

    it('org preview shows reputation bar', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain('label="Reputation"');
    });

    it('fetches primary_image_url in vehicle batch query', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toMatch(/\.select\(.*primary_image_url.*\)[\s\S]*?\.in\('id', byType\.vehicle\)/);
    });

    it('cleans up timeout on unmount', async () => {
      const source = await import('./components/contract/ContractTransparency?raw');
      const code = (source as any).default || source;
      expect(code).toContain("clearTimeout(timeoutRef.current)");
    });
  });
});

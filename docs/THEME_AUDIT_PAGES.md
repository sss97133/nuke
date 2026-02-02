# Theme audit: light mode and dark mode

**Goal:** Fix divs and colors that stay in light mode when the app is in dark mode.

**How:** Open each page in the app. Switch between light and dark. Where something stays light or unreadable in dark, find that element in the code and fix it (use `var(--…)` or `dark:` classes).

---

## Pages to check (in both themes)

Use this list and tick off as you fix. Focus on **backgrounds and text** (divs that stay white/light gray in dark mode, or text that disappears).

### Main app pages

- [ ] About
- [ ] AddVehicle (add-vehicle)
- [ ] AdminAnalytics
- [ ] AdminDashboard
- [ ] AdminMissionControl
- [ ] AdminPendingVehicles
- [ ] AdminVerifications
- [ ] AuctionListing
- [ ] AuctionMarketplace
- [ ] BaTMembers
- [ ] BrowseInvestments
- [ ] BuilderDashboard
- [ ] BusinessIntelligence
- [ ] BusinessSettings
- [ ] Capsule
- [ ] Capture
- [ ] CatalogBrowser
- [ ] ClaimExternalIdentity
- [ ] ContractStation
- [ ] CreateOrganization
- [ ] CreditsSuccess
- [ ] CurationQueue
- [ ] CursorHomepage
- [ ] Dashboard
- [ ] DatabaseAudit
- [ ] DataDeletion
- [ ] DataDiagnostic
- [ ] DealerAIAssistant
- [ ] DealerBulkEditor
- [ ] DealerDropboxImport
- [ ] DebugMarketSegment
- [ ] DropboxCallback
- [ ] EditVehicle
- [ ] EULA
- [ ] ExtractionReview
- [ ] ImageProcessingDashboard
- [ ] ImportDataPage
- [ ] Invest
- [ ] InvestorDashboard
- [ ] InvoiceManager
- [ ] Library
- [ ] LivingAsciiSamplesPage
- [ ] MarketDashboard
- [ ] MarketDataTools
- [ ] MarketExchange
- [ ] MarketFundDetail
- [ ] MarketIntelligence
- [ ] MarketMovement
- [ ] MarketSegmentDetail
- [ ] MarketSegments
- [ ] MergeProposalsDashboard
- [ ] MyAuctions
- [ ] MyOrganizations
- [ ] Notifications
- [ ] OfferingDetail
- [ ] OrganizationProfile
- [ ] Organizations
- [ ] PersonalPhotoLibrary
- [ ] Portfolio
- [ ] PortfolioWithdraw
- [ ] PrivacyPolicy
- [ ] Profile
- [ ] QuickBooksCallback
- [ ] ResetPassword
- [ ] ScriptControlCenter
- [ ] Search
- [ ] ShopFinancials
- [ ] SocialWorkspace
- [ ] SubscriptionSuccess
- [ ] SystemStatus
- [ ] TermsOfService
- [ ] TestContributions
- [ ] TradingPage
- [ ] UnlinkedReceipts
- [ ] VaultPage
- [ ] VaultScanPage
- [ ] VehicleProfile (and vehicle-profile/*)
- [ ] VehicleJobs
- [ ] Vehicles
- [ ] WiringPlan

### Settings

- [ ] ApiKeysPage
- [ ] UsageDashboardPage
- [ ] WebhooksPage

### Admin

- [ ] AdminHome
- [ ] AdminIdentityClaims
- [ ] AdminRalphBrief
- [ ] BatchImageAnalysis
- [ ] BotTestDashboard
- [ ] BulkPriceEditor
- [ ] ExtractionMonitor
- [ ] HoverCardDemo
- [ ] KSLScraper
- [ ] MemeLibraryAdmin
- [ ] NLQueryConsole
- [ ] PriceCsvImport
- [ ] ProxyBidOperations
- [ ] ScraperDashboard
- [ ] ShippingSettings
- [ ] UnifiedScraperDashboard
- [ ] VehicleMakeLogosCatalog
- [ ] X402Settings

### Betting

- [ ] betting/index
- [ ] MarketDetail

---

## What to fix in code

When a div or section stays light in dark mode:

1. **Backgrounds:** Replace or pair with dark.
   - Use CSS variables: `backgroundColor: 'var(--surface)'` or `className="… bg-[var(--surface)]"`.
   - Or Tailwind: add `dark:bg-gray-800` (or `dark:bg-[var(--surface)]`) next to `bg-white` / `bg-gray-50`.
2. **Text:** Same idea.
   - Use `var(--text)` and `var(--text-secondary)`.
   - Or add `dark:text-white`, `dark:text-gray-300`, etc., where you have `text-gray-900` or `text-black`.
3. **Borders:** Use `var(--border)` or `dark:border-gray-600` (or similar) so borders show in both themes.

**Do not** set `data-theme` or `colorScheme` in pages or components — only ThemeContext does that.

---

## Script

Run from repo root to find likely spots (e.g. `bg-white` without `dark:`):

```bash
./scripts/inspect-theme.sh
```

Then open the listed files and add the right `dark:` or `var(--…)` so light and dark both look correct.

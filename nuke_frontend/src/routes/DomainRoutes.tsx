// src/routes/DomainRoutes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';

// Static pages (footer/legal) — lazy-loaded since rarely visited
const About = React.lazy(() => import('../pages/About'));
const PrivacyPolicy = React.lazy(() => import('../pages/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('../pages/TermsOfService'));
const DataDeletion = React.lazy(() => import('../pages/DataDeletion'));
const EULA = React.lazy(() => import('../pages/EULA'));
const Extension = React.lazy(() => import('../pages/Extension'));

// Search: lazy-loaded (chunk retry logic in main.tsx handles failures)
const Search = React.lazy(() => import('../pages/Search'));
const BrowseVehicles = React.lazy(() => import('../pages/BrowseVehicles'));

// Lazy load domain modules
const VehicleRoutes = React.lazy(() => import('./modules/vehicle/routes'));
const OrganizationRoutes = React.lazy(() => import('./modules/organization/routes'));
const DealerRoutes = React.lazy(() => import('./modules/dealer/routes'));
const AdminRoutes = React.lazy(() => import('./modules/admin/routes'));
const MarketplaceRoutes = React.lazy(() => import('./modules/marketplace/routes'));

// Auth / callbacks (still referenced by many pages/components)
const Login = React.lazy(() => import('../components/auth/Login'));
const OAuthCallback = React.lazy(() => import('../components/auth/OAuthCallback'));
const ResetPassword = React.lazy(() => import('../pages/ResetPassword'));
const DropboxCallback = React.lazy(() => import('../pages/DropboxCallback'));

// Tech capture (photo pipeline)
const TechCapture = React.lazy(() => import('../pages/TechCapture'));
const TechShareUpload = React.lazy(() => import('../pages/TechCapture'));

// Curation and receipts
const CurationQueue = React.lazy(() => import('../pages/CurationQueue'));
const UnlinkedReceipts = React.lazy(() => import('../pages/UnlinkedReceipts'));

// Investor Offering Portal (Data Room) — kept for business/fundraising
// InvestorOffering removed — feature retired

// Business management
const BusinessSettings = React.lazy(() => import('../pages/BusinessSettings'));
const QuickBooksCallback = React.lazy(() => import('../pages/QuickBooksCallback'));
const RestorationIntake = React.lazy(() => import('../pages/RestorationIntake'));

// Legacy pages (still used by navigation components)
const Profile = React.lazy(() => import('../pages/Profile'));
const Capture = React.lazy(() => import('../pages/Capture'));
const Capsule = React.lazy(() => import('../pages/Capsule'));
const Library = React.lazy(() => import('../pages/Library'));
const AuctionMarketplace = React.lazy(() => import('../pages/AuctionMarketplace'));
const CreateAuctionListing = React.lazy(() => import('../components/auction/CreateAuctionListing'));
const AuctionListing = React.lazy(() => import('../pages/AuctionListing'));
const Notifications = React.lazy(() => import('../pages/Notifications'));
const ClaimExternalIdentity = React.lazy(() => import('../pages/ClaimExternalIdentity'));
const BaTMembers = React.lazy(() => import('../pages/BaTMembers'));
const InvoiceManager = React.lazy(() => import('../pages/InvoiceManager'));
const ImportDataPage = React.lazy(() => import('../pages/ImportDataPage'));
const PhotoSyncPage = React.lazy(() => import('../pages/PhotoSyncPage'));
const DailyDebrief = React.lazy(() => import('../pages/DailyDebrief'));

// Feed v2 now promoted to main feed (served via HomePage feed tab)

// Acquisition Pipeline
const AcquisitionPipeline = React.lazy(() => import('../pages/AcquisitionPipeline'));

// Team Inbox
const TeamInbox = React.lazy(() => import('../pages/TeamInbox'));

// Photo / Unified Inbox
const PersonalPhotoLibrary = React.lazy(() => import('../pages/PersonalPhotoLibrary').then(m => ({ default: m.PersonalPhotoLibrary })));

const ApiKeysPage = React.lazy(() => import('../pages/settings/ApiKeysPage'));
const WebhooksPage = React.lazy(() => import('../pages/settings/WebhooksPage'));
const UsageDashboardPage = React.lazy(() => import('../pages/settings/UsageDashboardPage'));
const DevelopersPage = React.lazy(() => import('../pages/developers'));
const ApiLanding = React.lazy(() => import('../pages/ApiLanding'));
const DeveloperSignup = React.lazy(() => import('../pages/DeveloperSignup'));
const DeveloperDashboard = React.lazy(() => import('../pages/DeveloperDashboard'));

// Transfer party page (buyer/seller, no auth required)
const TransferPartyPage = React.lazy(() => import('../pages/TransferPartyPage'));

// Stripe Connect
const StripeConnect = React.lazy(() => import('../pages/StripeConnect'));
const StripeConnectStore = React.lazy(() => import('../pages/StripeConnectStore'));

export const DomainRoutes = () => {
  return (
    <Suspense fallback={<div className="p-4 text-center">Loading module...</div>}>
      <Routes>

        {/* ── Auth ──────────────────────────────────────────────────────── */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dropbox-callback" element={<DropboxCallback />} />

        {/* ── Static / legal ────────────────────────────────────────────── */}
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/eula" element={<EULA />} />
        <Route path="/extension" element={<Extension />} />
        <Route path="/data-deletion" element={<DataDeletion />} />

        {/* ── Domain Modules ────────────────────────────────────────────── */}
        {/* Vehicle + Organization modules have internal ProtectedRoute gates */}
        <Route path="/vehicle/*" element={<VehicleRoutes />} />
        <Route path="/org/*" element={<OrganizationRoutes />} />
        {/* Dealer module: all routes protected (handled inside the module) */}
        <Route path="/dealer/*" element={<DealerRoutes />} />
        {/* Admin module: RequireAdmin gate inside the module */}
        <Route path="/admin/*" element={<AdminRoutes />} />
        {/* Marketplace: mix of public + protected (handled inside the module) */}
        <Route path="/market/*" element={<MarketplaceRoutes />} />

        {/* ── Legacy Route Compatibility Shims ─────────────────────────── */}
        <Route path="/vehicles" element={<Navigate to="/vehicle/list" replace />} />
        <Route path="/add-vehicle" element={<Navigate to="/vehicle/add" replace />} />
        <Route path="/dashboard" element={<Navigate to="/org/dashboard" replace />} />
        <Route path="/organizations" element={<Navigate to="/org" replace />} />
        <Route path="/shops" element={<Navigate to="/org" replace />} />
        <Route path="/shops/onboarding" element={<Navigate to="/org/create" replace />} />
        <Route path="/shops/new" element={<Navigate to="/org/create" replace />} />
        <Route path="/database-audit" element={<Navigate to="/admin/database-audit" replace />} />
        <Route path="/data-diagnostic" element={<Navigate to="/admin/data-diagnostic" replace />} />
        <Route path="/test-contributions" element={<Navigate to="/admin/test-contributions" replace />} />

        {/* ── Public pages ─────────────────────────────────────────────── */}
        {/* /feed-v2 promoted to main feed tab — redirect for any bookmarks */}
        <Route path="/feed-v2" element={<Navigate to="/?tab=feed" replace />} />

        {/* Search + Browse: public */}
        <Route path="/search" element={<Search />} />
        <Route path="/browse" element={<BrowseVehicles />} />
        {/* Public auction listings */}
        <Route path="/auctions" element={<AuctionMarketplace />} />
        <Route path="/auction/:listingId" element={<AuctionListing />} />
        <Route path="/listings/:listingId" element={<AuctionListing />} />
        {/* Community pages */}
        <Route path="/bat-members" element={<BaTMembers />} />
        <Route path="/members" element={<BaTMembers />} />
        {/* Public profile views (with userId = public; without = own profile, guarded below) */}
        <Route path="/profile/:userId" element={<Profile />} />
        <Route path="/profile/external/:externalIdentityId" element={<Profile />} />
        {/* Investor offering / data room — semi-public fundraising page */}
        {/* Docs / developers landing */}
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/docs" element={<DevelopersPage />} />
        <Route path="/docs/api" element={<DevelopersPage />} />
        <Route path="/docs/*" element={<DevelopersPage />} />
        <Route path="/api" element={<ApiLanding />} />
        <Route path="/api/landing" element={<ApiLanding />} />
        <Route path="/developers/signup" element={<DeveloperSignup />} />
        {/* Transfer party page — public, token-accessible */}
        <Route path="/t/:transferId" element={<TransferPartyPage />} />
        {/* Tech capture & restoration intake — used by shops/techs, not end users */}
        <Route path="/tech" element={<TechCapture />} />
        <Route path="/tech/upload" element={<TechShareUpload />} />
        <Route path="/restoration" element={<RestorationIntake />} />
        <Route path="/intake" element={<RestorationIntake />} />

        {/* ── Hub convenience redirects → homepage tabs ─────────────────── */}
        <Route path="/garage" element={<Navigate to="/?tab=garage" replace />} />
        <Route path="/map" element={<Navigate to="/?tab=map" replace />} />
        <Route path="/feed" element={<Navigate to="/?tab=feed" replace />} />

        {/* ── Protected routes (require sign-in) ───────────────────────── */}
        <Route element={<ProtectedRoute />}>
          {/* Own profile (no userId = current user's profile) */}
          <Route path="/profile" element={<Profile />} />

          {/* Personal workspace */}
          <Route path="/capture" element={<Capture />} />
          <Route path="/library" element={<Library />} />
          <Route path="/capsule" element={<Capsule />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/debrief" element={<DailyDebrief />} />
          <Route path="/inbox" element={<PersonalPhotoLibrary />} />
          <Route path="/photo-library" element={<PersonalPhotoLibrary />} />
          <Route path="/team-inbox" element={<TeamInbox />} />

          {/* Content / data management */}
          <Route path="/photos" element={<PhotoSyncPage />} />
          <Route path="/import" element={<ImportDataPage />} />
          <Route path="/invoices" element={<InvoiceManager />} />
          <Route path="/curation-queue" element={<CurationQueue />} />
          <Route path="/curation/queue" element={<Navigate to="/curation-queue" replace />} />
          <Route path="/review/ai-detections" element={<Navigate to="/curation-queue" replace />} />
          <Route path="/receipts/unlinked" element={<UnlinkedReceipts />} />

          {/* Auction creation */}
          <Route path="/auctions/create" element={<CreateAuctionListing />} />
          <Route path="/list-vehicle" element={<CreateAuctionListing />} />

          {/* Acquisition pipeline */}
          <Route path="/pipeline" element={<AcquisitionPipeline />} />
          <Route path="/acquisitions" element={<AcquisitionPipeline />} />

          {/* Identity & social */}
          <Route path="/claim-identity" element={<ClaimExternalIdentity />} />


          {/* Settings (protected) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/settings/api-keys" element={<ApiKeysPage />} />
            <Route path="/settings/webhooks" element={<WebhooksPage />} />
            <Route path="/settings/usage" element={<UsageDashboardPage />} />
            <Route path="/developers/dashboard" element={<DeveloperDashboard />} />
            <Route path="/business/settings" element={<BusinessSettings />} />
            <Route path="/api/quickbooks/callback" element={<QuickBooksCallback />} />
            <Route path="/stripe-connect" element={<StripeConnect />} />
            <Route path="/stripe-connect/store/:accountId" element={<StripeConnectStore />} />
          </Route>
        </Route>

        {/* ── Fallback ─────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

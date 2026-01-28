// src/routes/DomainRoutes.tsx
import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Static pages (footer/legal)
import About from '../pages/About';
import PrivacyPolicy from '../pages/PrivacyPolicy';
import TermsOfService from '../pages/TermsOfService';
import DataDeletion from '../pages/DataDeletion';
import EULA from '../pages/EULA';

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

// ASCII samples (dev / preview)
const LivingAsciiSamplesPage = React.lazy(() => import('../pages/LivingAsciiSamplesPage'));

// Curation and receipts
const CurationQueue = React.lazy(() => import('../pages/CurationQueue'));
const UnlinkedReceipts = React.lazy(() => import('../pages/UnlinkedReceipts'));

// Portfolio (legacy root paths)
const Portfolio = React.lazy(() => import('../pages/Portfolio'));
const CreditsSuccess = React.lazy(() => import('../pages/CreditsSuccess'));
const PortfolioWithdraw = React.lazy(() => import('../pages/PortfolioWithdraw'));

// Investment platform
const Invest = React.lazy(() => import('../pages/Invest'));
const MarketIntelligence = React.lazy(() => import('../pages/MarketIntelligence'));
const OfferingDetail = React.lazy(() => import('../pages/OfferingDetail'));
const SubscriptionFlow = React.lazy(() => import('../components/compliance/SubscriptionFlow'));
const SubscriptionSuccess = React.lazy(() => import('../pages/SubscriptionSuccess'));

// Trading
const TradingPage = React.lazy(() => import('../pages/TradingPage'));

// Vault / Storage
const VaultPage = React.lazy(() => import('../pages/VaultPage'));

// Business management
const BusinessSettings = React.lazy(() => import('../pages/BusinessSettings'));
const QuickBooksCallback = React.lazy(() => import('../pages/QuickBooksCallback'));

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
const SocialWorkspace = React.lazy(() => import('../pages/SocialWorkspace'));
const Search = React.lazy(() => import('../pages/Search').catch((error) => {
  console.error('Failed to load Search component:', error);
  // Return a fallback component
  return { default: () => <div className="p-4">Search temporarily unavailable. Please refresh the page.</div> };
}));

export const DomainRoutes = () => {
  return (
    <Suspense fallback={<div className="p-4 text-center">Loading module...</div>}>
      <Routes>
        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Login />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dropbox-callback" element={<DropboxCallback />} />

        {/* Static / legal pages */}
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/eula" element={<EULA />} />
        <Route path="/data-deletion" element={<DataDeletion />} />

        {/* Domain Modules */}
        <Route path="/vehicle/*" element={<VehicleRoutes />} />
        <Route path="/org/*" element={<OrganizationRoutes />} />
        <Route path="/dealer/*" element={<DealerRoutes />} />
        <Route path="/admin/*" element={<AdminRoutes />} />
        <Route path="/market/*" element={<MarketplaceRoutes />} />

        {/* Legacy Route Compatibility Shims */}
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

        {/* Legacy user pages (used by header nav / profile capsule) */}
        <Route path="/capture" element={<Capture />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:userId" element={<Profile />} />
        <Route path="/profile/external/:externalIdentityId" element={<Profile />} />
        <Route path="/capsule" element={<Capsule />} />
        <Route path="/library" element={<Library />} />
        <Route path="/auctions" element={<AuctionMarketplace />} />
        <Route path="/auctions/create" element={<CreateAuctionListing />} />
        {/* Legacy shim: some pages still navigate to /list-vehicle */}
        <Route path="/list-vehicle" element={<CreateAuctionListing />} />
        {/* Auction listing detail (internal/native) */}
        <Route path="/auction/:listingId" element={<AuctionListing />} />
        <Route path="/listings/:listingId" element={<AuctionListing />} />
        <Route path="/invoices" element={<InvoiceManager />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/claim-identity" element={<ClaimExternalIdentity />} />
        <Route path="/bat-members" element={<BaTMembers />} />
        <Route path="/members" element={<BaTMembers />} />
        <Route path="/search" element={<Search />} />

        {/* Social Media Workspace */}
        <Route path="/social" element={<SocialWorkspace />} />

        {/* Investment Platform */}
        <Route path="/invest" element={<Invest />} />
        <Route path="/invest/offering/:offeringId" element={<OfferingDetail />} />
        <Route path="/invest/subscribe/:offeringId" element={<SubscriptionFlow />} />
        <Route path="/invest/subscription/:subscriptionId/success" element={<SubscriptionSuccess />} />
        <Route path="/market-intelligence" element={<MarketIntelligence />} />

        {/* Trading Terminal */}
        <Route path="/trading" element={<TradingPage />} />
        <Route path="/trading/:offeringId" element={<TradingPage />} />

        {/* Vehicle Storage Vault */}
        <Route path="/vault" element={<VaultPage />} />

        {/* Business Management */}
        <Route path="/business/settings" element={<BusinessSettings />} />
        <Route path="/api/quickbooks/callback" element={<QuickBooksCallback />} />

        {/* ASCII samples (preview shape / identity / pulse) */}
        <Route path="/ascii-samples" element={<LivingAsciiSamplesPage />} />

        {/* Curation & receipts */}
        <Route path="/curation-queue" element={<CurationQueue />} />
        <Route path="/curation/queue" element={<Navigate to="/curation-queue" replace />} />
        <Route path="/review/ai-detections" element={<Navigate to="/curation-queue" replace />} />
        <Route path="/receipts/unlinked" element={<UnlinkedReceipts />} />

        {/* Portfolio legacy routes */}
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/portfolio/success" element={<CreditsSuccess />} />
        <Route path="/portfolio/withdraw" element={<PortfolioWithdraw />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

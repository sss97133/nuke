import React from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import './landing.css';
import './product-page.css';

interface ProductInfo {
  name: string;
  tagline: string;
  description: string[];
  cta: { label: string; to: string };
  status: 'live' | 'beta' | 'coming';
  features: string[];
}

const products: Record<string, ProductInfo> = {
  search: {
    name: 'SEARCH',
    tagline: 'Find any collector vehicle.',
    description: [
      '1.25 million vehicles indexed across Bring a Trailer, Mecum, Barrett-Jackson, RM Sotheby\'s, Cars & Bids, Hagerty, and thousands of dealers.',
      'Every vehicle has a digital twin — year, make, model, VIN, images, auction history, and provenance tracking back to the original source.',
    ],
    cta: { label: 'SEARCH NOW', to: '/search' },
    status: 'live',
    features: [
      'Full-text search across all indexed vehicles',
      'Filter by make, model, year, price range',
      'Browse by location, body style, status',
      'Every result links to a complete vehicle profile',
    ],
  },
  garage: {
    name: 'GARAGE',
    tagline: 'Your vehicle collection.',
    description: [
      'A digital twin of every vehicle you own, are tracking, or want to buy. Photos, documents, work orders, invoices, and complete history — all in one place.',
      'Upload photos from your phone, Dropbox, or iPhoto. AI classifies every image by zone and condition automatically.',
    ],
    cta: { label: 'OPEN GARAGE', to: '/?tab=garage' },
    status: 'live',
    features: [
      'Complete vehicle profiles with photos and documents',
      'Work order tracking and invoicing',
      'Photo inbox with AI zone classification',
      'Auction readiness scoring',
    ],
  },
  market: {
    name: 'MARKET DATA',
    tagline: 'Real auction results, not estimates.',
    description: [
      'Comparable sales from every major auction platform. Actual hammer prices, bid counts, and sale outcomes — not algorithmic guesses.',
      'The Nuke Estimate is a confidence-weighted valuation built from 8 signals including real transaction data, condition assessment, and market timing.',
    ],
    cta: { label: 'VIEW MARKET', to: '/market' },
    status: 'live',
    features: [
      '170K+ auction results with final prices',
      'Comparable sales for any make/model/year',
      'Nuke Estimate valuations with confidence scoring',
      'Market segments and trend tracking',
    ],
  },
  dealers: {
    name: 'DEALER TOOLS',
    tagline: 'Bulk operations for your inventory.',
    description: [
      'Import your entire inventory from Dropbox in one pass. AI generates descriptions, extracts specs, and classifies photos — no manual data entry.',
      'Spreadsheet-style bulk editor for price updates, status changes, and field corrections across hundreds of vehicles at once.',
    ],
    cta: { label: 'GET STARTED', to: '/login' },
    status: 'beta',
    features: [
      'Dropbox folder import with AI processing',
      'Spreadsheet bulk editor',
      'AI-generated vehicle descriptions',
      'Organization storefronts on custom subdomains',
    ],
  },
  api: {
    name: 'API',
    tagline: 'Build on the platform.',
    description: [
      'REST API for vehicle search, profiles, images, valuations, and market history. Webhook support for real-time event notifications.',
      'TypeScript SDK available. Rate limiting and usage analytics built in.',
    ],
    cta: { label: 'VIEW DOCS', to: '/developers' },
    status: 'live',
    features: [
      'Vehicle search and profile endpoints',
      'Valuation and comparable sales API',
      'Image and observation queries',
      'Webhook event subscriptions',
    ],
  },
  shops: {
    name: 'SHOP CAPTURE',
    tagline: 'Document work from the bay.',
    description: [
      'Technicians snap photos and write notes from their phone. Everything auto-links to the vehicle record with GPS-tagged location and timestamp.',
      'No app install required — works from any mobile browser. Share a link with your tech and they start capturing immediately.',
    ],
    cta: { label: 'TRY CAPTURE', to: '/tech' },
    status: 'beta',
    features: [
      'Mobile-first photo and note capture',
      'GPS-tagged work documentation',
      'No app install — browser-based',
      'Auto-links to vehicle records',
    ],
  },
};

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? products[slug] : null;

  if (!product) {
    return <Navigate to="/" replace />;
  }

  const statusBadge = product.status === 'beta' ? 'BETA' : product.status === 'coming' ? 'COMING SOON' : null;

  return (
    <div className="product-page">
      {/* ── Nav ── */}
      <nav className="product-nav">
        <Link to="/" className="product-nav-brand">NUKE</Link>
        <Link to="/login" className="product-nav-login">LOG IN</Link>
      </nav>

      {/* ── Hero ── */}
      <section className="product-hero">
        <div className="product-hero-inner">
          <div className="product-hero-header">
            <h1 className="product-hero-name">{product.name}</h1>
            {statusBadge && <span className="product-hero-badge">{statusBadge}</span>}
          </div>
          <p className="product-hero-tagline">{product.tagline}</p>
          {product.description.map((para, i) => (
            <p key={i} className="product-hero-desc">{para}</p>
          ))}
          <div className="product-hero-actions">
            <Link to={product.cta.to} className="landing-btn landing-btn-primary">{product.cta.label}</Link>
            <Link to="/" className="landing-btn landing-btn-secondary">ALL PRODUCTS</Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="product-features">
        <div className="product-features-inner">
          <h2 className="product-features-title">CAPABILITIES</h2>
          <ul className="product-features-list">
            {product.features.map((f, i) => (
              <li key={i} className="product-feature-item">{f}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Other products ── */}
      <section className="product-others">
        <div className="product-others-inner">
          <h2 className="product-others-title">OTHER PRODUCTS</h2>
          <div className="product-others-grid">
            {Object.entries(products)
              .filter(([s]) => s !== slug)
              .map(([s, p]) => (
                <Link key={s} to={`/products/${s}`} className="product-others-card">
                  <span className="product-others-name">{p.name}</span>
                  <span className="product-others-tagline">{p.tagline}</span>
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-brand">NUKE</span>
          <div className="landing-footer-links">
            <Link to="/about">About</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/api">API</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

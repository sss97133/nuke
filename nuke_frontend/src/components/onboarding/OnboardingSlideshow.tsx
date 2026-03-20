/**
 * OnboardingSlideshow - 3-slide "How It Works" modal for first-time visitors.
 * Triggered from homepage "Take a Tour" CTA.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface OnboardingSlideshowProps {
  isOpen: boolean;
  onClose: () => void;
}

const slides = [
  {
    title: "Drop a URL",
    description: "Paste any vehicle listing URL — Bring a Trailer, eBay, Cars & Bids, Craigslist, Facebook Marketplace, or dozens more. We extract every data point automatically: price, specs, images, seller history, auction results.",
    features: [
      "Instant extraction from 50+ platforms",
      "AI-powered field parsing (VIN, mileage, options, history)",
      "Every page archived — re-extract anytime without re-crawling",
      "Cross-reference against existing vehicle profiles"
    ],
    visual: `  URL ──────────────────────────────────────┐
  bringatrailer.com/listing/1973-porsche   │
  ─────────────────────────────────────────┘
       │
       ▼
  ┌─ EXTRACT ──────────────────────────────┐
  │  Year: 1973        Make: Porsche       │
  │  Model: 911T       VIN: 9113101784     │
  │  Sale: $87,000     Bids: 47            │
  │  Images: 64        Seller: 3 sales     │
  └────────────────────────────────────────┘`
  },
  {
    title: "Explore the Database",
    description: "Browse canonical profiles for hundreds of thousands of real vehicles. Every profile aggregates auction results, pricing history, comparable sales, and provenance data from every source we've ever seen that vehicle.",
    features: [
      "998K+ vehicle profiles with real data",
      "34M+ photos indexed and searchable",
      "Market comps and deal scoring on every listing",
      "Data quality tiers from F (stub) to SSS (museum-grade)"
    ],
    visual: `  ┌─ VEHICLE PROFILE ────────────────────────┐
  │  1967 PORSCHE 911S                       │
  │  VIN: 308081S  ·  TIER: A               │
  │──────────────────────────────────────────│
  │  SOURCES: BaT, Hagerty, PCarMarket      │
  │  IMAGES: 142  ·  EVENTS: 23             │
  │  LAST SALE: $285,000 (2024)             │
  │  NUKE ESTIMATE: $267,000                │
  │  DEAL SCORE: 94 — STRONG BUY            │
  └──────────────────────────────────────────┘`
  },
  {
    title: "Track and Score",
    description: "Add vehicles to your garage, get instant deal scores on active listings, and monitor values over time. Know whether a listing is priced right before you bid — backed by real transaction data, not guesses.",
    features: [
      "Garage: track your vehicles and watchlist",
      "Deal scoring: is this listing priced right?",
      "Value alerts when vehicles you watch come to market",
      "API access to build on top of the dataset"
    ],
    visual: `  ┌─ YOUR GARAGE ─────────────────────────────┐
  │                                           │
  │  1973 Porsche 911T          ▲ +12% YoY   │
  │  1988 BMW M3 E30            ▲  +8% YoY   │
  │  1967 Ford Mustang GT       ▼  -3% YoY   │
  │                                           │
  │  ACTIVE ALERT:                            │
  │  "1973 911T on BaT — $62K — DEAL: 91"   │
  └───────────────────────────────────────────┘`
  },
];

export const OnboardingSlideshow: React.FC<OnboardingSlideshowProps> = ({ isOpen, onClose }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleSignUp = () => {
    navigate('/signup');
  };

  const handleSignIn = () => {
    navigate('/login');
  };

  const slide = slides[currentSlide];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 'var(--space-4)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--white)',
          border: '3px solid var(--grey-900)',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            backgroundColor: 'var(--grey-900)',
            color: 'var(--white)',
            padding: 'var(--space-3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px' }}>
            HOW IT WORKS
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--white)',
              fontSize: '21px',
              cursor: 'pointer',
              padding: '0 var(--space-2)',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Progress Indicator */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-1)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--grey-100)',
            borderBottom: '2px solid var(--border)'
          }}
        >
          {slides.map((_, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                height: '4px',
                backgroundColor: index === currentSlide ? 'var(--grey-900)' : 'var(--grey-300)',
                cursor: 'pointer'
              }}
              onClick={() => setCurrentSlide(index)}
            />
          ))}
        </div>

        {/* Slide Content */}
        <div style={{ padding: 'var(--space-6)' }}>
          {/* ASCII Visual */}
          <div
            style={{
              width: '100%',
              backgroundColor: 'var(--text)',
              border: '1px solid #333',
              padding: '20px 16px',
              marginBottom: 'var(--space-4)',
              fontFamily: "'Courier New', monospace",
              fontSize: '11px',
              lineHeight: '1.5',
              color: 'var(--border)',
              whiteSpace: 'pre',
              overflow: 'auto',
            }}
          >
            {slide.visual}
          </div>

          {/* Title */}
          <h2
            style={{
              fontSize: '21px',
              fontWeight: 700,
              marginBottom: 'var(--space-2)',
              color: 'var(--grey-900)'
            }}
          >
            {slide.title}
          </h2>

          {/* Description */}
          <p
            style={{
              fontSize: '13px',
              marginBottom: 'var(--space-4)',
              color: 'var(--text)',
              lineHeight: 1.6
            }}
          >
            {slide.description}
          </p>

          {/* Features List */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            {slide.features.map((feature, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-2)',
                  fontSize: '12px'
                }}
              >
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    backgroundColor: 'var(--grey-900)',
                    marginTop: '6px',
                    flexShrink: 0
                  }}
                />
                <div>{feature}</div>
              </div>
            ))}
          </div>

          {/* Slide Counter */}
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: 'var(--space-4)'
            }}
          >
            {currentSlide + 1} of {slides.length}
          </div>
        </div>

        {/* Navigation Footer */}
        <div
          style={{
            borderTop: '2px solid var(--border)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--grey-50)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)'
          }}
        >
          {/* Prev Button */}
          <button
            onClick={handlePrev}
            disabled={currentSlide === 0}
            className="button"
            style={{
              fontSize: '12px',
              padding: 'var(--space-2) var(--space-3)',
              opacity: currentSlide === 0 ? 0.3 : 1,
              cursor: currentSlide === 0 ? 'not-allowed' : 'pointer'
            }}
          >
            PREVIOUS
          </button>

          {/* CTA Buttons */}
          {currentSlide === slides.length - 1 ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flex: 1, justifyContent: 'center' }}>
              <button
                onClick={handleSignUp}
                className="button button-primary"
                style={{
                  fontSize: '13px',
                  padding: 'var(--space-2) var(--space-4)',
                  fontWeight: 700
                }}
              >
                CREATE ACCOUNT
              </button>
              <button
                onClick={handleSignIn}
                className="button"
                style={{
                  fontSize: '12px',
                  padding: 'var(--space-2) var(--space-3)'
                }}
              >
                SIGN IN
              </button>
            </div>
          ) : (
            <div style={{ flex: 1, textAlign: 'center' }}>
              <button
                onClick={handleSignUp}
                className="button button-primary"
                style={{
                  fontSize: '12px',
                  padding: 'var(--space-2) var(--space-3)'
                }}
              >
                SKIP TO SIGN UP
              </button>
            </div>
          )}

          {/* Next Button */}
          <button
            onClick={handleNext}
            disabled={currentSlide === slides.length - 1}
            className="button"
            style={{
              fontSize: '12px',
              padding: 'var(--space-2) var(--space-3)',
              opacity: currentSlide === slides.length - 1 ? 0.3 : 1,
              cursor: currentSlide === slides.length - 1 ? 'not-allowed' : 'pointer'
            }}
          >
            NEXT
          </button>
        </div>
      </div>
    </div>
  );
};


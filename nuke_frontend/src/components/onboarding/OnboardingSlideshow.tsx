/**
 * OnboardingSlideshow - Marketing pitch modal for non-logged-in users
 * 5-frame slideshow showcasing platform integrations and features
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface OnboardingSlideshowProps {
  isOpen: boolean;
  onClose: () => void;
}

const slides = [
  {
    title: "AI-Powered Image Analysis",
    description: "Upload photos and our AI automatically detects damage, identifies parts, extracts text from receipts, and organizes everything into a searchable timeline.",
    features: [
      "Automatic damage detection and severity scoring",
      "Parts identification with cross-references to manuals",
      "OCR for receipts, titles, and documents",
      "Smart categorization (exterior, interior, engine, etc.)"
    ],
    visual: "🤖" // Will be replaced with actual screenshots
  },
  {
    title: "Professional Vehicle Profiles",
    description: "Build comprehensive digital dossiers for every vehicle with full history tracking, documentation, and collaborative contributions.",
    features: [
      "VIN decoding with factory specs and recall data",
      "Timeline of all work, modifications, and events",
      "Title verification and ownership claims",
      "Multi-user collaboration on shared vehicles"
    ],
    visual: "📊"
  },
  {
    title: "Smart Receipt & Document Management",
    description: "Never lose another receipt. AI extracts labor, parts, costs, and links everything to your vehicle timeline automatically.",
    features: [
      "Automatic receipt parsing (parts, labor, tax)",
      "Links receipts to timeline events and images",
      "Secure sensitive document storage (titles, registrations)",
      "Export reports for insurance and resale"
    ],
    visual: "📝"
  },
  {
    title: "Real-Time Market Intelligence",
    description: "Track your vehicle's value with live auction data, market comps, and investment-grade analytics.",
    features: [
      "Live auction tracking from Bring a Trailer",
      "Comparable sales analysis and pricing trends",
      "Portfolio valuation and ROI tracking",
      "Market sentiment and demand indicators"
    ],
    visual: "💰"
  },
  {
    title: "Organization & Team Collaboration",
    description: "Perfect for shops, dealers, and collectors. Manage inventory, track work orders, and collaborate with your team in real-time.",
    features: [
      "Multi-vehicle inventory management",
      "Team member roles and permissions",
      "Work order tracking and invoicing",
      "Customer vehicle access and sharing"
    ],
    visual: "🏢"
  }
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
          <div style={{ fontSize: '10pt', fontWeight: 700 }}>
            NUKE PLATFORM - FEATURE SHOWCASE
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--white)',
              fontSize: '16pt',
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
          {/* Visual Placeholder */}
          <div
            style={{
              width: '100%',
              height: '200px',
              backgroundColor: 'var(--grey-100)',
              border: '2px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 'var(--space-4)',
              fontSize: '64pt'
            }}
          >
            {slide.visual}
          </div>

          {/* Title */}
          <h2
            style={{
              fontSize: '16pt',
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
              fontSize: '10pt',
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
                  fontSize: '9pt'
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
              fontSize: '8pt',
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
              fontSize: '9pt',
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
                  fontSize: '10pt',
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
                  fontSize: '9pt',
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
                  fontSize: '9pt',
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
              fontSize: '9pt',
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


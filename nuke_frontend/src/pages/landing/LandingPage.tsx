import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './landing.css';

export default function LandingPage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
  };

  return (
    <div className="landing">
      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <h1 className="landing-title">NUKE</h1>
          <p className="landing-subtitle">
            The collector vehicle data platform.
          </p>

          <form className="landing-search" onSubmit={handleSearch}>
            <input
              type="text"
              className="landing-search-input"
              placeholder="Search 1.25M vehicles — try '1967 Mustang' or a VIN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button type="submit" className="landing-search-btn">SEARCH</button>
          </form>

          <div className="landing-stats">
            <span>1.25M VEHICLES</span>
            <span className="landing-stats-sep" aria-hidden="true" />
            <span>170K+ AUCTION RESULTS</span>
            <span className="landing-stats-sep" aria-hidden="true" />
            <span>FULL PROVENANCE</span>
          </div>

          <div className="landing-hero-actions">
            <Link to="/search" className="landing-btn landing-btn-primary">BROWSE ALL</Link>
            <Link to="/login" className="landing-btn landing-btn-secondary">LOG IN</Link>
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

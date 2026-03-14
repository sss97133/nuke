import React from 'react';
import { Link } from 'react-router-dom';

export const AppFooter: React.FC = () => (
  <footer className="app-footer">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
      <span style={{ color: 'var(--text-secondary)' }}>Nuke &copy; 2026</span>
      <span style={{ color: 'var(--border)', userSelect: 'none' }}>·</span>
      <Link to="/about" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>About</Link>
      <Link to="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Privacy</Link>
      <Link to="/terms" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Terms</Link>
      <Link to="/data-deletion" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Data Deletion</Link>
      <span style={{ color: 'var(--border)', userSelect: 'none' }}>·</span>
      <Link to="/api" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>API</Link>
    </div>
  </footer>
);

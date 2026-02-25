import React from 'react';
import { Link } from 'react-router-dom';

export const AppFooter: React.FC = () => (
  <footer className="app-footer">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', fontSize: '8pt' }}>
      <span>Nuke © 2026</span>
      <Link to="/about" style={{ color: 'inherit', textDecoration: 'underline' }}>About</Link>
      <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</Link>
      <Link to="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</Link>
      <Link to="/data-deletion" style={{ color: 'inherit', textDecoration: 'underline' }}>Data Deletion</Link>
    </div>
  </footer>
);

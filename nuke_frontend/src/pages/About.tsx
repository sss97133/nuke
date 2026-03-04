import React from 'react';
import '../styles/unified-design-system.css';

const About: React.FC = () => {
  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-6)' }}>
          
          {/* Header */}
          <h1 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border-medium)', paddingBottom: 'var(--space-2)' }}>
            About Nuke
          </h1>

          {/* Executive Summary */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Executive Summary
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              <strong>Nuke</strong> is a vehicle identity platform.
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
              <strong>Nuke</strong> is a vehicle identity platform that treats every Vehicle Identification Number (VIN) as a persistent digital entity. Our mission is to create canonical, verifiable records of vehicle history, condition, and value that transcend ownership changes—building the definitive digital identity for every vehicle.
            </p>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              The platform serves three primary stakeholders:
            </p>
            <ol style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>
              <li><strong>Vehicle Enthusiasts/Owners:</strong> Documenting history, managing restoration, tracking value</li>
              <li><strong>Organizations/Dealers:</strong> Managing inventory, processing trade-ins, marketing vehicles</li>
              <li><strong>Marketplace Participants:</strong> Buyers and sellers requiring trusted, verified data</li>
            </ol>
          </section>
        </div>
      </div>
  );
};

export default About;

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

          {/* Three-Layer Architecture */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Three-Layer Data Architecture
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Every vehicle profile processes information through three distinct layers to ensure accuracy and context:
            </p>
            
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌──────────────────────────────────────────────────────────────────────────┐
│                  THREE-LAYER DATA ARCHITECTURE                           │
└──────────────────────────────────────────────────────────────────────────┘

LAYER 1: ARBOREAL (The Root)
─────────────────────────────────────────────────────────────────────────
 Definition: Hierarchical, definitive data bounded within vehicle profile

Components:
  • Primary vehicle data (VIN, year, make, model, trim, series)
  • Ownership chain (historical provenance records)
  • Condition assessments (graded, time-stamped evaluations)
  • Modification log (documented alterations from stock configuration)
  • Service history (maintenance events with evidence)
  • Financial records (acquisition costs, auction results, insurance)

  LAYER 2: CONNECTIVE (The Network)
  ─────────────────────────────────────────────────────────────────────────
  Definition: Relationships between entities that span multiple profiles

  Relationships:
  • Owner-Vehicle links (user owns vehicle record)
  • Org-Vehicle associations (dealer has inventory)
  • Vehicle-to-Vehicle connections (race history, competition, lineage)
  • Cross-platform identity links (external racing databases)

    LAYER 3: ATMOSPHERIC (The Cloud)
    ─────────────────────────────────────────────────────────────────────────
    Definition: Aggregate, market-derived signals providing broader context

    Signals:
    • Market valuations (comparable sales analysis, price trends)
    • Cultural context (community significance, historical importance)
    • External data feeds (auction results, market reports)
    • Social validation (expert recognition, awards, racing results)`}
            </div>
          </section>

          {/* Token System */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Token System
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Nuke operates a three-token ecosystem that aligns incentives across all platform participants:
            </p>
            
            <div style={{ display: 'grid', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              {/* VHX Token */}
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                  VHX (Vehicle History Exchange)
                </h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-2)' }}>
                  <strong>Purpose:</strong> Primary utility token for data access and platform services
                </p>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>Accessing premium vehicle history data</li>
                  <li>Running AI-powered analysis and extraction</li>
                  <li>Listing vehicles in the marketplace</li>
                  <li>Accessing advanced search capabilities</li>
                </ul>
              </div>
              
              {/* PVR Token */}
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                  PVR (Provenance Verification Record)
                </h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-2)' }}>
                  <strong>Purpose:</strong> NFT-based certificate of vehicle authenticity and history
                </p>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>Immutable proof of ownership history</li>
                  <li>Documented restoration and modification records</li>
                  <li>Racing provenance and competition history</li>
                  <li>Insurance and valuation documentation</li>
                </ul>
              </div>
              
              {/* NUK Token */}
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                  NUK (Governance Token)
                </h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-2)' }}>
                  <strong>Purpose:</strong> Platform governance and revenue sharing
                </p>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>Voting on platform improvements and feature priorities</li>
                  <li>Revenue sharing from marketplace transactions</li>
                  <li>Access to exclusive platform features and early releases</li>
                  <li>Staking rewards for long-term platform support</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Knowledge Work System */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Knowledge Work System
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Nuke employs a sophisticated knowledge work architecture to process, validate, and enrich vehicle data:
            </p>
            
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`KNOWLEDGE WORK PIPELINE

[INPUT SOURCES]
  │
  ├── Direct Entry (User forms, bulk upload)
  ├── URL Extraction (AI-powered web scraping)
  ├── Document Processing (PDFs, receipts, manuals)
  ├── Image Analysis (VIN plates, damage assessment)
  └── API Integration (Auction houses, dealers, registries)
  │
  ▼
[AI PROCESSING LAYER]
  │
  ├── Entity Extraction (GPT-4V for visual data)
  ├── Data Normalization (standardize makes/models)
  ├── Duplicate Detection (VIN-based deduplication)
  ├── Confidence Scoring (reliability assessment)
  └── Conflict Resolution (merge or flag discrepancies)
  │
  ▼
[ROUTING ENGINE]
  │
  ├── CREATE: New vehicle profile (no existing match)
  ├── UPDATE: Enrich existing profile (high confidence match)
  ├── MERGE: Combine duplicate records (verified same vehicle)
  ├── FLAG: Queue for manual review (low confidence)
  └── REJECT: Insufficient data (cannot create meaningful record)
  │
  ▼
[OUTPUT]
  │
  ├── Vehicle Profile (canonical, enriched record)
  ├── Evidence Chain (linked source documents)
  ├── Confidence Metrics (data quality indicators)
  └── Change Log (audit trail of all modifications)`}
            </div>
          </section>

          {/* Workspace System */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Professional Tools & Workspace
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Nuke provides professional-grade tools for mechanics, restorers, and automotive professionals:
            </p>
            
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Smart Invoice Processing</h4>
                <p style={{ fontSize: '13px', lineHeight: '1.7' }}>AI-powered receipt and invoice scanning that automatically extracts parts, labor, and costs, building a comprehensive financial history.</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Parts Catalog Integration</h4>
                <p style={{ fontSize: '13px', lineHeight: '1.7' }}>Structured parts inventory with OEM numbers, condition tracking, and installation records linked to specific service events.</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Skill Verification System</h4>
                <p style={{ fontSize: '13px', lineHeight: '1.7' }}>Professional credentials validated through work history, allowing specialists to build verified portfolios of their expertise.</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Studio Documentation</h4>
                <p style={{ fontSize: '13px', lineHeight: '1.7' }}>Professional photography workflows with standardized angle sets, lighting metadata, and condition documentation protocols.</p>
              </div>
            </div>
          </section>

          {/* Market Position */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Market Position & Differentiation
            </h2>
            
            <div style={{ overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--grey-100)' }}>
                    <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>Feature</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>Nuke</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>CarFax</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>BaT</th>
                    <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)', fontWeight: 'bold' }}>Hagerty</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['AI-Powered Data Extraction', '✓', '✗', '✗', '✗'],
                    ['User-Controlled History', '✓', '✗', 'Partial', '✗'],
                    ['Real-Time Collaboration', '✓', '✗', 'Limited', '✗'],
                    ['NFT Provenance Records', '✓', '✗', '✗', '✗'],
                    ['Specialty Vehicle Focus', '✓', '✗', '✓', 'Partial'],
                    ['Professional Workspace Tools', '✓', '✗', '✗', '✗'],
                    ['Cross-Platform Identity', '✓', 'Limited', '✗', 'Limited'],
                  ].map(([feature, nuke, carfax, bat, hagerty]) => (
                    <tr key={feature} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-light)' }}>{feature}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)', color: nuke === '✓' ? 'var(--success)' : 'var(--error)', fontWeight: 'bold' }}>{nuke}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)' }}>{carfax}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)' }}>{bat}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center', border: '1px solid var(--border-light)' }}>{hagerty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Revenue Model */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Revenue Model
            </h2>
            
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Tier 1: Free</h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>Basic vehicle profiles, limited history, standard search</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Tier 2: Enthusiast ($9.99/mo)</h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>Unlimited profiles, AI extraction, advanced search, basic analytics</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Tier 3: Professional ($49.99/mo)</h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>Full workspace tools, bulk processing, API access, team collaboration</p>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Tier 4: Enterprise (Custom)</h3>
                <p style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>White-label solutions, data licensing, custom integrations, dedicated support</p>
              </div>
            </div>
            
            <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-4)', background: 'var(--grey-50)' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Marketplace Revenue</h3>
              <p style={{ fontSize: '13px', lineHeight: '1.7' }}>Transaction fees (2.5% buyer, 1% seller) plus premium listing fees and featured placement.</p>
            </div>
          </section>

          {/* Technical Architecture */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Technical Architecture
            </h2>
            
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Frontend Stack</h3>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>React 18 with TypeScript</li>
                  <li>Vite for fast development builds</li>
                  <li>Custom Windows 95-inspired design system</li>
                  <li>React Router for client-side navigation</li>
                </ul>
              </div>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Backend Infrastructure</h3>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>Supabase (PostgreSQL + Auth + Storage + Edge Functions)</li>
                  <li>Row Level Security for data isolation</li>
                  <li>Edge functions for AI processing pipelines</li>
                  <li>Real-time subscriptions for live collaboration</li>
                </ul>
              </div>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>AI Integration</h3>
                <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)' }}>
                  <li>OpenAI GPT-4V for visual and document processing</li>
                  <li>Custom extraction prompts for automotive data</li>
                  <li>Confidence scoring and validation pipelines</li>
                  <li>Rate limiting and cost optimization</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Team & Culture */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Team & Culture
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Nuke is built by a team of automotive enthusiasts, engineers, and data scientists who believe in the intrinsic value of vehicle history. Our culture centers on:
            </p>
            <ul style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
              <li><strong>Data Integrity:</strong> Every claim backed by verifiable evidence</li>
              <li><strong>User Ownership:</strong> Vehicle owners control their data narrative</li>
              <li><strong>Community First:</strong> Building for enthusiasts, not just enterprises</li>
              <li><strong>Transparent Operation:</strong> Open algorithms, clear data sourcing</li>
            </ul>
          </section>

          {/* Roadmap */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Development Roadmap
            </h2>
            
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <div style={{ border: '1px solid var(--success)', padding: 'var(--space-3)', background: 'var(--success-bg)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-1)', color: 'var(--success)' }}>Phase 1: Foundation (Complete)</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li>Core vehicle profile system</li>
                  <li>AI data extraction pipeline</li>
                  <li>User authentication and profiles</li>
                  <li>Basic marketplace functionality</li>
                </ul>
              </div>
              <div style={{ border: '1px solid var(--warning)', padding: 'var(--space-3)', background: 'var(--warning-bg)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-1)', color: 'var(--warning-dark)' }}>Phase 2: Intelligence (In Progress)</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li>Advanced image matching and deduplication</li>
                  <li>Universal search across all entities</li>
                  <li>Organization management system</li>
                  <li>Professional workspace tools</li>
                </ul>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>Phase 3: Network (Planned)</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li>Token launch and governance system</li>
                  <li>Cross-platform identity federation</li>
                  <li>API marketplace for third-party integrations</li>
                  <li>Mobile applications (iOS/Android)</li>
                </ul>
              </div>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>Phase 4: Scale (Future)</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li>International expansion</li>
                  <li>Enterprise data licensing</li>
                  <li>Regulatory compliance framework</li>
                  <li>Community governance activation</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Contact */}
          <section style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Open Source & Contribution
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Nuke is committed to building in public. Core infrastructure components will be open-sourced as the platform matures, allowing the automotive community to contribute to and audit the systems that manage their vehicle data.
            </p>
            <p style={{ fontSize: '13px', lineHeight: '1.7' }}>
              Community contributors who identify data quality issues, provide historical documentation, or build integrations will be recognized and rewarded through the NUK token system.
            </p>
          </section>

          <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-light)', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Version 2.0 — Built with ♥ for the automotive community
            <br />
            Every vehicle has a story. Nuke makes sure it’s never lost.
          </div>

          {/* NUK Points System */}
          <section style={{ marginBottom: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-light)', paddingBottom: 'var(--space-2)' }}>
              NUK Points: Community Contribution Recognition
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              NUK Points are the platform's reputation and contribution tracking system. Points are awarded for meaningful contributions to the vehicle data ecosystem:
            </p>
            
            <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Data Quality Contributions</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li><strong>+50 pts</strong>: Adding verified VIN with documentation</li>
                  <li><strong>+30 pts</strong>: Uploading service records with receipts</li>
                  <li><strong>+20 pts</strong>: Confirming vehicle condition with photos</li>
                  <li><strong>+10 pts</strong>: Correcting data errors (verified)</li>
                  <li><strong>+5 pts</strong>: Adding ownership history documentation</li>
                </ul>
              </div>
              
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Community Engagement</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li><strong>+25 pts</strong>: Successful referral (new user creates profile)</li>
                  <li><strong>+15 pts</strong>: Completing vehicle critique review</li>
                  <li><strong>+10 pts</strong>: Verifying another user's data claim</li>
                  <li><strong>+5 pts</strong>: First quality comment on vehicle profile</li>
                </ul>
              </div>
              
              <div style={{ border: '1px solid var(--border-light)', padding: 'var(--space-3)', background: 'var(--grey-50)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>Professional Contributions</h3>
                <ul style={{ fontSize: '12px', lineHeight: '1.6', marginLeft: 'var(--space-4)' }}>
                  <li><strong>+100 pts</strong>: Verified expert appraisal submission</li>
                  <li><strong>+75 pts</strong>: Documented restoration project completion</li>
                  <li><strong>+50 pts</strong>: Racing result with official documentation</li>
                  <li><strong>+25 pts</strong>: Technical writeup with parts verification</li>
                </ul>
              </div>
            </div>
            
            <p style={{ fontSize: '11px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
              NUK Points will convert to NUK governance tokens at platform launch, ensuring early contributors have a meaningful voice in platform governance and share in its success.
            </p>
          </section>
          
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <strong>Acknowledgment:</strong> Nuke recognizes that the value of vehicle history data comes from the community that creates and validates it. Every contribution, from correcting a single field to uploading complete restoration documentation, advances our collective mission of preserving automotive heritage.
            <br /><br />
            <em>Contributors who help build this platform will have their contribution recognized.</em>
          </div>

        </div>
    </div>
  );
};

export default About;

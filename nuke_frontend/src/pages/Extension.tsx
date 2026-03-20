import React from 'react';
import '../styles/unified-design-system.css';

const Extension: React.FC = () => {
  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-6)' }}>

        {/* Header */}
        <div style={{ marginBottom: 'var(--space-6)', borderBottom: '2px solid var(--border-medium)', paddingBottom: 'var(--space-4)' }}>
          <p style={{ fontSize: '9px', fontFamily: 'Courier New, monospace', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
            CLAUDE DESKTOP EXTENSION
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: 'var(--space-3)' }}>
            Nuke — Vehicle Intelligence
          </h1>
          <p style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            The automotive knowledge graph. Every vehicle at full resolution. Every claim with provenance.
          </p>
        </div>

        {/* What it is */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: '11px', fontFamily: 'Courier New, monospace', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
            WHAT THIS IS
          </h2>
          <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
            Fully normalized domain ontology at component resolution with full provenance tracking.
            The database doesn't describe the vehicle. The database IS the vehicle.
          </p>
          <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
            Every data point cites its source. Every claim has a confidence score and a decay rate.
            120 subsystem tables per vehicle. Observations from 112+ calibrated sources.
            Multi-model verification. The schema IS the specification.
          </p>
          <p style={{ fontSize: '13px', lineHeight: '1.7' }}>
            This extension connects Claude to the Nuke knowledge graph — giving it deep automotive
            intelligence. Your interactions feed the graph. Your photos become evidence.
            Your knowledge becomes provenance.
          </p>
        </section>

        {/* Install */}
        <section style={{ marginBottom: 'var(--space-6)', background: 'var(--bg-secondary)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '11px', fontFamily: 'Courier New, monospace', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
            INSTALL
          </h2>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '12px', lineHeight: '1.8' }}>
            <p style={{ marginBottom: 'var(--space-2)' }}>
              <strong>Option 1:</strong> Download the .mcpb file and double-click to install in Claude Desktop.
            </p>
            <p style={{ marginBottom: 'var(--space-3)' }}>
              <strong>Option 2:</strong> Add to Claude Desktop config:
            </p>
            <pre style={{
              background: 'var(--black)',
              color: 'var(--white)',
              padding: 'var(--space-3)',
              fontSize: '11px',
              lineHeight: '1.6',
              overflow: 'auto',
            }}>{`{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": ["-y", "nuke-mcp-server"],
      "env": {
        "NUKE_API_KEY": "your_api_key"
      }
    }
  }
}`}</pre>
          </div>
        </section>

        {/* 18 Tools */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: '11px', fontFamily: 'Courier New, monospace', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
            18 TOOLS
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontFamily: 'Courier New, monospace', fontSize: '11px' }}>
            {[
              ['search_vehicles', 'Search the knowledge graph'],
              ['search_vehicles_api', 'Advanced filtered search'],
              ['extract_listing', 'Extract data from any listing URL'],
              ['decode_vin', 'VIN → factory specification'],
              ['identify_vehicle_image', 'Photo → year/make/model/trim'],
              ['analyze_image', 'Vision: condition, zone, damage'],
              ['get_vehicle_valuation', '8-signal market valuation'],
              ['get_valuation', 'Cached valuation lookup'],
              ['get_comps', 'Comparable auction sales'],
              ['market_snapshot', 'Segment market intelligence'],
              ['get_vehicle', 'Full vehicle profile'],
              ['list_vehicles', 'Browse with filters'],
              ['submit_vehicle', 'Add to the knowledge graph'],
              ['contribute_observation', 'Submit an observation'],
              ['register_organization', 'Register a shop/builder/dealer'],
              ['get_vehicle_images', 'Vehicle photos'],
              ['ingest_marketplace_listing', 'FB Marketplace ingest'],
              ['import_facebook_saved', 'Bulk FB Saved import'],
            ].map(([name, desc]) => (
              <div key={name} style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontWeight: 'bold' }}>{name}</span>
                <br />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* The contribution model */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: '11px', fontFamily: 'Courier New, monospace', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
            HOW DATA FLOWS
          </h2>
          <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
            Every interaction is a data event. Search queries reveal market interest. Listing extractions
            create vehicle profiles. Photo analyses generate observations with confidence scores.
            Corrections from domain experts are the highest-confidence data source in the system.
          </p>
          <p style={{ fontSize: '13px', lineHeight: '1.7' }}>
            You talk to Claude about a car. The knowledge graph gets deeper. That's it.
          </p>
        </section>

        {/* npm + GitHub */}
        <section style={{ borderTop: '2px solid var(--border-medium)', paddingTop: 'var(--space-4)' }}>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            <p>npm: <a href="https://www.npmjs.com/package/nuke-mcp-server" style={{ color: 'var(--text-primary)' }}>nuke-mcp-server</a></p>
            <p>source: <a href="https://github.com/sss97133/nuke-mcp-server" style={{ color: 'var(--text-primary)' }}>github.com/sss97133/nuke-mcp-server</a></p>
          </div>
        </section>

      </div>
    </div>
  );
};

export default Extension;

/**
 * HoverCardDemo - Visual demo of all hover card components
 * Shows what each component looks like when hovered
 */

import React from 'react';
import { ImageHoverPreview, AnalysisModelPopup, IDHoverCard, IDText } from '../../components/admin';
import '../../design-system.css';

export default function HoverCardDemo() {
  // Example IDs (these won't load real data, but show the UI)
  const exampleImageId = '550e8400-e29b-41d4-a716-446655440000';
  const exampleVehicleId = '123e4567-e89b-12d3-a456-426614174000';
  const exampleUserId = '987fcdeb-51a2-43f7-9c8d-123456789abc';
  const exampleShortId = 'abc12345';

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>
          Hover Card Components Demo
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Hover over the examples below to see what each component looks like
        </p>
      </div>

      {/* Image Hover Preview */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ 
          padding: 'var(--space-4)', 
          border: '2px solid var(--border-light)', 
          backgroundColor: 'var(--white)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            ImageHoverPreview
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Shows medium-res image preview + extraction date on hover
          </div>
          <div style={{ fontSize: '8pt' }}>
            Image ID: <ImageHoverPreview imageUrl="https://example.com/image.jpg" imageId={exampleImageId}>
              <span style={{ fontFamily: 'monospace', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}>
                {exampleImageId.substring(0, 8)}...
              </span>
            </ImageHoverPreview>
          </div>
          <div style={{ 
            marginTop: 'var(--space-3)', 
            padding: 'var(--space-2)', 
            backgroundColor: 'var(--bg)', 
            fontSize: '8pt',
            color: 'var(--text-muted)',
            fontFamily: 'monospace'
          }}>
            Hover preview shows:
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>320px wide card</li>
              <li>240px tall image preview</li>
              <li>Extraction date (if available)</li>
              <li>Creation date</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Analysis Model Popup */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ 
          padding: 'var(--space-4)', 
          border: '2px solid var(--border-light)', 
          backgroundColor: 'var(--white)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            AnalysisModelPopup
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Click model names to see what they search for and output
          </div>
          <div style={{ fontSize: '8pt' }}>
            Model: <AnalysisModelPopup modelName="gpt-4o">
              <span style={{ color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}>
                gpt-4o
              </span>
            </AnalysisModelPopup>
          </div>
          <div style={{ 
            marginTop: 'var(--space-3)', 
            padding: 'var(--space-2)', 
            backgroundColor: 'var(--bg)', 
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            Click popup shows:
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>600px wide modal (centered)</li>
              <li>Model description & tier</li>
              <li>Usage statistics</li>
              <li>What it searches for (list)</li>
              <li>What it outputs (list)</li>
              <li>Cost information</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ID Hover Card - Vehicle */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ 
          padding: 'var(--space-4)', 
          border: '2px solid var(--border-light)', 
          backgroundColor: 'var(--white)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            IDHoverCard - Vehicle
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Auto-detects vehicle IDs and shows vehicle info
          </div>
          <div style={{ fontSize: '8pt' }}>
            Vehicle ID: <IDHoverCard id={exampleVehicleId} type="vehicle">
              <span style={{ fontFamily: 'monospace', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}>
                {exampleVehicleId.substring(0, 8)}...
              </span>
            </IDHoverCard>
          </div>
          <div style={{ 
            marginTop: 'var(--space-3)', 
            padding: 'var(--space-2)', 
            backgroundColor: 'var(--bg)', 
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            Hover card shows:
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>400px wide card</li>
              <li>Vehicle: Year Make Model</li>
              <li>VIN (if available)</li>
              <li>Creation date</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ID Hover Card - User */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ 
          padding: 'var(--space-4)', 
          border: '2px solid var(--border-light)', 
          backgroundColor: 'var(--white)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            IDHoverCard - User
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Auto-detects user IDs and shows user info
          </div>
          <div style={{ fontSize: '8pt' }}>
            User ID: <IDHoverCard id={exampleUserId} type="user">
              <span style={{ fontFamily: 'monospace', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}>
                {exampleUserId.substring(0, 8)}...
              </span>
            </IDHoverCard>
          </div>
          <div style={{ 
            marginTop: 'var(--space-3)', 
            padding: 'var(--space-2)', 
            backgroundColor: 'var(--bg)', 
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            Hover card shows:
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>400px wide card</li>
              <li>Email address</li>
              <li>Full name (if available)</li>
              <li>Creation date</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ID Text - Automatic Detection */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ 
          padding: 'var(--space-4)', 
          border: '2px solid var(--border-light)', 
          backgroundColor: 'var(--white)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            IDText - Automatic Detection
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            Automatically detects and makes IDs hoverable in any text
          </div>
          <div style={{ fontSize: '8pt', fontFamily: 'monospace', padding: 'var(--space-2)', backgroundColor: 'var(--bg)', border: '1px solid var(--border-light)' }}>
            <IDText>
              Image ID: {exampleImageId}, Vehicle: {exampleVehicleId}, User: {exampleUserId}, Short: {exampleShortId}
            </IDText>
          </div>
          <div style={{ 
            marginTop: 'var(--space-3)', 
            padding: 'var(--space-2)', 
            backgroundColor: 'var(--bg)', 
            fontSize: '8pt',
            color: 'var(--text-muted)'
          }}>
            Automatically detects:
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>Full UUIDs (8-4-4-4-12 format)</li>
              <li>Short IDs (8-32 hex characters)</li>
              <li>Makes them all hoverable</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Visual Style Guide */}
      <div style={{ 
        padding: 'var(--space-4)', 
        border: '2px solid var(--border-light)', 
        backgroundColor: 'var(--white)',
        marginTop: 'var(--space-6)'
      }}>
        <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          Visual Style Guide
        </div>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <strong>Hover Cards:</strong>
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>White background (var(--white))</li>
              <li>2px solid border (var(--border-medium))</li>
              <li>0px border radius (flat design)</li>
              <li>Box shadow: 0 4px 12px rgba(0,0,0,0.15)</li>
              <li>8pt font size throughout</li>
              <li>Monospace font for IDs</li>
              <li>Dotted underline on hoverable text</li>
            </ul>
          </div>
          <div>
            <strong>Positioning:</strong>
            <ul style={{ marginTop: 'var(--space-1)', paddingLeft: 'var(--space-4)' }}>
              <li>Positioned to the right of cursor (or left if no space)</li>
              <li>Adjusted to stay within viewport</li>
              <li>300ms delay before showing (prevents accidental hovers)</li>
              <li>z-index: 10000-10001 (above most content)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}


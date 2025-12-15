/**
 * Test Component for Contextual Analysis
 * Allows admin to test contextual analysis on any event with images
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { ContextualAnalysisService } from '../../services/contextualAnalysisService';

export const TestContextualAnalysis: React.FC = () => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Load vehicles on mount
  useEffect(() => {
    loadVehicles();
  }, []);

  // Load events when vehicle selected
  useEffect(() => {
    if (selectedVehicle) {
      loadEvents(selectedVehicle);
    }
  }, [selectedVehicle]);

  const loadVehicles = async () => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setVehicles(data);
    }
  };

  const loadEvents = async (vehicleId: string) => {
    // Get events with images
    const { data: allEvents, error: eventsError } = await supabase
      .from('timeline_events')
      .select('id, title, event_date, metadata, user_id')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false })
      .limit(100);

    if (eventsError || !allEvents) return;

    // Get image counts for each event
    const eventsWithCounts = await Promise.all(
      allEvents.map(async (event) => {
        const { count } = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('timeline_event_id', event.id);

        return {
          ...event,
          image_count: count || 0,
          has_analysis: !!event.metadata?.contextual_analysis
        };
      })
    );

    // Filter to only events with images
    const withImages = eventsWithCounts.filter(e => e.image_count > 0);
    setEvents(withImages);
  };

  const triggerAnalysis = async () => {
    if (!selectedEvent) return;

    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const event = events.find(e => e.id === selectedEvent);
      if (!event) throw new Error('Event not found');

      // Get image IDs
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('timeline_event_id', selectedEvent);

      if (!images || images.length === 0) {
        throw new Error('No images found for this event');
      }

      const analysisResult = await ContextualAnalysisService.analyzeEventBatch(
        selectedEvent,
        selectedVehicle,
        event.user_id,
        images.map(img => img.id)
      );

      if (analysisResult.success) {
        // Wait a bit then reload event to show results
        setTimeout(async () => {
          const { data: updatedEvent } = await supabase
            .from('timeline_events')
            .select('metadata')
            .eq('id', selectedEvent)
            .single();

          setResult(updatedEvent?.metadata);
          setAnalyzing(false);
        }, 3000);
      } else {
        setError(analysisResult.error || 'Analysis failed');
        setAnalyzing(false);
      }
    } catch (err: any) {
      setError(err.message);
      setAnalyzing(false);
    }
  };

  const selectedEventData = events.find(e => e.id === selectedEvent);

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '16px' }}>
        Test Contextual Analysis
      </h2>

      {/* Vehicle Selection */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
          Select Vehicle:
        </label>
        <select
          value={selectedVehicle}
          onChange={(e) => {
            setSelectedVehicle(e.target.value);
            setSelectedEvent('');
            setResult(null);
          }}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '9pt',
            border: '2px solid #000',
            borderRadius: '0px'
          }}
        >
          <option value="">-- Select a vehicle --</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>
              {v.year} {v.make} {v.model}
            </option>
          ))}
        </select>
      </div>

      {/* Event Selection */}
      {selectedVehicle && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
            Select Event with Images:
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => {
              setSelectedEvent(e.target.value);
              setResult(null);
            }}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '9pt',
              border: '2px solid #000',
              borderRadius: '0px'
            }}
          >
            <option value="">-- Select an event --</option>
            {events.map(e => (
              <option key={e.id} value={e.id}>
                {e.title} - {e.image_count} images {e.has_analysis ? '✓ HAS ANALYSIS' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Event Details */}
      {selectedEventData && (
        <div style={{
          padding: '12px',
          background: '#f0f0f0',
          border: '2px solid #000',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px' }}>
            Event Details:
          </div>
          <div style={{ fontSize: '8pt' }}>
            <div>Title: {selectedEventData.title}</div>
            <div>Date: {selectedEventData.event_date}</div>
            <div>Images: {selectedEventData.image_count}</div>
            <div>Has Analysis: {selectedEventData.has_analysis ? 'Yes' : 'No'}</div>
          </div>
        </div>
      )}

      {/* Analyze Button */}
      <button
        onClick={triggerAnalysis}
        disabled={!selectedEvent || analyzing}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '9pt',
          fontWeight: 700,
          border: '2px solid #000',
          background: analyzing ? '#ccc' : '#fff',
          color: '#000',
          cursor: analyzing ? 'not-allowed' : 'pointer',
          marginBottom: '16px'
        }}
      >
        {analyzing ? 'ANALYZING...' : 'TRIGGER CONTEXTUAL ANALYSIS'}
      </button>

      {/* Error Display */}
      {error && (
        <div style={{
          padding: '12px',
          background: '#fee',
          border: '2px solid #f00',
          marginBottom: '16px',
          fontSize: '8pt',
          color: '#c00'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div style={{
          padding: '12px',
          background: 'var(--surface)',
          border: '2px solid #000'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px' }}>
            Analysis Results:
          </div>

          {/* Contextual Analysis */}
          {result.contextual_analysis && (
            <div style={{ marginBottom: '16px', padding: '8px', background: '#f0f9ff', border: '1px solid #3b82f6' }}>
              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                Contextual Analysis:
              </div>
              <div style={{ fontSize: '7pt' }}>
                <div><strong>Situation:</strong> {result.contextual_analysis.situation_summary}</div>
                <div><strong>Activity:</strong> {result.contextual_analysis.primary_activity}</div>
                <div><strong>Components:</strong> {result.contextual_analysis.components_involved?.join(', ')}</div>
                <div><strong>Work Hours:</strong> {result.contextual_analysis.time_investment?.estimated_work_hours || 0}</div>
                <div><strong>Confidence:</strong> {result.contextual_analysis.confidence_score}%</div>
              </div>
            </div>
          )}

          {/* Commitment Score */}
          {result.user_commitment_score && (
            <div style={{ padding: '8px', background: '#fef3c7', border: '1px solid #f59e0b' }}>
              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                User Commitment Score:
              </div>
              <div style={{ fontSize: '7pt' }}>
                <div><strong>Level:</strong> {result.user_commitment_score.level?.toUpperCase()}</div>
                <div><strong>Overall:</strong> {result.user_commitment_score.overall_commitment}/100</div>
                <div><strong>Factors:</strong> {result.user_commitment_score.factors?.join(', ')}</div>
              </div>
            </div>
          )}

          {/* Raw JSON */}
          <details style={{ marginTop: '12px' }}>
            <summary style={{ fontSize: '7pt', cursor: 'pointer', fontWeight: 700 }}>
              View Raw JSON
            </summary>
            <pre style={{
              fontSize: '6pt',
              background: '#f5f5f5',
              padding: '8px',
              overflow: 'auto',
              maxHeight: '300px',
              border: '1px solid #ccc',
              marginTop: '8px'
            }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
};

export default TestContextualAnalysis;


/**
 * EventForm Component
 * 
 * This component provides a form for creating and editing vehicle timeline events.
 */
import React, { useState, useEffect } from 'react';
import { EventFormProps, TimelineEvent, isTimelineEvent } from './types';
import './VehicleTimeline.css';

export const EventForm: React.FC<EventFormProps> = ({
  isAddingEvent,
  currentEvent,
  eventTypes,
  vehicleId,
  onClose,
  onSave
}) => {
  const [formData, setFormData] = useState<Partial<TimelineEvent>>(
    currentEvent || {
      vehicleId,
      eventType: '',
      eventSource: 'user',
      eventDate: new Date().toISOString().split('T')[0],
      title: '',
      description: '',
      confidenceScore: 100,
      metadata: {},
      imageUrls: []
    }
  );

  // Update form when currentEvent changes
  useEffect(() => {
    if (currentEvent) {
      setFormData(currentEvent);
    }
  }, [currentEvent]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prepare event data
    const eventData: TimelineEvent = {
      id: isTimelineEvent(formData) ? formData.id : `temp-${Date.now()}`,
      vehicleId: formData.vehicleId || vehicleId,
      eventType: formData.eventType || '',
      eventSource: formData.eventSource || 'user',
      eventDate: formData.eventDate || new Date().toISOString(),
      title: formData.title || '',
      description: formData.description || '',
      confidenceScore: formData.confidenceScore || 100,
      metadata: formData.metadata || {},
      sourceUrl: formData.sourceUrl,
      imageUrls: formData.imageUrls || []
    };
    
    // Call parent save handler
    onSave(eventData);
  };

  return (
    <div className="timeline-modal-overlay">
      <div className="timeline-modal">
        <h3>{isTimelineEvent(currentEvent) ? 'Edit Event' : 'Add New Event'}</h3>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input 
              id="title"
              name="title"
              type="text"
              value={formData.title || ''}
              onChange={handleChange}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="eventType">Event Type</label>
            <select
              id="eventType"
              name="eventType"
              value={formData.eventType || ''}
              onChange={handleChange}
              required
            >
              <option value="">Select event type</option>
              {eventTypes.length > 0 ? (
                eventTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))
              ) : (
                <>
                  <option value="purchase">Purchase</option>
                  <option value="sale">Sale</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="modification">Modification</option>
                  <option value="accident">Accident</option>
                  <option value="auction">Auction</option>
                  <option value="registration">Registration</option>
                  <option value="other">Other</option>
                </>
              )}
            </select>
          </div>
          
          <div className="form-group">
            <label htmlFor="eventDate">Date</label>
            <input 
              id="eventDate"
              name="eventDate"
              type="date"
              value={formData.eventDate?.toString().split('T')[0] || ''}
              onChange={handleChange}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea 
              id="description"
              name="description"
              value={formData.description || ''}
              onChange={handleChange}
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="eventSource">Source</label>
            <input 
              id="eventSource"
              name="eventSource"
              type="text"
              value={formData.eventSource || 'user'}
              onChange={handleChange}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="confidenceScore">Confidence Score: {formData.confidenceScore || 100}%</label>
            <input 
              id="confidenceScore"
              name="confidenceScore"
              type="range"
              min="0"
              max="100"
              value={formData.confidenceScore || 100}
              onChange={(e) => handleChange({
                ...e,
                target: {
                  ...e.target,
                  name: 'confidenceScore',
                  value: e.target.value
                }
              })}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="sourceUrl">Source URL</label>
            <input 
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              value={formData.sourceUrl || ''}
              onChange={handleChange}
            />
          </div>
          
          <div className="form-buttons">
            <button type="button" className="cancel-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="save-button">
              {isTimelineEvent(currentEvent) ? 'Update Event' : 'Add Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EventForm;

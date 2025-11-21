import { useState } from 'react';
import type { useForm } from 'react-hook-form';
import type { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

// Zod schema for timeline event validation
const timelineEventSchema = z.object({
  event_type: z.enum([
    'purchase', 'sale', 'service', 'repair', 'restoration', 
    'inspection', 'modification', 'registration', 'accident',
    'milestone', 'custom'
  ], {
    required_error: "Event type is required"
  }),
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  location: z.string().optional(),
  source: z.string().optional(),
  confidence_score: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.any()).optional()
});

type TimelineEventFormData = z.infer<typeof timelineEventSchema>;

const TimelineEventForm = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { 
    register, 
    handleSubmit, 
    formState: { errors },
    watch,
    setValue
  } = useForm({
    resolver: zodResolver(timelineEventSchema) as any,
    defaultValues: {
      event_date: new Date().toISOString().split('T')[0],
      confidence_score: 0.5
    }
  }) as any;

  const confidenceScore = watch('confidence_score');
  const eventType = watch('event_type');
  
  const onSubmit = async (data: TimelineEventFormData) => {
    if (!vehicleId) {
      setError('Vehicle ID is missing. Please try again.');
      return;
    }
    
    try {
      setSubmitting(true);
      setError(null);
      
      const { data: userData } = await supabase.auth.getUser();
      
      const eventPayload = {
        vehicle_id: vehicleId,
        user_id: userData.user?.id,
        event_type: data.event_type,
        title: data.title,
        description: data.description,
        event_date: data.event_date,
        source: data.source || 'user_input',
        confidence_score: data.confidence_score,
        metadata: data.metadata || {}
      };
      
      const { error: insertError } = await supabase
        .from('timeline_events')
        .insert([eventPayload]);

      if (insertError) throw insertError;
      
      // Navigate back to vehicle detail page
      navigate(`/vehicles/${vehicleId}`);
    } catch (err) {
      console.error('Error creating timeline event:', err);
      setError('Failed to create timeline event. Please try again.');
      setSubmitting(false);
    }
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.8) return 'High Confidence';
    if (score >= 0.5) return 'Medium Confidence';
    return 'Low Confidence';
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Add Timeline Event</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Event Type*
          </label>
          <select
            {...register('event_type')}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          >
            <option value="">Select event type...</option>
            <option value="purchase">Purchase</option>
            <option value="sale">Sale</option>
            <option value="service">Service</option>
            <option value="repair">Repair</option>
            <option value="restoration">Restoration</option>
            <option value="inspection">Inspection</option>
            <option value="modification">Modification</option>
            <option value="registration">Registration</option>
            <option value="accident">Accident</option>
            <option value="milestone">Milestone</option>
            <option value="custom">Custom</option>
          </select>
          {errors.event_type && (
            <p className="text-red-500 text-xs italic mt-1">{errors.event_type.message}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Title*
          </label>
          <input
            {...register('title')}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            type="text"
            placeholder="Event title"
          />
          {errors.title && (
            <p className="text-red-500 text-xs italic mt-1">{errors.title.message}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Date*
          </label>
          <input
            {...register('event_date')}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            type="date"
          />
          {errors.event_date && (
            <p className="text-red-500 text-xs italic mt-1">{errors.event_date.message}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Description
          </label>
          <textarea
            {...register('description')}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            rows={4}
            placeholder="Detailed description of the event"
          />
          {errors.description && (
            <p className="text-red-500 text-xs italic mt-1">{errors.description.message}</p>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Location
            </label>
            <input
              {...register('location')}
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              type="text"
              placeholder="Where this event occurred"
            />
            {errors.location && (
              <p className="text-red-500 text-xs italic mt-1">{errors.location.message}</p>
            )}
          </div>
          
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Source
            </label>
            <input
              {...register('source')}
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              type="text"
              placeholder="Source of information"
            />
            {errors.source && (
              <p className="text-red-500 text-xs italic mt-1">{errors.source.message}</p>
            )}
          </div>
        </div>
        
        <div className="mb-6">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Confidence Score: {getConfidenceLabel(confidenceScore)} ({Math.round(confidenceScore * 100)}%)
          </label>
          <div className="flex items-center">
            <span className="mr-2 text-xs">Low</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              {...register('confidence_score', { valueAsNumber: true })}
              className="w-full"
            />
            <span className="ml-2 text-xs">High</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
            <div 
              className={`h-2.5 rounded-full ${getConfidenceColor(confidenceScore)}`}
              style={{ width: `${confidenceScore * 100}%` }}
            ></div>
          </div>
        </div>
        
        {/* Dynamic fields based on event type */}
        {eventType === 'purchase' && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-bold mb-2">Purchase Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Purchase Price
                </label>
                <input
                  type="number"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Purchase price"
                  onChange={(e) => {
                    const metadata = watch('metadata') || {};
                    setValue('metadata', {
                      ...metadata,
                      purchase_price: parseFloat(e.target.value)
                    });
                  }}
                />
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Seller Name
                </label>
                <input
                  type="text"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Seller name"
                  onChange={(e) => {
                    const metadata = watch('metadata') || {};
                    setValue('metadata', {
                      ...metadata,
                      seller_name: e.target.value
                    });
                  }}
                />
              </div>
            </div>
          </div>
        )}
        
        {eventType === 'service' && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-bold mb-2">Service Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Service Type
                </label>
                <select
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  onChange={(e) => {
                    const metadata = watch('metadata') || {};
                    setValue('metadata', {
                      ...metadata,
                      service_type: e.target.value
                    });
                  }}
                >
                  <option value="">Select service type...</option>
                  <option value="oil_change">Oil Change</option>
                  <option value="tire_rotation">Tire Rotation</option>
                  <option value="brake_service">Brake Service</option>
                  <option value="inspection">Inspection</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Service Cost
                </label>
                <input
                  type="number"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="Service cost"
                  onChange={(e) => {
                    const metadata = watch('metadata') || {};
                    setValue('metadata', {
                      ...metadata,
                      service_cost: parseFloat(e.target.value)
                    });
                  }}
                />
              </div>
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => navigate(`/vehicles/${vehicleId}`)}
            className="mr-4 text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline ${
              submitting ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {submitting ? 'Saving...' : 'Save Event'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TimelineEventForm;

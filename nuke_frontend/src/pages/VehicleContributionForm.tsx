import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ModerationService } from '../services/moderationService';
import { supabase } from '../lib/supabase';
import type { SubmissionType, CreateSubmissionData } from '../types/moderation';
import AppLayout from '../components/layout/AppLayout';

const VehicleContributionForm: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);
  const [loading, setLoading] = useState(false);
  const [submissionType, setSubmissionType] = useState<SubmissionType>('photo');
  const [formData, setFormData] = useState({
    submission_context: '',
    contributor_credit: '',
    description: '',
    venue_name: '',
    city: '',
    state: '',
    photos: [] as File[]
  });

  useEffect(() => {
    // Pre-fill contributor credit if user is logged in
    if (user?.email) {
      setFormData(prev => ({
        ...prev,
        contributor_credit: user.email.split('@')[0] // Use username part of email
      }));
    }
  }, [user]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setFormData(prev => ({
      ...prev,
      photos: [...prev.photos, ...files]
    }));
  };

  const removePhoto = (index: number) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;

    setLoading(true);
    try {
      // Prepare content data based on submission type
      let contentData: Record<string, any> = {
        description: formData.description
      };

      // Handle photo submissions
      if (submissionType === 'photo' && formData.photos.length > 0) {
        // Upload photos to Supabase storage using the universal image service
        const { ImageUploadService } = await import('../services/imageUploadService');

        const uploadedPhotos = [];
        for (const photo of formData.photos) {
          const result = await ImageUploadService.uploadImage(vehicleId, photo, 'contribution');
          if (result.success && result.imageUrl) {
            uploadedPhotos.push({
              name: photo.name,
              size: photo.size,
              type: photo.type,
              url: result.imageUrl,
              id: result.imageId
            });
          }
        }

        contentData.photos = uploadedPhotos;
        contentData.photo_count = uploadedPhotos.length;
      }

      // Handle data corrections
      if (submissionType === 'data_correction') {
        // Add specific fields for data corrections
        contentData.correction_type = formData.correction_type || 'general';
        contentData.field_name = formData.field_name;
        contentData.current_value = formData.current_value;
        contentData.proposed_value = formData.proposed_value;
        contentData.correction_reason = formData.correction_reason;
      }

      // Handle timeline events
      if (submissionType === 'timeline_event') {
        contentData.event_title = formData.description;
        contentData.event_date = new Date().toISOString();
      }

      const submissionData: CreateSubmissionData = {
        vehicle_id: vehicleId,
        submission_type: submissionType,
        content_data: contentData,
        submission_context: formData.submission_context,
        location_data: formData.venue_name || formData.city ? {
          venue_name: formData.venue_name,
          city: formData.city,
          state: formData.state
        } : undefined,
        contributor_credit: formData.contributor_credit
      };

      const result = await ModerationService.submitContent(submissionData);
      
      if (result) {
        alert('Your contribution has been submitted for review!');
        navigate(`/vehicle/${vehicleId}`);
      } else {
        alert('Failed to submit contribution. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting contribution:', error);
      alert('Error submitting contribution. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderSubmissionTypeSelector = () => (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        What would you like to contribute?
      </label>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { value: 'photo', label: '📸 Photos', desc: 'Share photos of this vehicle' },
          { value: 'data_correction', label: '✏️ Correction', desc: 'Fix incorrect information' },
          { value: 'timeline_event', label: '📅 Event', desc: 'Add timeline event' },
          { value: 'comment', label: '💬 Comment', desc: 'General comment or note' }
        ].map(({ value, label, desc }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSubmissionType(value as SubmissionType)}
            className={`p-3 border rounded-lg text-left transition-colors ${
              submissionType === value
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="font-medium text-sm">{label}</div>
            <div className="text-xs text-gray-600 mt-1">{desc}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderPhotoUpload = () => {
    if (submissionType !== 'photo') return null;

    return (
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Upload Photos
        </label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handlePhotoUpload}
            className="hidden"
            id="photo-upload"
          />
          <label
            htmlFor="photo-upload"
            className="cursor-pointer flex flex-col items-center"
          >
            <div className="text-4xl mb-2">📸</div>
            <div className="text-sm font-medium text-gray-700">
              Click to upload photos
            </div>
            <div className="text-xs text-gray-500 mt-1">
              PNG, JPG, GIF up to 10MB each
            </div>
          </label>
        </div>

        {formData.photos.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            {formData.photos.map((photo, index) => (
              <div key={index} className="relative">
                <img
                  src={URL.createObjectURL(photo)}
                  alt={`Upload ${index + 1}`}
                  className="w-full h-24 object-cover rounded"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto py-8">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Contribute to Vehicle Profile
            </h1>
            <p className="text-gray-600">
              Help improve this vehicle's profile by sharing photos, corrections, or additional information.
              All contributions are reviewed by the vehicle owner before being published.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {renderSubmissionTypeSelector()}
            {renderPhotoUpload()}

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {submissionType === 'photo' ? 'Photo Description' :
                 submissionType === 'data_correction' ? 'What needs to be corrected?' :
                 submissionType === 'timeline_event' ? 'Event Title' :
                 'Comment'}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={
                  submissionType === 'photo' ? 'Describe the photos you\'re sharing...' :
                  submissionType === 'data_correction' ? 'Explain what information is incorrect and what it should be...' :
                  submissionType === 'timeline_event' ? 'What happened and when?' :
                  'Share your thoughts or additional information...'
                }
                required
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Context (Optional)
              </label>
              <input
                type="text"
                value={formData.submission_context}
                onChange={(e) => setFormData(prev => ({ ...prev, submission_context: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 'Pebble Beach Concours 2024', 'Cars & Coffee', 'Owner's garage'"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Venue/Location (Optional)
                </label>
                <input
                  type="text"
                  value={formData.venue_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, venue_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Event name or venue"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="City"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  State
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="State"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                How should we credit you?
              </label>
              <input
                type="text"
                value={formData.contributor_credit}
                onChange={(e) => setFormData(prev => ({ ...prev, contributor_credit: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your name or username"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                This will be displayed publicly if your contribution is approved
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary flex-1"
              >
                {loading ? 'Submitting...' : 'Submit Contribution'}
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2">Review Process</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Your contribution will be reviewed by the vehicle owner</li>
              <li>• Approved contributions will appear on the public profile</li>
              <li>• You'll build reputation points for approved contributions</li>
              <li>• High-quality contributors may receive special badges</li>
            </ul>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default VehicleContributionForm;

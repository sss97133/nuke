import React, { useState } from 'react';
import type { CommentService } from '../services/CommentService';

interface TimelineEventEditorProps {
  eventId: string;
  currentTitle: string;
  currentDescription: string;
  currentUser: { id: string; username?: string } | null;
  eventCreatorId: string;
  vehicleOwnerId: string;
  onSave: (title: string, description: string) => void;
  onCancel: () => void;
}

const TimelineEventEditor: React.FC<TimelineEventEditorProps> = ({
  eventId,
  currentTitle,
  currentDescription,
  currentUser,
  eventCreatorId,
  vehicleOwnerId,
  onSave,
  onCancel
}) => {
  const [title, setTitle] = useState(currentTitle);
  const [description, setDescription] = useState(currentDescription || '');
  const [saving, setSaving] = useState(false);

  const canEdit = currentUser && (
    currentUser.id === eventCreatorId || 
    currentUser.id === vehicleOwnerId
  );

  const handleSave = async () => {
    if (!canEdit || saving) return;

    setSaving(true);
    
    // Update event notes/description
    if (currentUser.id === eventCreatorId && description !== currentDescription) {
      const result = await CommentService.updateEventNotes(eventId, description, currentUser.id);
      if (!result.success) {
        alert(result.error || 'Failed to update notes');
        setSaving(false);
        return;
      }
    }

    onSave(title, description);
    setSaving(false);
  };

  if (!canEdit) {
    return (
      <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded">
        You don't have permission to edit this event
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 bg-gray-50 rounded">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Event Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-sm border rounded px-2 py-1"
          placeholder="Event title..."
          disabled={saving}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Notes & Context
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full text-sm border rounded px-2 py-1 resize-none"
          rows={3}
          placeholder="Add detailed notes, context, or observations about this event..."
          disabled={saving}
        />
        <div className="text-xs text-gray-500 mt-1">
          {currentUser.id === eventCreatorId ? (
            'As the event creator, you can add detailed context and notes.'
          ) : currentUser.id === vehicleOwnerId ? (
            'As the vehicle owner, you can edit the title and add your perspective.'
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="bg-primary text-white px-3 py-1 rounded text-xs hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs hover:bg-gray-400 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default TimelineEventEditor;

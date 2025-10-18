import React, { useState, useCallback } from 'react';
import { extractImageMetadata, reverseGeocode, getEventDateFromImages, getEventLocationFromImages, type ImageMetadata } from '../utils/imageMetadata';
import { supabase } from '../lib/supabase';
import { ImageUploadService } from '../services/imageUploadService';

interface AddEventWizardProps {
  vehicleId: string;
  onEventAdded: (event: any) => void;
  onClose: () => void;
  currentUser: any;
}

const AddEventWizard: React.FC<AddEventWizardProps> = ({
  vehicleId,
  onEventAdded,
  onClose,
  currentUser
}) => {
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{[key: number]: number}>({});
  const [uploadStatus, setUploadStatus] = useState<{[key: number]: 'pending' | 'uploading' | 'completed' | 'error'}>({});
  const [eventData, setEventData] = useState({
    title: '',
    description: '',
    event_type: 'maintenance',
    event_date: '',
    location: ''
  });
  const [sensitivityHints, setSensitivityHints] = useState<Record<number, {isSensitive: boolean; type?: string}>>({});
  const [groups, setGroups] = useState<Array<{ date: string; files: File[]; stage: string; event_type?: string }>>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const GAP_MINUTES_DEFAULT = 60; // time gap threshold for auto-splitting
  const [splitGapMinutes, setSplitGapMinutes] = useState<number>(GAP_MINUTES_DEFAULT);
  const [splitResultInfo, setSplitResultInfo] = useState<Record<number, number>>({});
  const [allowDuplicates, setAllowDuplicates] = useState<boolean>(false);
  const [selectionLog, setSelectionLog] = useState<Array<{ name: string; size: number; status: 'added' | 'duplicate' | 'dropped'; reason?: string }>>([]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileSelect(e.target.files);
    }
  }, []);

  async function handleFileSelect(files: FileList | File[]) {
    const incoming = Array.from(files);
    const log: Array<{ name: string; size: number; status: 'added' | 'duplicate' | 'dropped'; reason?: string }> = [];
    // Best-effort classify images (accept common image types and HEIC/HEIF even if browser reports differently)
    const isLikelyImage = (f: File) => {
      if (f.type.startsWith('image/')) return true;
      const n = f.name.toLowerCase();
      return n.endsWith('.heic') || n.endsWith('.heif') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png') || n.endsWith('.webp') || n.endsWith('.gif') || n.endsWith('.bmp') || n.endsWith('.tiff');
    };

    // Append to existing and handle dedup per toggle
    const existing = selectedFiles || [];
    const keyOf = (f: File) => `${f.name}__${f.size}__${f.lastModified}`;
    const existingKeys = new Set(existing.map(keyOf));
    const next: File[] = [...existing];

    for (const f of incoming) {
      if (!isLikelyImage(f)) {
        log.push({ name: f.name, size: f.size, status: 'dropped', reason: 'not an image' });
        continue;
      }
      const k = keyOf(f);
      if (!allowDuplicates && (existingKeys.has(k) || next.some(x => keyOf(x) === k))) {
        log.push({ name: f.name, size: f.size, status: 'duplicate', reason: 'same name/size/date' });
        continue;
      }
      next.push(f);
      log.push({ name: f.name, size: f.size, status: 'added' });
    }

    setSelectedFiles(next);
    setSelectionLog(prev => [...prev, ...log]);
    setExtracting(true);

    console.log('Processing', next.length, 'files for metadata extraction');

    try {
      // Extract metadata from all images
      const metadataPromises = next.map((file: File) => extractImageMetadata(file));
      const metadata = await Promise.all(metadataPromises);
      setImageMetadata(metadata);

      console.log('Extracted metadata from all files:', metadata);

      // Auto-populate event data from metadata
      const eventDate = getEventDateFromImages(metadata);
      const eventLocation = getEventLocationFromImages(metadata);
      
      console.log('Derived event date:', eventDate);
      console.log('Derived event location:', eventLocation);
      
      let locationString = '';
      if (eventLocation) {
        console.log('Reverse geocoding coordinates:', eventLocation.latitude, eventLocation.longitude);
        locationString = await reverseGeocode(eventLocation.latitude, eventLocation.longitude) || '';
        console.log('Reverse geocoded address:', locationString);
      }

      const newEventData = {
        ...eventData,
        event_date: eventDate ? eventDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        location: locationString,
        title: `Photo set from ${eventDate ? eventDate.toLocaleDateString() : 'today'}`
      };

      console.log('Setting event data:', newEventData);
      setEventData(newEventData);

      // Build groups by date (yyyy-mm-dd)
      const byDate: Record<string, File[]> = {};
      next.forEach((f: File, idx: number) => {
        const d = metadata[idx]?.dateTaken || new Date(f.lastModified);
        const key = new Date(d).toISOString().split('T')[0];
        byDate[key] = byDate[key] || [];
        byDate[key].push(f);
      });
      const built = Object.entries(byDate).map(([date, fs]) => ({ date, files: fs, stage: 'discovery', event_type: 'maintenance' }));
      setGroups(built);
      setBulkMode(built.length > 1 || next.length > 50);

      setStep('review');
    } catch (error) {
      console.error('Error extracting metadata:', error);
      alert('Error extracting metadata from images. Please try again.');
    } finally {
      setExtracting(false);
    }
  }

  // Helper: find representative GPS coords for a group from the currently loaded EXIF metadata
  const getGroupCoordinates = (grp: { files: File[] }): { latitude: number; longitude: number } | null => {
    try {
      // Build a quick index from file -> metadata
      const index: Map<File, ImageMetadata | undefined> = new Map();
      selectedFiles.forEach((f, i) => index.set(f, imageMetadata[i]));
      for (const f of grp.files) {
        const md = index.get(f);
        const loc = md?.location as any;
        if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
          return { latitude: loc.latitude, longitude: loc.longitude };
        }
      }
    } catch {}
    return null;
  };

  // Helper: get timestamp for a file using imageMetadata (fallback to lastModified)
  const getFileTimestamp = (file: File): number => {
    const idx = selectedFiles.indexOf(file);
    if (idx >= 0) {
      const m = imageMetadata[idx];
      if (m?.dateTaken) return m.dateTaken.getTime();
    }
    return file.lastModified;
  };

  // Auto-split a date group by time gaps (>= 60 minutes)
  const autoSplitGroup = (groupIndex: number, gapMinutes: number = splitGapMinutes) => {
    setGroups(prev => {
      const g = prev[groupIndex];
      if (!g) return prev;
      // Sort files by timestamp
      const filesSorted = [...g.files].sort((a, b) => getFileTimestamp(a) - getFileTimestamp(b));
      const buckets: File[][] = [];
      let current: File[] = [];
      let lastTs: number | null = null;
      const gapMs = gapMinutes * 60 * 1000;
      for (const f of filesSorted) {
        const ts = getFileTimestamp(f);
        if (lastTs !== null && ts - lastTs >= gapMs && current.length > 0) {
          buckets.push(current);
          current = [];
        }
        current.push(f);
        lastTs = ts;
      }
      if (current.length > 0) buckets.push(current);
      if (buckets.length <= 1) {
        // update feedback: 1 means no split
        setSplitResultInfo(info => ({ ...info, [groupIndex]: 1 }));
        return prev; // nothing to split
      }
      const replacement = buckets.map(fs => ({ date: g.date, files: fs, stage: g.stage, event_type: g.event_type }));
      const next = [...prev.slice(0, groupIndex), ...replacement, ...prev.slice(groupIndex + 1)];
      setSplitResultInfo(info => ({ ...info, [groupIndex]: replacement.length }));
      return next;
    });
  };

  const uploadEventFilesFor = async (eventId: string, filesForEvent: File[], stageOverride?: string): Promise<string[]> => {
    const urls: string[] = [];
    
    // Initialize upload status for all files
    const initialStatus: {[key: number]: 'pending' | 'uploading' | 'completed' | 'error'} = {};
    filesForEvent.forEach((_, index) => {
      initialStatus[index] = 'pending';
    });
    setUploadStatus(initialStatus);
    
    // Upload files sequentially to provide better progress feedback
    for (let index = 0; index < filesForEvent.length; index++) {
      const file = filesForEvent[index];
      
      try {
        setUploadStatus(prev => ({ ...prev, [index]: 'uploading' }));
        setUploadProgress(prev => ({ ...prev, [index]: 0 }));
        
        // Simulate progress for better UX
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            const current = prev[index] || 0;
            const newProgress = Math.min(current + Math.random() * 30, 95);
            return { ...prev, [index]: newProgress };
          });
        }, 200);

        // Use the clean upload service (handles EXIF, correct bucket, proper URLs)
        const result = await ImageUploadService.uploadImage(vehicleId, file, 'work_session');

        clearInterval(progressInterval);

        if (!result.success) {
          console.error('Error uploading file:', result.error);
          setUploadStatus(prev => ({ ...prev, [index]: 'error' }));
          continue;
        }
        
        // Extract EXIF data for this specific file
        const metadata = imageMetadata[index];
        const exifData = metadata ? {
          dateTaken: metadata.dateTaken,
          location: metadata.location,
          camera: metadata.camera,
          technical: metadata.technical
        } : null;
        
        // Get current session to ensure proper user_id
        const { data: { session } } = await supabase.auth.getSession();
        
        // Determine if the vehicle already has a primary image
        const { data: existingPrimary } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('is_primary', true)
          .limit(1);

        const makePrimary = !existingPrimary || existingPrimary.length === 0;

        // Store image record in database with EXIF metadata preserved
        const { error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            user_id: session?.user?.id,
            image_url: result.imageUrl,
            is_primary: makePrimary && index === 0,
            process_stage: stageOverride || 'discovery',
            exif_data: exifData
          });
        
        if (imageError) {
          console.error('Error storing image metadata:', imageError);
        }
        // Notify other components to refresh gallery
        try {
          window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } }));
        } catch {}
        
        urls.push(result.imageUrl!);
        setUploadStatus(prev => ({ ...prev, [index]: 'completed' }));
        setUploadProgress(prev => ({ ...prev, [index]: 100 }));
        
      } catch (error) {
        console.error('Error uploading file:', error);
        setUploadStatus(prev => ({ ...prev, [index]: 'error' }));
      }
    }
    
    return urls;
  };

  const handleSubmit = async () => {
    if (submitting) {
      console.log('Already submitting, ignoring duplicate submission');
      return;
    }
    
    setSubmitting(true);
    console.log('Starting event creation...');
    console.log('Event data:', eventData);
    console.log('Current user:', currentUser);
    console.log('Selected files:', selectedFiles);
    console.log('Image metadata:', imageMetadata);

    try {
      // Bulk mode: one event per date-group; otherwise single event
      const groupList = (bulkMode && groups.length > 0) ? groups : [{ date: eventData.event_date, files: selectedFiles, stage: 'discovery', event_type: eventData.event_type }];

      for (const grp of groupList) {
        // Create event per group
        const isLife = (grp.event_type || eventData.event_type) === 'life';
        const coords = getGroupCoordinates(grp);
        const eventPayload = {
          vehicle_id: vehicleId,
          event_type: (grp.event_type || eventData.event_type || 'maintenance'),
          source: 'user_input',
          event_date: grp.date,
          title: `Photo set from ${new Date(grp.date).toLocaleDateString()}`,
          description: eventData.description || null,
          user_id: currentUser?.id,
          metadata: {
            created_by: 'wizard_upload',
            image_count: grp.files.length,
            location: eventData.location,
            stage: grp.stage,
            category: isLife ? 'life' : 'work',
            ...(coords ? { location_coords: coords } : {}),
            contributors: [
              { user_id: currentUser?.id, role: 'photographer', weight: 1, source: 'wizard_upload' }
            ],
            creator_info: {
              user_id: currentUser?.id,
              email: currentUser?.email,
              name: currentUser?.name,
              created_via: 'metadata_wizard',
              timestamp: new Date().toISOString()
            }
          }
        };

        const { data: eventRecord, error } = await supabase
          .from('vehicle_timeline_events')
          .insert([eventPayload])
          .select()
          .single();

        if (error) {
          console.error('Database error creating event:', error);
          alert(`Failed to create event: ${error.message}`);
          continue;
        }

        // Upload group files
        const uploadedUrls = await uploadEventFilesFor(eventRecord.id, grp.files, grp.stage);
        if (uploadedUrls.length > 0) {
          await supabase
            .from('vehicle_timeline_events')
            .update({ 
              image_urls: uploadedUrls,
              metadata: {
                ...eventRecord.metadata,
                uploaded_images: uploadedUrls.length
              }
            })
            .eq('id', eventRecord.id);
        }

        // Log user activity for propagation to agent profile timeline
        try {
          await supabase
            .from('user_activity')
            .insert({
              user_id: currentUser?.id || null,
              activity_type: 'created_event',
              vehicle_id: vehicleId,
              event_id: eventRecord.id,
              title: `Created event '${eventRecord.title}'`,
              metadata: { image_count: uploadedUrls.length, stage: grp.stage, source: 'wizard_upload' }
            });
          if ((uploadedUrls.length || 0) > 0) {
            await supabase
              .from('user_activity')
              .insert({
                user_id: currentUser?.id || null,
                activity_type: 'photography',
                vehicle_id: vehicleId,
                event_id: eventRecord.id,
                title: `Photographed ${uploadedUrls.length} image${uploadedUrls.length>1?'s':''}`,
                metadata: { image_count: uploadedUrls.length, stage: grp.stage }
              });
          }
        } catch {}

        onEventAdded({ ...eventRecord, image_urls: uploadedUrls });
      }

      console.log('Closing wizard...');
      try { window.dispatchEvent(new CustomEvent('timeline_events_created', { detail: { vehicleId, count: selectedFiles.length, dates: groups.map(g=>g.date) } })); } catch {}
      onClose();
    } catch (error) {
      console.error('Unexpected error in handleSubmit:', error);
      alert(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'upload') {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <div className="modal-header">
            <h3 className="modal-title">Add Event - Upload Photos</h3>
          </div>
          
          <div className="modal-body">
            <div className="flex items-center justify-between mb-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />
                Allow duplicates (same name/size/date)
              </label>
              {selectionLog.length > 0 && (
                <div className="text-xs text-gray-600">
                  Added {selectionLog.filter(l => l.status==='added').length} • Duplicates {selectionLog.filter(l => l.status==='duplicate').length} • Dropped {selectionLog.filter(l => l.status==='dropped').length}
                </div>
              )}
            </div>
            {/* Drag and drop area */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                extracting ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => e.preventDefault()}
              onDragLeave={(e) => e.preventDefault()}
            >
              {extracting ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                  <p className="text-lg font-bold text-blue-700">Processing Images...</p>
                  <p className="text-sm text-gray-600">Extracting EXIF data and location information</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-4xl text-gray-400">+</div>
                  <div>
                    <p className="text-lg font-medium text-gray-700">Drop images here or click to browse</p>
                    <p className="text-sm text-gray-500">Up to 10 images, max 10MB each</p>
                  </div>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.heic,.heif"
                    onChange={handleFileInput}
                    className="hidden"
                    id="event-image-upload"
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('event-image-upload')?.click()}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Choose Images
                  </button>
                </div>
              )}
            </div>

            {selectionLog.length > 0 && (
              <div className="mt-3 p-2 bg-gray-50 rounded border">
                <div className="text-sm font-medium mb-1">Image Selection Log</div>
                <div className="text-xs text-gray-600 max-h-40 overflow-y-auto">
                  {selectionLog.slice(-200).map((entry, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="truncate" title={entry.name}>{entry.name}</span>
                      <span className={entry.status==='dropped' ? 'text-red-600' : entry.status==='duplicate' ? 'text-orange-600' : 'text-green-600'}>
                        {entry.status}{entry.reason ? ` — ${entry.reason}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button onClick={onClose} className="button button-secondary">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Review Event Details</h3>
        
        {/* Image previews with metadata */}
        <div className="mb-6">
          <h4 className="font-medium mb-2">Photos ({selectedFiles.length})</h4>
          <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
            {selectedFiles.map((file, index) => {
              const metadata = imageMetadata[index];
              return (
                <div key={index} className="relative">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-20 object-cover rounded"
                    style={sensitivityHints[index]?.isSensitive ? { filter: 'blur(6px)' } : undefined}
                  />
                  {metadata?.dateTaken && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white text-xs p-1">
                      {metadata.dateTaken.toLocaleDateString()}
                    </div>
                  )}
                  {sensitivityHints[index]?.isSensitive && (
                    <div className="absolute top-0 left-0 m-1 px-1.5 py-0.5 text-[10px] rounded bg-red-600 text-white">
                      Sensitive{sensitivityHints[index]?.type ? ` • ${sensitivityHints[index]?.type}` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Event form */}
        <div className="space-y-4">
          {bulkMode && groups.length > 0 && (
            <div className="p-3 bg-gray-50 rounded border">
              <div className="text-sm font-medium mb-2">Bulk Mode: {groups.length} date groups detected</div>
              <div className="space-y-2">
                {groups.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-semibold">{new Date(g.date).toLocaleDateString()}</div>
                      <div className="text-gray-500">{g.files.length} photos</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
                        onClick={() => autoSplitGroup(i)}
                        title={`Auto-split by ${splitGapMinutes} minute gaps`}
                      >
                        Auto-Split
                      </button>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={splitGapMinutes}
                        onChange={(e) => setSplitGapMinutes(Math.max(5, Number(e.target.value) || GAP_MINUTES_DEFAULT))}
                        className="w-16 text-right text-xs border rounded px-1 py-0.5"
                        title="Gap (minutes)"
                      />
                      {typeof splitResultInfo[i] !== 'undefined' && (
                        <span className="text-xs text-gray-500">→ {splitResultInfo[i]} group{(splitResultInfo[i]||0) > 1 ? 's' : ''}</span>
                      )}
                      <label className="text-gray-600">Stage:</label>
                      <select
                        value={g.stage}
                        onChange={(e) => setGroups(prev => prev.map((x, idx) => idx === i ? { ...x, stage: e.target.value } : x))}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        <option value="discovery">Discovery</option>
                        <option value="disassembly">Disassembly</option>
                        <option value="metalwork">Metalwork</option>
                        <option value="bodywork">Bodywork</option>
                        <option value="paint_prep">Paint Prep</option>
                        <option value="paint_stage1">Paint Stage 1</option>
                        <option value="paint_stage2">Paint Stage 2</option>
                        <option value="mechanical">Mechanical</option>
                        <option value="wiring">Wiring</option>
                        <option value="upholstery">Upholstery</option>
                        <option value="undercarriage">Undercarriage</option>
                        <option value="reassembly">Reassembly</option>
                        <option value="final">Final</option>
                      </select>
                      <label className="text-gray-600">Type:</label>
                      <select
                        value={g.event_type || 'maintenance'}
                        onChange={(e) => setGroups(prev => prev.map((x, idx) => idx === i ? { ...x, event_type: e.target.value } : x))}
                        className="border rounded px-2 py-1 text-sm"
                        title="Choose 'Life' for family/life moments"
                      >
                        <option value="maintenance">Work</option>
                        <option value="life">Life</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!bulkMode && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Event Title
                </label>
                <input
                  type="text"
                  value={eventData.title}
                  onChange={(e) => setEventData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Event Type
                </label>
                <select
                  value={eventData.event_type}
                  onChange={(e) => setEventData(prev => ({ ...prev, event_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="maintenance">Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="modification">Modification</option>
                  <option value="inspection">Inspection</option>
                  <option value="accident">Accident</option>
                  <option value="purchase">Purchase</option>
                  <option value="sale">Sale</option>
                  <option value="life">Life</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Event Date
                  {imageMetadata.some(m => m.dateTaken) && (
                    <span className="text-green-600 text-xs ml-1">(from photo metadata)</span>
                  )}
                </label>
                <input
                  type="date"
                  value={eventData.event_date}
                  onChange={(e) => setEventData(prev => ({ ...prev, event_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
              {imageMetadata.some(m => m.location) && (
                <span className="text-green-600 text-xs ml-1">(from photo GPS)</span>
              )}
            </label>
            <input
              type="text"
              value={eventData.location}
              onChange={(e) => setEventData(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Location (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={eventData.description}
              onChange={(e) => setEventData(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              placeholder="Additional details about this event..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Metadata summary */}
        {imageMetadata.length > 0 && (
          <div className="mt-4 p-3 bg-gray-50 rounded-md">
            <h5 className="text-sm font-medium text-gray-700 mb-2">Extracted Metadata:</h5>
            <div className="text-xs text-gray-600 space-y-1">
              {selectionLog.length > 0 && (
                <div className="mb-2 p-2 bg-white border rounded">
                  <div className="font-medium">Selection Summary</div>
                  <div>Added {selectionLog.filter(l => l.status==='added').length} • Duplicates {selectionLog.filter(l => l.status==='duplicate').length} • Dropped {selectionLog.filter(l => l.status==='dropped').length}</div>
                </div>
              )}
              {imageMetadata.some(m => m.dateTaken) ? (
                <div className="text-green-600">✅ Date range: {
                  imageMetadata
                    .filter(m => m.dateTaken)
                    .map(m => m.dateTaken!.toLocaleDateString())
                    .join(' - ')
                }</div>
              ) : (
                <div className="text-orange-600">⚠️ No date information found in photos</div>
              )}
              
              {imageMetadata.some(m => m.location) ? (
                <div className="text-green-600">✅ GPS coordinates found in {imageMetadata.filter(m => m.location).length} photos</div>
              ) : (
                <div className="text-orange-600">⚠️ No GPS location data found in photos</div>
              )}
              
              {imageMetadata.some(m => m.camera) ? (
                <div className="text-green-600">✅ Camera: {imageMetadata.find(m => m.camera)?.camera?.make} {imageMetadata.find(m => m.camera)?.camera?.model}</div>
              ) : (
                <div className="text-gray-500">ℹ️ No camera information found</div>
              )}
              
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="text-xs text-gray-500">
                  📊 Processed {imageMetadata.length} image{imageMetadata.length !== 1 ? 's' : ''}
                  {!imageMetadata.some(m => m.dateTaken || m.location) && (
                    <div className="mt-1 text-orange-600">
                      💡 Tip: For best results, use photos taken with a smartphone or camera that includes EXIF data
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Progress */}
        {submitting && (
          <div className="mt-6 p-4 bg-blue-50 rounded-md">
            <h4 className="font-medium text-blue-900 mb-3">Uploading Photos...</h4>
            <div className="space-y-2">
              {selectedFiles.map((file, index) => {
                const status = uploadStatus[index] || 'pending';
                const progress = uploadProgress[index] || 0;
                
                return (
                  <div key={index} className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-4 h-4">
                      {status === 'pending' && <div className="w-4 h-4 bg-gray-300 rounded-full"></div>}
                      {status === 'uploading' && <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>}
                      {status === 'completed' && <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">✓</div>}
                      {status === 'error' && <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">✗</div>}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-700 truncate">{file.name}</div>
                      {status === 'uploading' && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                          <div 
                            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-shrink-0 text-xs text-gray-500">
                      {status === 'pending' && 'Waiting...'}
                      {status === 'uploading' && `${Math.round(progress)}%`}
                      {status === 'completed' && 'Done'}
                      {status === 'error' && 'Failed'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end space-x-2 mt-6">
          <button
            onClick={() => setStep('upload')}
            disabled={submitting}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Creating Event...</span>
              </>
            ) : (
              <span>Create Event</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddEventWizard;

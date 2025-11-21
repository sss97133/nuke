// Manual Annotation Viewer
// Shows relevant manual pages when clicking "Annotation" on a labeled image

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ManualPage {
  manual_id: string;
  manual_title: string;
  manual_type: string;
  manual_url: string;
  page_number: number | null;
  section_title: string | null;
  part_name: string | null;
  system_area: string | null;
  diagram_type: string | null;
  diagram_image_url: string | null;
  match_reason: string;
  match_confidence: number;
}

interface ManualAnnotationViewerProps {
  imageId: string;
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ManualAnnotationViewer: React.FC<ManualAnnotationViewerProps> = ({
  imageId,
  vehicleId,
  isOpen,
  onClose
}) => {
  const [manualPages, setManualPages] = useState<ManualPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<ManualPage | null>(null);

  useEffect(() => {
    if (isOpen && imageId) {
      loadManualPages();
    }
  }, [isOpen, imageId]);

  const loadManualPages = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.functions.invoke('get-manual-pages', {
        body: { imageId }
      });

      if (fetchError) throw fetchError;

      if (data?.manuals) {
        setManualPages(data.manuals);
        if (data.manuals.length > 0) {
          setSelectedPage(data.manuals[0]); // Select highest confidence match
        }
      } else {
        setManualPages([]);
      }
    } catch (err: any) {
      console.error('Error loading manual pages:', err);
      setError(err.message || 'Failed to load manual pages');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold">Manual References</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Sidebar - Manual List */}
          <div className="w-80 border-r overflow-y-auto p-4">
            {loading && (
              <div className="text-center text-gray-500 py-8">Loading manuals...</div>
            )}

            {error && (
              <div className="text-red-500 text-sm p-4 bg-red-50 rounded">
                {error}
              </div>
            )}

            {!loading && !error && manualPages.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <p className="mb-2">No manuals available for this vehicle</p>
                <p className="text-sm">Upload manuals to see assembly diagrams and part references</p>
              </div>
            )}

            {manualPages.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-gray-600 mb-3">
                  {manualPages.length} reference{manualPages.length !== 1 ? 's' : ''} found
                </div>
                {manualPages.map((page, idx) => (
                  <div
                    key={`${page.manual_id}-${page.page_number || idx}`}
                    onClick={() => setSelectedPage(page)}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      selectedPage?.manual_id === page.manual_id &&
                      selectedPage?.page_number === page.page_number
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm mb-1">{page.manual_title}</div>
                    <div className="text-xs text-gray-600 mb-1">
                      {page.manual_type.replace('_', ' ')}
                    </div>
                    {page.page_number && (
                      <div className="text-xs text-gray-500 mb-1">
                        Page {page.page_number}
                      </div>
                    )}
                    {page.section_title && (
                      <div className="text-xs text-gray-700 mb-1">
                        {page.section_title}
                      </div>
                    )}
                    {page.part_name && (
                      <div className="text-xs font-medium text-blue-600 mb-1">
                        Part: {page.part_name}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500">
                        {page.match_reason}
                      </span>
                      <span className="text-xs font-medium text-green-600">
                        {page.match_confidence}% match
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Main - Manual Viewer */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedPage ? (
              <>
                {/* Manual Info Bar */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{selectedPage.manual_title}</h3>
                      {selectedPage.page_number && (
                        <p className="text-sm text-gray-600">
                          Page {selectedPage.page_number}
                          {selectedPage.section_title && ` • ${selectedPage.section_title}`}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-600">
                        {selectedPage.match_confidence}% confidence
                      </div>
                      <div className="text-xs text-gray-500">
                        {selectedPage.match_reason}
                      </div>
                    </div>
                  </div>
                </div>

                {/* PDF Viewer or Image */}
                <div className="flex-1 overflow-auto bg-gray-100 p-4">
                  {selectedPage.diagram_image_url ? (
                    // Show extracted diagram image
                    <div className="flex items-center justify-center h-full">
                      <img
                        src={selectedPage.diagram_image_url}
                        alt={selectedPage.section_title || 'Manual diagram'}
                        className="max-w-full max-h-full object-contain shadow-lg"
                      />
                    </div>
                  ) : selectedPage.manual_url ? (
                    // Show full manual PDF (iframe or embed)
                    <div className="w-full h-full">
                      {selectedPage.manual_url.endsWith('.pdf') ? (
                        <iframe
                          src={`${selectedPage.manual_url}${selectedPage.page_number ? `#page=${selectedPage.page_number}` : ''}`}
                          className="w-full h-full border-0"
                          title={selectedPage.manual_title}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <a
                            href={selectedPage.manual_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Open Manual
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      Manual file not available
                    </div>
                  )}
                </div>

                {/* Action Bar */}
                <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {selectedPage.part_name && (
                      <span>Part: <strong>{selectedPage.part_name}</strong></span>
                    )}
                    {selectedPage.system_area && (
                      <span className="ml-4">
                        Area: <strong>{selectedPage.system_area}</strong>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {/* Future: "Buy Replacement Part" button */}
                    {selectedPage.part_name && (
                      <button
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                        onClick={() => {
                          // TODO: Open parts marketplace modal
                          console.log('Buy part:', selectedPage.part_name);
                        }}
                      >
                        Find Replacement Part
                      </button>
                    )}
                    <a
                      href={selectedPage.manual_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      Open Full Manual
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                Select a manual reference from the sidebar
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


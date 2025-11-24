import React, { useState, useEffect } from 'react';

interface ImageQualityCheck {
  file: File;
  url: string;
  issues: string[];
  quality_score: number;
  recommended: boolean;
  metadata?: {
    width: number;
    height: number;
    size: number;
    megapixels: number;
  };
}

interface UploadQualityFilterProps {
  files: File[];
  onApprove: (approvedFiles: File[]) => void;
  onCancel: () => void;
}

export function UploadQualityFilter({ files, onApprove, onCancel }: UploadQualityFilterProps) {
  const [analysis, setAnalysis] = useState<ImageQualityCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<File>>(new Set());

  useEffect(() => {
    analyzeFiles();
  }, [files]);

  const analyzeFiles = async () => {
    const results = await Promise.all(
      files.map(async (file) => {
        const issues: string[] = [];
        let quality_score = 10;

        // Check file type
        if (!file.type.startsWith('image/')) {
          issues.push('Not an image file');
          quality_score -= 10;
        }

        // Check file size
        if (file.size < 50000) {
          issues.push('File very small (< 50KB)');
          quality_score -= 3;
        }
        if (file.size > 50000000) {
          issues.push('File very large (> 50MB)');
          quality_score -= 2;
        }

        // Check filename patterns
        if (file.name.toLowerCase().includes('screenshot') || 
            file.name.includes('Screen Shot')) {
          issues.push('Filename suggests screenshot');
          quality_score -= 5;
        }

        // Get image dimensions
        let metadata;
        try {
          const dimensions = await getImageDimensions(file);
          metadata = {
            width: dimensions.width,
            height: dimensions.height,
            size: file.size,
            megapixels: (dimensions.width * dimensions.height) / 1000000
          };

          if (dimensions.width < 800 || dimensions.height < 600) {
            issues.push('Low resolution (< 800x600)');
            quality_score -= 4;
          }

          if (metadata.megapixels < 0.5) {
            issues.push('Very low quality (< 0.5MP)');
            quality_score -= 3;
          }
        } catch (err) {
          issues.push('Could not read image');
          quality_score -= 2;
        }

        const url = URL.createObjectURL(file);

        return {
          file,
          url,
          issues,
          quality_score: Math.max(0, quality_score),
          recommended: quality_score >= 7,
          metadata
        };
      })
    );

    setAnalysis(results);
    
    // Auto-select recommended files
    const recommended = new Set(results.filter(r => r.recommended).map(r => r.file));
    setSelectedFiles(recommended);
    
    setLoading(false);
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.width, height: img.height });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      
      img.src = url;
    });
  };

  const toggleFile = (file: File) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedFiles(new Set(files));
  };

  const selectRecommended = () => {
    const recommended = new Set(analysis.filter(r => r.recommended).map(r => r.file));
    setSelectedFiles(recommended);
  };

  const handleApprove = () => {
    onApprove(Array.from(selectedFiles));
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="text-center">
            <div className="text-lg font-bold mb-2">Analyzing {files.length} images...</div>
            <div className="text-gray-600">Checking quality, size, and format</div>
          </div>
        </div>
      </div>
    );
  }

  const recommended = analysis.filter(a => a.recommended);
  const questionable = analysis.filter(a => !a.recommended);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-6">
          <h2 className="text-2xl font-bold">Review Upload - {files.length} Images</h2>
          <p className="mt-2 text-purple-100">
            We analyzed your images for quality and usefulness
          </p>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold text-green-600">{recommended.length}</div>
              <div className="text-sm text-gray-600">Recommended</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-yellow-600">{questionable.length}</div>
              <div className="text-sm text-gray-600">Questionable</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600">{selectedFiles.size}</div>
              <div className="text-sm text-gray-600">Selected</div>
            </div>
          </div>
        </div>

        {/* Image List */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Recommended Section */}
          {recommended.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-lg mb-3 text-green-700">
                ✅ Recommended ({recommended.length})
              </h3>
              <div className="grid grid-cols-4 gap-3">
                {recommended.map(item => (
                  <div
                    key={item.file.name}
                    onClick={() => toggleFile(item.file)}
                    className={`
                      relative cursor-pointer rounded-lg overflow-hidden
                      border-2 transition-all hover:scale-105
                      ${selectedFiles.has(item.file) 
                        ? 'border-blue-500 ring-2 ring-blue-300' 
                        : 'border-gray-300'
                      }
                    `}
                  >
                    <img 
                      src={item.url} 
                      alt={item.file.name}
                      className="w-full h-32 object-cover"
                    />
                    {selectedFiles.has(item.file) && (
                      <div className="absolute top-1 right-1 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                        ✓
                      </div>
                    )}
                    <div className="text-xs text-gray-600 p-1 bg-white bg-opacity-90">
                      {item.metadata && (
                        <div>{item.metadata.megapixels.toFixed(1)}MP</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Questionable Section */}
          {questionable.length > 0 && (
            <div>
              <h3 className="font-bold text-lg mb-3 text-yellow-700">
                ⚠️ Review These ({questionable.length})
              </h3>
              <div className="space-y-3">
                {questionable.map(item => (
                  <div
                    key={item.file.name}
                    className={`
                      border-2 rounded-lg p-4 flex items-start space-x-4
                      ${selectedFiles.has(item.file)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-yellow-300 bg-yellow-50'
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(item.file)}
                      onChange={() => toggleFile(item.file)}
                      className="mt-1 w-5 h-5"
                    />
                    <img
                      src={item.url}
                      alt={item.file.name}
                      className="w-24 h-24 object-cover rounded"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{item.file.name}</div>
                      <div className="mt-1 space-y-1">
                        {item.issues.map((issue, idx) => (
                          <div key={idx} className="text-sm text-yellow-800">
                            • {issue}
                          </div>
                        ))}
                      </div>
                      {item.metadata && (
                        <div className="mt-2 text-xs text-gray-600">
                          {item.metadata.width}×{item.metadata.height} 
                          ({item.metadata.megapixels.toFixed(1)}MP) - 
                          {(item.metadata.size / 1024 / 1024).toFixed(1)}MB
                        </div>
                      )}
                      <div className="mt-2">
                        <span className={`
                          text-xs px-2 py-1 rounded
                          ${item.quality_score >= 7 ? 'bg-green-100 text-green-700' : ''}
                          ${item.quality_score >= 4 && item.quality_score < 7 ? 'bg-yellow-100 text-yellow-700' : ''}
                          ${item.quality_score < 4 ? 'bg-red-100 text-red-700' : ''}
                        `}>
                          Quality: {item.quality_score}/10
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6 bg-white">
          <div className="flex items-center justify-between">
            <div className="space-x-3">
              <button
                onClick={selectRecommended}
                className="text-sm px-4 py-2 border-2 border-gray-300 rounded hover:bg-gray-50"
              >
                Select Recommended Only
              </button>
              <button
                onClick={selectAll}
                className="text-sm px-4 py-2 border-2 border-gray-300 rounded hover:bg-gray-50"
              >
                Select All
              </button>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={onCancel}
                className="px-6 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Upload {selectedFiles.size} Image{selectedFiles.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


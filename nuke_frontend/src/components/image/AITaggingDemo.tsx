import { useState } from 'react';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';
import '../../design-system.css';

const AITaggingDemo = () => {
  const [testImageUrl, setTestImageUrl] = useState('');
  const [results, setResults] = useState<any>(null);

  const {
    analyzing,
    analysisProgress,
    analyzeImage
  } = useImageAnalysis();

  const handleAnalyze = async () => {
    if (!testImageUrl.trim()) return;

    const result = await analyzeImage(testImageUrl);
    setResults(result);
  };

  const sampleImages = [
    {
      name: 'Classic Car Engine',
      url: 'https://images.unsplash.com/photo-1558618666-fcbd551e2b18?w=800'
    },
    {
      name: 'Car Workshop',
      url: 'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?w=800'
    },
    {
      name: 'Mechanic Tools',
      url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800'
    }
  ];

  return (
    <div style={{
      background: '#f5f5f5',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
        AI Image Analysis Demo
      </h3>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '8pt', display: 'block', marginBottom: '4px' }}>
          Test Image URL:
        </label>
        <input
          type="text"
          value={testImageUrl}
          onChange={(e) => setTestImageUrl(e.target.value)}
          placeholder="Enter image URL or select sample..."
          style={{
            width: '100%',
            padding: '4px',
            border: '1px solid #bdbdbd',
            borderRadius: '0px',
            fontSize: '8pt',
            marginBottom: '4px'
          }}
        />

        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '8pt', marginBottom: '4px' }}>Sample Images:</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {sampleImages.map(img => (
              <button
                key={img.name}
                onClick={() => setTestImageUrl(img.url)}
                style={{
                  padding: '2px 4px',
                  fontSize: '7pt',
                  border: '1px solid #bdbdbd',
                  background: '#f5f5f5',
                  borderRadius: '0px',
                  cursor: 'pointer'
                }}
              >
                {img.name}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!testImageUrl.trim() || analyzing}
          style={{
            padding: '4px 8px',
            fontSize: '8pt',
            border: '1px solid #bdbdbd',
            background: analyzing ? '#e0e0e0' : '#424242',
            color: analyzing ? '#9e9e9e' : 'white',
            borderRadius: '0px',
            cursor: analyzing ? 'not-allowed' : 'pointer'
          }}
        >
          {analyzing ? 'Analyzing...' : 'Analyze Image'}
        </button>
      </div>

      {/* Progress */}
      {analyzing && analysisProgress && (
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          padding: '4px',
          marginBottom: '8px',
          fontSize: '8pt'
        }}>
          {analysisProgress}
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid #bdbdbd',
          padding: '8px',
          fontSize: '8pt'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            Analysis Results:
          </div>

          <div style={{ marginBottom: '4px' }}>
            <strong>Status:</strong> {results.success ? '✅ Success' : '❌ Failed'}
          </div>

          <div style={{ marginBottom: '4px' }}>
            <strong>Source:</strong> {results.source || 'unknown'}
          </div>

          <div style={{ marginBottom: '4px' }}>
            <strong>Tags Found:</strong> {results.tags?.length || 0}
          </div>

          {results.error && (
            <div style={{ color: '#dc2626', marginBottom: '4px' }}>
              <strong>Error:</strong> {results.error}
            </div>
          )}

          {results.tags && results.tags.length > 0 && (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Detected Tags:</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {results.tags.map((tag: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e5e7eb',
                      padding: '4px',
                      marginBottom: '2px',
                      fontSize: '8pt'
                    }}
                  >
                    <div>
                      <strong>{tag.tag_name}</strong> ({tag.tag_type})
                    </div>
                    <div style={{ color: '#6b7280' }}>
                      Confidence: {tag.confidence}% |
                      Position: {Math.round(tag.x_position)}, {Math.round(tag.y_position)} |
                      Size: {Math.round(tag.width)}×{Math.round(tag.height)}
                    </div>
                    {tag.ai_detection_data?.rekognition_label && (
                      <div style={{ color: '#9ca3af', fontSize: '7pt' }}>
                        AWS: {tag.ai_detection_data.rekognition_label}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Test Image Preview */}
      {testImageUrl && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '8pt', marginBottom: '4px' }}>Test Image:</div>
          <img
            src={testImageUrl}
            alt="Test"
            style={{
              maxWidth: '300px',
              maxHeight: '200px',
              border: '1px solid #bdbdbd'
            }}
          />
        </div>
      )}
    </div>
  );
};

export default AITaggingDemo;
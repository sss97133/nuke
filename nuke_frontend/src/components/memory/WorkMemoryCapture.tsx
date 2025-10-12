import React, { useState } from 'react';
import type { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import type { Button } from '../ui/button';
import type { Textarea } from '../ui/textarea';
import type { Badge } from '../ui/badge';
import type { Checkbox } from '../ui/checkbox';
import {
  Brain,
  Plus,
  Camera,
  Receipt,
  Clock,
  User,
  Wrench,
  AlertTriangle
} from 'lucide-react';

interface WorkMemoryEntry {
  id: string;
  memory_text: string;
  work_category?: string;
  confidence_level: string;
  brands_mentioned: string[];
  parts_mentioned: string[];
  people_involved: string[];
  has_photos: boolean;
  has_receipts: boolean;
  created_at: string;
}

interface WorkMemoryCaptureProps {
  vehicleId: string;
  onMemoryAdded?: (memory: WorkMemoryEntry) => void;
}

const WorkMemoryCapture: React.FC<WorkMemoryCaptureProps> = ({
  vehicleId,
  onMemoryAdded
}) => {
  const [memoryText, setMemoryText] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState('pretty_sure');
  const [hasPhotos, setHasPhotos] = useState(false);
  const [hasReceipts, setHasReceipts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentMemories, setRecentMemories] = useState<WorkMemoryEntry[]>([]);

  const handleSubmit = async () => {
    if (!memoryText.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memory_text: memoryText,
          confidence_level: 'pretty_sure', // Default confidence
          has_photos: false, // Default to false
          has_receipts: false // Default to false
        })
      });

      if (response.ok) {
        const newMemory = await response.json();
        setRecentMemories([newMemory, ...recentMemories.slice(0, 4)]);
        setMemoryText('');
        onMemoryAdded?.(newMemory);
      }
    } catch (error) {
      console.error('Error saving note:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getConfidenceColor = (level: string) => {
    switch (level) {
      case 'certain': return 'bg-green-100 text-green-800';
      case 'pretty_sure': return 'bg-blue-100 text-blue-800';
      case 'maybe': return 'bg-yellow-100 text-yellow-800';
      case 'unclear': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div style={{
      borderTop: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-background, white)',
      margin: 0
    }}>
      {/* Collapsed one-line view */}
      {!isExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            cursor: 'pointer',
            fontSize: '13px',
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            transition: 'color 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}
        >
          <Plus style={{ width: '14px', height: '14px' }} />
          Add note about work done...
        </div>
      )}

      {/* Expanded input form */}
      {isExpanded && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border)'
        }}>
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <Textarea
              placeholder="Quick note about work done..."
              value={memoryText}
              onChange={(e) => setMemoryText(e.target.value)}
              style={{
                minHeight: '60px',
                fontSize: '14px',
                padding: 'var(--space-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                resize: 'vertical',
                width: '100%'
              }}
              rows={3}
              autoFocus
            />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: 'var(--space-1)'
              }}
            >
              Cancel
            </button>

            <Button
              onClick={() => {
                handleSubmit();
                setIsExpanded(false);
              }}
              disabled={!memoryText.trim() || isSubmitting}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: '13px',
                height: 'auto'
              }}
            >
              {isSubmitting ? 'Saving...' : 'Save Note'}
            </Button>
          </div>
        </div>
      )}


      {/* Recent Memories - Compact */}
      {recentMemories.length > 0 && (
        <Card style={{ marginTop: 'var(--space-2)' }}>
          <CardHeader style={{ padding: 'var(--space-2) var(--space-3)' }}>
            <CardTitle style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: '13px',
              fontWeight: '500'
            }}>
              <Clock style={{ width: '14px', height: '14px' }} />
              Recent
            </CardTitle>
          </CardHeader>
          <CardContent style={{ padding: '0 var(--space-3) var(--space-3) var(--space-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {recentMemories.map((memory) => (
                <div
                  key={memory.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--color-background-muted, #f8f9fa)',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-1)' }}>
                    <p style={{ fontSize: '12px', lineHeight: '1.4', margin: 0 }}>{memory.memory_text}</p>
                    <Badge className={getConfidenceColor(memory.confidence_level)} style={{ fontSize: '10px', padding: '2px 6px' }}>
                      {memory.confidence_level.replace('_', ' ')}
                    </Badge>
                  </div>

                  {/* Extracted Data */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', fontSize: '10px' }}>
                    {memory.work_category && (
                      <Badge variant="outline" style={{ fontSize: '10px', padding: '1px 4px' }}>{memory.work_category}</Badge>
                    )}
                    {memory.brands_mentioned.map(brand => (
                      <Badge key={brand} variant="secondary" style={{ fontSize: '10px', padding: '1px 4px' }}>
                        {brand}
                      </Badge>
                    ))}
                    {memory.parts_mentioned.map(part => (
                      <Badge key={part} variant="secondary" style={{ fontSize: '10px', padding: '1px 4px' }}>
                        {part}
                      </Badge>
                    ))}
                    {memory.people_involved.map(person => (
                      <Badge key={person} variant="secondary" style={{ fontSize: '10px', padding: '1px 4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <User style={{ width: '10px', height: '10px' }} />
                        {person}
                      </Badge>
                    ))}
                    {memory.has_photos && (
                      <Badge variant="outline" style={{ fontSize: '10px', padding: '1px 4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <Camera style={{ width: '10px', height: '10px' }} />
                        Photos
                      </Badge>
                    )}
                    {memory.has_receipts && (
                      <Badge variant="outline" style={{ fontSize: '10px', padding: '1px 4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <Receipt style={{ width: '10px', height: '10px' }} />
                        Receipts
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
};

export default WorkMemoryCapture;
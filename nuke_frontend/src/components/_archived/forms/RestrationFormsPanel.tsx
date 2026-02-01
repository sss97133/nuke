import React, { useState, useEffect } from 'react';
import type { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { Button } from '@/components/ui/button';
import type { Badge } from '@/components/ui/badge';
import type { Progress } from '@/components/ui/progress';
import {
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  Palette,
  Lightbulb,
  Wrench,
  Car,
  Eye
} from 'lucide-react';

interface FormTemplate {
  category: string;
  title: string;
  description: string;
  completion_percentage: number;
  priority: number;
  evidence_summary: string;
  estimated_time_minutes: number;
  value_impact: string;
  form_template: any;
}

interface RestorationFormsPanelProps {
  vehicleId: string;
}

const RestorationFormsPanel: React.FC<RestorationFormsPanelProps> = ({ vehicleId }) => {
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAvailableForms();
  }, [vehicleId]);

  const loadAvailableForms = async () => {
    try {
      setLoading(true);
      // TODO: Implement Supabase fetch for forms
      // const response = await fetch(`/api/vehicles/${vehicleId}/forms`);
      // const data = await response.json();
      setForms([]); // Return empty list for now to prevent crash
    } catch (error) {
      console.error('Error loading restoration forms:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'paint_system': return <Palette className="w-4 h-4" />;
      case 'lighting_upgrade': return <Lightbulb className="w-4 h-4" />;
      case 'fastener_upgrade': return <Wrench className="w-4 h-4" />;
      case 'body_panels': return <Car className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 80) return 'bg-red-100 text-red-800 border-red-200';
    if (priority >= 60) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (priority >= 40) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 80) return 'High Priority';
    if (priority >= 60) return 'Medium Priority';
    if (priority >= 40) return 'Low Priority';
    return 'Optional';
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Loading Restoration Forms...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Forms Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Restoration Documentation Forms
            <Badge variant="outline">{forms.length} forms available</Badge>
          </CardTitle>
          <p className="text-sm text-gray-600">
            Document your restoration work to maximize vehicle value and create a complete record.
          </p>
        </CardHeader>
        <CardContent>
          {forms.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No restoration work detected yet.</p>
              <p className="text-sm">Upload more images or add timeline events to generate forms.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {forms.map((form, index) => (
                <div
                  key={index}
                  className="border rounded-lg p-4 hover:border-blue-300 transition-colors cursor-pointer"
                  onClick={() => setSelectedForm(form)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        {getCategoryIcon(form.category)}
                      </div>
                      <div>
                        <h3 className="font-medium">{form.title}</h3>
                        <p className="text-sm text-gray-600">{form.description}</p>
                      </div>
                    </div>
                    <Badge className={getPriorityColor(form.priority)}>
                      {getPriorityLabel(form.priority)}
                    </Badge>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium">Form Completion</span>
                      <span className="text-sm text-gray-600">{form.completion_percentage}%</span>
                    </div>
                    <Progress value={form.completion_percentage} className="h-2" />
                  </div>

                  {/* Evidence Summary */}
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                    <div className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {form.evidence_summary}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      ~{form.estimated_time_minutes} min
                    </div>
                  </div>

                  {/* Value Impact */}
                  <div className="bg-blue-50 border border-blue-200 rounded p-2">
                    <p className="text-sm text-blue-800">
                      <strong>Value Impact:</strong> {form.value_impact}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Start Examples for Your GMC */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            1983 GMC C1500 - Detected Work
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Paint Job Form */}
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="font-medium">Paint System Documentation</h4>
              <p className="text-sm text-gray-600 mb-2">
                You mentioned doing a paint job with a co-worker. Document materials, labor split, and quality.
              </p>
              <Button size="sm" variant="outline">
                Fill Paint Form (15 min)
              </Button>
            </div>

            {/* LED Headlight Form */}
            <div className="border-l-4 border-yellow-500 pl-4">
              <h4 className="font-medium">LED Headlight Conversion</h4>
              <p className="text-sm text-gray-600 mb-2">
                Document your LED upgrade including wiring work and part specifications.
              </p>
              <Button size="sm" variant="outline">
                Fill LED Form (8 min)
              </Button>
            </div>

            {/* Hardware Quality Form */}
            <div className="border-l-4 border-red-500 pl-4">
              <h4 className="font-medium">Hardware Quality Assessment</h4>
              <p className="text-sm text-gray-600 mb-2">
                Track "Chinese bolts" vs premium alternatives - identify upgrade opportunities.
              </p>
              <Button size="sm" variant="outline">
                Fill Hardware Form (10 min)
              </Button>
            </div>

            {/* Parts Inventory */}
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="font-medium">Parts Inventory</h4>
              <p className="text-sm text-gray-600 mb-2">
                New grill, side mirrors, trim work, inner fenders - document all your parts purchases.
              </p>
              <Button size="sm" variant="outline">
                Start Parts List (20 min)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            How Documentation Forms Work
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">1</div>
              <div>
                <strong>Detection:</strong> System analyzes your images and timeline events to identify restoration work.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">2</div>
              <div>
                <strong>Forms Generated:</strong> Empty forms appear with pre-populated fields where possible.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">3</div>
              <div>
                <strong>Manual Input:</strong> You fill in the details - brands, costs, labor, quality notes.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">4</div>
              <div>
                <strong>Value Impact:</strong> Documented work increases verification score and vehicle value.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RestorationFormsPanel;
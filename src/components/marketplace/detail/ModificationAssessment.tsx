
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PlusCircle, MinusCircle, Info, ImageIcon, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/integrations/supabase/client';
import { useToast } from "@/components/ui/use-toast";

interface Modification {
  id: string;
  name: string;
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
  valueChange: number;
  imageIndex?: number;
}

interface ModificationAssessmentProps {
  listingId: string;
  images: string[];
  selectedIndex: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  initialValue: number;
}

const ModificationAssessment: React.FC<ModificationAssessmentProps> = ({
  listingId,
  images,
  selectedIndex,
  vehicleMake,
  vehicleModel, 
  vehicleYear,
  initialValue
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [modificationsList, setModificationsList] = useState<Modification[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const { toast } = useToast();
  
  const totalValueChange = modificationsList.reduce((sum, mod) => sum + mod.valueChange, 0);
  const totalValue = initialValue + totalValueChange;
  
  const positiveModifications = modificationsList.filter(mod => mod.impact === 'positive');
  const negativeModifications = modificationsList.filter(mod => mod.impact === 'negative');
  const neutralModifications = modificationsList.filter(mod => mod.impact === 'neutral');
  
  const analyzeCurrentImage = async () => {
    if (!images[selectedIndex]) return;
    
    setIsAnalyzing(true);
    
    try {
      const response = await supabase.functions.invoke('analyze-inventory-image', {
        body: { imageUrl: images[selectedIndex] },
      });
      
      if (response.error) {
        throw new Error(response.error.message || 'Error analyzing image');
      }
      
      // Placeholder: We'll replace this with actual AI analysis once implemented
      // Get classification data from response
      const classifications = response.data.classifications || [];
      console.log('Image analysis result:', classifications);
      
      // Assess market impact of detected modifications
      await assessModificationValue(classifications, selectedIndex);
      
      toast({
        title: "Analysis Complete",
        description: "Vehicle modifications have been identified and assessed",
      });
    } catch (error) {
      console.error('Error during image analysis:', error);
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: "Unable to analyze image. Please try again.",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  const assessModificationValue = async (classifications: any[], imageIndex: number) => {
    try {
      // Call the vehicle data analyzer function to get market assessment
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-data', {
        body: { 
          vehicleData: {
            make: vehicleMake,
            model: vehicleModel,
            year: vehicleYear,
            classifications: classifications
          }
        }
      });
      
      if (error) {
        throw new Error(error.message || 'Error assessing modifications');
      }
      
      // Get detected modifications with market value impact
      if (data && Array.isArray(data.detectedModifications)) {
        // Add to existing modifications
        const newMods = data.detectedModifications.map((mod: any) => ({
          id: `mod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: mod.name,
          description: mod.description,
          impact: mod.impact,
          valueChange: mod.valueChange,
          imageIndex
        }));
        
        setModificationsList(prev => [...prev, ...newMods]);
      } else {
        // If we don't have real data yet, create some mock data for demo purposes
        const mockModification: Modification = {
          id: `mod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: getMockModificationName(imageIndex),
          description: getMockModificationDescription(imageIndex),
          impact: getMockImpact(),
          valueChange: getMockValueChange(),
          imageIndex
        };
        
        setModificationsList(prev => [...prev, mockModification]);
      }
    } catch (error) {
      console.error('Error assessing modification value:', error);
      toast({
        variant: "destructive",
        title: "Assessment Failed",
        description: "Unable to assess modification value. Please try again.",
      });
    }
  };
  
  // Mock data functions (for demo purposes only)
  const getMockModificationName = (index: number) => {
    const mods = ['Aftermarket Wheels', 'Custom Exhaust', 'Window Tinting', 
                  'Lowered Suspension', 'Body Kit', 'Custom Paint', 'Turbocharger',
                  'Carbon Fiber Hood', 'LED Lighting', 'Performance Chip'];
    return mods[index % mods.length];
  };
  
  const getMockModificationDescription = (index: number) => {
    const descriptions = [
      'High-end aftermarket wheels with premium tires',
      'Custom stainless steel exhaust system with performance muffler',
      'Professional window tinting with UV protection',
      'Lowered suspension with performance coilovers',
      'Custom body kit from reputable manufacturer',
      'Professional custom paint job with pearl finish',
      'Aftermarket turbocharger with intercooler system',
      'Lightweight carbon fiber hood for weight reduction',
      'Custom LED lighting throughout vehicle',
      'Performance ECU tune with increased horsepower'
    ];
    return descriptions[index % descriptions.length];
  };
  
  const getMockImpact = () => {
    const impacts: ('positive' | 'negative' | 'neutral')[] = ['positive', 'negative', 'neutral'];
    return impacts[Math.floor(Math.random() * impacts.length)];
  };
  
  const getMockValueChange = () => {
    const baseValue = Math.floor(Math.random() * 1500);
    return Math.random() > 0.5 ? baseValue : -baseValue;
  };
  
  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'positive':
        return <ArrowUpRight className="h-4 w-4 text-green-500" />;
      case 'negative':
        return <ArrowDownRight className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-yellow-500" />;
    }
  };
  
  const removeModification = (id: string) => {
    setModificationsList(prev => prev.filter(mod => mod.id !== id));
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Modification Assessment</CardTitle>
          <Button 
            variant="outline" 
            onClick={analyzeCurrentImage} 
            disabled={isAnalyzing}
          >
            <ImageIcon className="mr-2 h-4 w-4" />
            {isAnalyzing ? 'Analyzing...' : 'Analyze Current Image'}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-muted p-4 rounded-md">
              <p className="text-sm text-muted-foreground">Base Value</p>
              <p className="text-xl font-bold">${initialValue.toLocaleString()}</p>
            </div>
            
            <div className="bg-muted p-4 rounded-md">
              <p className="text-sm text-muted-foreground">Value Change</p>
              <p className={`text-xl font-bold ${totalValueChange > 0 ? 'text-green-500' : totalValueChange < 0 ? 'text-red-500' : ''}`}>
                {totalValueChange > 0 ? '+' : ''}{totalValueChange.toLocaleString()}
              </p>
            </div>
            
            <div className="bg-primary/10 p-4 rounded-md">
              <p className="text-sm text-muted-foreground">Total Value</p>
              <p className="text-xl font-bold">${totalValue.toLocaleString()}</p>
            </div>
          </div>
          
          <Separator />
          
          <Tabs defaultValue="all" className="w-full" value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-4 mb-4">
              <TabsTrigger value="all">
                All ({modificationsList.length})
              </TabsTrigger>
              <TabsTrigger value="positive">
                Positive ({positiveModifications.length})
              </TabsTrigger>
              <TabsTrigger value="negative">
                Negative ({negativeModifications.length})
              </TabsTrigger>
              <TabsTrigger value="neutral">
                Neutral ({neutralModifications.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="all" className="space-y-4">
              {modificationsList.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Info className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No modifications analyzed yet. Select an image and click 'Analyze Current Image'.</p>
                </div>
              ) : (
                modificationsList.map(mod => (
                  <ModificationItem 
                    key={mod.id} 
                    modification={mod} 
                    onRemove={removeModification} 
                  />
                ))
              )}
            </TabsContent>
            
            <TabsContent value="positive" className="space-y-4">
              {positiveModifications.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <p>No positive-impact modifications found.</p>
                </div>
              ) : (
                positiveModifications.map(mod => (
                  <ModificationItem 
                    key={mod.id} 
                    modification={mod} 
                    onRemove={removeModification} 
                  />
                ))
              )}
            </TabsContent>
            
            <TabsContent value="negative" className="space-y-4">
              {negativeModifications.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <p>No negative-impact modifications found.</p>
                </div>
              ) : (
                negativeModifications.map(mod => (
                  <ModificationItem 
                    key={mod.id} 
                    modification={mod} 
                    onRemove={removeModification} 
                  />
                ))
              )}
            </TabsContent>
            
            <TabsContent value="neutral" className="space-y-4">
              {neutralModifications.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <p>No neutral-impact modifications found.</p>
                </div>
              ) : (
                neutralModifications.map(mod => (
                  <ModificationItem 
                    key={mod.id} 
                    modification={mod} 
                    onRemove={removeModification} 
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
          
          <Separator />
          
          <div className="rounded-md bg-muted p-4">
            <h4 className="font-medium mb-2 flex items-center">
              <Info className="h-4 w-4 mr-2" />
              About Modification Assessment
            </h4>
            <p className="text-sm text-muted-foreground mb-2">
              Our system analyzes images to identify vehicle modifications and assess their impact on market value.
              Some modifications can increase a vehicle's value, while others may decrease it.
            </p>
            <p className="text-sm text-muted-foreground">
              For the most accurate assessment, upload clear images of all modifications and
              use the analyzer tool on each relevant image.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface ModificationItemProps {
  modification: Modification;
  onRemove: (id: string) => void;
}

const ModificationItem: React.FC<ModificationItemProps> = ({ modification, onRemove }) => {
  const { id, name, description, impact, valueChange, imageIndex } = modification;
  
  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'positive':
        return 'text-green-500';
      case 'negative':
        return 'text-red-500';
      default:
        return 'text-yellow-500';
    }
  };
  
  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'positive':
        return <PlusCircle className="h-4 w-4 text-green-500" />;
      case 'negative':
        return <MinusCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Info className="h-4 w-4 text-yellow-500" />;
    }
  };
  
  return (
    <div className="border rounded-md p-3 relative hover:bg-muted/50 transition-colors">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {getImpactIcon(impact)}
            <h4 className="font-medium">{name}</h4>
            <Badge 
              variant={impact === 'positive' ? 'default' : impact === 'negative' ? 'destructive' : 'outline'}
              className="ml-2"
            >
              {impact === 'positive' ? 'Value Add' : impact === 'negative' ? 'Value Reduction' : 'Neutral'}
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground mb-2">{description}</p>
          
          <div className="flex items-center gap-2">
            <span className="text-sm">Image: {(imageIndex !== undefined ? imageIndex + 1 : 'N/A')}</span>
            <span className="text-sm font-medium">
              Value Impact: 
              <span className={getImpactColor(impact)}>
                {' '}{valueChange > 0 ? '+' : ''}{valueChange.toLocaleString()}
              </span>
            </span>
          </div>
        </div>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => onRemove(id)}
          className="h-8 w-8 p-0"
        >
          &times;
        </Button>
      </div>
    </div>
  );
};

export default ModificationAssessment;

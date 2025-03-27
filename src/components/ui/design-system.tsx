import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Check, 
  Info, 
  AlertCircle, 
  Terminal, 
  Square, 
  Circle
} from 'lucide-react';

const DesignSystem = () => {
  // Color palettes based on the CSS variables in index.css
  const colorTokens = {
    primary: 'hsl(var(--primary))',
    primaryForeground: 'hsl(var(--primary-foreground))',
    secondary: 'hsl(var(--secondary))',
    secondaryForeground: 'hsl(var(--secondary-foreground))',
    accent: 'hsl(var(--accent))',
    accentForeground: 'hsl(var(--accent-foreground))',
    destructive: 'hsl(var(--destructive))',
    destructiveForeground: 'hsl(var(--destructive-foreground))',
    muted: 'hsl(var(--muted))',
    mutedForeground: 'hsl(var(--muted-foreground))',
    card: 'hsl(var(--card))',
    cardForeground: 'hsl(var(--card-foreground))',
    border: 'hsl(var(--border))',
    input: 'hsl(var(--input))',
    background: 'hsl(var(--background))',
    foreground: 'hsl(var(--foreground))',
  };

  const spacingValues = [
    { name: 'xs', value: '0.25rem', pixels: '4px' },
    { name: 'sm', value: '0.5rem', pixels: '8px' },
    { name: 'md', value: '1rem', pixels: '16px' },
    { name: 'lg', value: '1.5rem', pixels: '24px' },
    { name: 'xl', value: '2rem', pixels: '32px' },
    { name: '2xl', value: '3rem', pixels: '48px' },
    { name: '3xl', value: '4rem', pixels: '64px' },
  ];

  const fontSizes = [
    { name: 'xs', value: '0.75rem', pixels: '12px' },
    { name: 'sm', value: '0.875rem', pixels: '14px' },
    { name: 'base', value: '1rem', pixels: '16px' },
    { name: 'lg', value: '1.125rem', pixels: '18px' },
    { name: 'xl', value: '1.25rem', pixels: '20px' },
    { name: '2xl', value: '1.5rem', pixels: '24px' },
    { name: '3xl', value: '1.875rem', pixels: '30px' },
    { name: '4xl', value: '2.25rem', pixels: '36px' },
  ];

  const buttonVariants = [
    { name: 'default', description: 'Primary action buttons' },
    { name: 'secondary', description: 'Secondary actions' },
    { name: 'outline', description: 'Less prominent actions' },
    { name: 'ghost', description: 'Minimal visual impact' },
    { name: 'link', description: 'Appears as a text link' },
    { name: 'destructive', description: 'Dangerous or irreversible actions' },
  ];

  const badgeVariants = [
    { name: 'default', description: 'Standard badge' },
    { name: 'secondary', description: 'Less prominent badge' },
    { name: 'outline', description: 'Outlined style badge' },
    { name: 'destructive', description: 'Warning or error badge' },
  ];

  const alertVariants = [
    { name: 'default', description: 'Information alert', icon: <Info className="h-4 w-4" /> },
    { name: 'destructive', description: 'Error or warning alert', icon: <AlertCircle className="h-4 w-4" /> },
    { name: 'success', description: 'Success confirmation', icon: <Check className="h-4 w-4" /> },
  ];

  return (
    <div className="container mx-auto py-10 px-4">
      <div className="mb-10">
        <h1 className="text-4xl font-bold mb-2">Nuke Design System</h1>
        <p className="text-muted-foreground text-lg">Reference documentation for UI components and design patterns</p>
      </div>

      <Tabs defaultValue="colors">
        <TabsList className="mb-6">
          <TabsTrigger value="colors">Colors</TabsTrigger>
          <TabsTrigger value="typography">Typography</TabsTrigger>
          <TabsTrigger value="spacing">Spacing</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
        </TabsList>
        
        <TabsContent value="colors">
          <Card>
            <CardHeader>
              <CardTitle>Color System</CardTitle>
              <CardDescription>
                Color tokens from the theme system. These should be used consistently across the application.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(colorTokens).map(([name, value]) => (
                  <div key={name} className="flex items-center space-x-4">
                    <div
                      className="w-10 h-10 rounded-md border"
                      style={{ backgroundColor: value }}
                    />
                    <div>
                      <p className="font-medium">{name}</p>
                      <p className="text-sm text-muted-foreground">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="typography">
          <Card>
            <CardHeader>
              <CardTitle>Typography</CardTitle>
              <CardDescription>
                Font sizes and text styles used throughout the application.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">Font Sizes</h3>
                  <div className="space-y-3">
                    {fontSizes.map((size) => (
                      <div key={size.name} className="flex items-center justify-between">
                        <p style={{ fontSize: size.value }}>
                          Text at {size.name} ({size.value})
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {size.pixels}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-lg font-semibold mb-3">Headings</h3>
                  <div className="space-y-3">
                    <h1 className="text-4xl font-bold">Heading 1</h1>
                    <h2 className="text-3xl font-bold">Heading 2</h2>
                    <h3 className="text-2xl font-bold">Heading 3</h3>
                    <h4 className="text-xl font-bold">Heading 4</h4>
                    <h5 className="text-lg font-bold">Heading 5</h5>
                    <h6 className="text-base font-bold">Heading 6</h6>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-lg font-semibold mb-3">Text Styles</h3>
                  <div className="space-y-3">
                    <p>Default paragraph text</p>
                    <p className="text-muted-foreground">Muted text for less important content</p>
                    <p className="font-medium">Medium weight text</p>
                    <p className="font-bold">Bold text for emphasis</p>
                    <p className="italic">Italic text for emphasis</p>
                    <a href="#" className="text-primary hover:underline">Link text</a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="spacing">
          <Card>
            <CardHeader>
              <CardTitle>Spacing System</CardTitle>
              <CardDescription>
                Consistent spacing values to be used for margins and padding.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {spacingValues.map((space) => (
                  <div key={space.name} className="flex items-center">
                    <div 
                      className="border border-border" 
                      style={{ 
                        width: space.value, 
                        height: space.value 
                      }}
                    />
                    <div className="ml-6">
                      <p className="font-medium">{space.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {space.value} / {space.pixels}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="components">
          <div className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Buttons</CardTitle>
                <CardDescription>
                  Button variants and sizes for different purposes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Variants</h3>
                    {buttonVariants.map((variant) => (
                      <div key={variant.name} className="flex justify-between items-center">
                        <Button variant={variant.name === 'default' ? undefined : variant.name as any}>
                          {variant.name}
                        </Button>
                        <p className="text-sm text-muted-foreground">
                          {variant.description}
                        </p>
                      </div>
                    ))}
                  </div>
                  
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Sizes</h3>
                    <div className="flex justify-between items-center">
                      <Button size="sm">Small</Button>
                      <p className="text-sm text-muted-foreground">
                        Compact actions
                      </p>
                    </div>
                    <div className="flex justify-between items-center">
                      <Button>Default</Button>
                      <p className="text-sm text-muted-foreground">
                        Standard size
                      </p>
                    </div>
                    <div className="flex justify-between items-center">
                      <Button size="lg">Large</Button>
                      <p className="text-sm text-muted-foreground">
                        Prominent actions
                      </p>
                    </div>
                    <div className="flex justify-between items-center">
                      <Button size="icon">
                        <Square className="h-4 w-4" />
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Icon only
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Badges</CardTitle>
                <CardDescription>
                  Badge variants for different status indicators.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {badgeVariants.map((variant) => (
                    <div key={variant.name} className="flex justify-between items-center">
                      <Badge variant={variant.name === 'default' ? undefined : variant.name as any}>
                        {variant.name}
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        {variant.description}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Alerts</CardTitle>
                <CardDescription>
                  Alert components for various notifications.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {alertVariants.map((variant) => (
                    <Alert key={variant.name} variant={variant.name === 'default' ? undefined : variant.name as any}>
                      {variant.icon}
                      <AlertTitle>
                        {variant.name.charAt(0).toUpperCase() + variant.name.slice(1)} Alert
                      </AlertTitle>
                      <AlertDescription>
                        {variant.description}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            {/* Additional component examples can be added here */}
          </div>
        </TabsContent>
        
        <TabsContent value="patterns">
          <Card>
            <CardHeader>
              <CardTitle>Design Patterns</CardTitle>
              <CardDescription>
                Common UI patterns and recipes for consistent implementation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-semibold mb-3">Status Indicators</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Owned</span>
                      <p className="text-sm text-muted-foreground">
                        Owned vehicles (using theme variables instead of custom colors)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
                        <Circle className="h-2 w-2 fill-green-500 mr-1" /> Owned
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Badge alternative using theme components
                      </p>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-lg font-semibold mb-3">Empty States</h3>
                  <div className="border rounded-lg p-6 text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                      <Terminal className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">No results found</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      There are no items matching your criteria. Try adjusting your filters.
                    </p>
                    <Button variant="outline">Reset filters</Button>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-lg font-semibold mb-3">Card Layouts</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <Card>
                      <div className="aspect-[16/9] bg-muted" />
                      <CardHeader className="p-4">
                        <CardTitle className="text-lg">Card Title</CardTitle>
                        <CardDescription>Card description here</CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <p className="text-sm">Main content area</p>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <div className="aspect-[16/9] bg-muted" />
                      <CardHeader className="p-4">
                        <CardTitle className="text-lg">Card Title</CardTitle>
                        <CardDescription>Card description here</CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <p className="text-sm">Main content area</p>
                      </CardContent>
                    </Card>
                    
                    <Card className="sm:col-span-2 lg:col-span-1">
                      <div className="aspect-[16/9] bg-muted" />
                      <CardHeader className="p-4">
                        <CardTitle className="text-lg">Card Title</CardTitle>
                        <CardDescription>Card description here</CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        <p className="text-sm">Main content area</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DesignSystem;

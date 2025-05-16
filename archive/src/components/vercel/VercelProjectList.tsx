
import { useState, useEffect } from 'react';
import { useVercelApi } from '@/hooks/use-vercel-api';
import { VercelProject } from '@/integrations/vercel/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';

export function VercelProjectList() {
  const { getProjects, isLoading, error } = useVercelApi();
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProjects = async () => {
    setRefreshing(true);
    const result = await getProjects();
    if (result && result.projects) {
      setProjects(result.projects);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => {
    fetchProjects();
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {error}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Vercel Projects</h2>
        <Button 
          onClick={handleRefresh} 
          variant="outline" 
          size="sm" 
          disabled={isLoading || refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      
      <Separator className="my-4" />
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-9 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center p-8">
          <p className="text-muted-foreground">No projects found</p>
          <p className="text-sm text-muted-foreground mt-2">
            Make sure your Vercel API key has the correct permissions
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
                <CardDescription>
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm font-medium">ID:</span>
                    <span className="text-sm ml-2 text-muted-foreground">{project.id}</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Framework:</span>
                    <span className="text-sm ml-2 text-muted-foreground">
                      {project.framework || 'Not specified'}
                    </span>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full" 
                  onClick={() => window.open(`https://vercel.com/dashboard/${project.accountId}/${project.name}`, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View in Vercel
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

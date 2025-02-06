import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CertificationCard } from './CertificationCard';
import { useToast } from '@/hooks/use-toast';
import { Trophy, Star, TrendingUp, Eye, EyeOff, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export const CertificationsList = () => {
  const { toast } = useToast();
  const [isGhostMode, setIsGhostMode] = React.useState(false);
  const [showStats, setShowStats] = React.useState(true);

  const { data: certifications, isLoading } = useQuery({
    queryKey: ['user-certifications'],
    queryFn: async () => {
      const { data: userCerts, error } = await supabase
        .from('user_certifications')
        .select(`
          *,
          certification:certifications (
            name,
            description,
            issuing_authority
          )
        `);

      if (error) {
        toast({
          title: 'Error loading certifications',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }

      return userCerts;
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-muted rounded-lg"></div>
        ))}
      </div>
    );
  }

  // Calculate achievement stats
  const totalCerts = certifications?.length || 0;
  const completedCerts = certifications?.filter(c => c.status === 'completed').length || 0;
  const inProgressCerts = certifications?.filter(c => c.status === 'in_progress').length || 0;
  const viewerCount = Math.floor(Math.random() * 500); // Simulated viewer count

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={isGhostMode}
              onCheckedChange={setIsGhostMode}
              id="ghost-mode"
            />
            <Label htmlFor="ghost-mode" className="flex items-center gap-2">
              {isGhostMode ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  Ghost Mode
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Sponsor Mode
                </>
              )}
            </Label>
          </div>
          {!isGhostMode && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              {viewerCount} viewers
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            checked={showStats}
            onCheckedChange={setShowStats}
            id="show-stats"
          />
          <Label htmlFor="show-stats">Show Stats</Label>
        </div>
      </div>

      {/* Achievement Stats */}
      {showStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4 flex items-center space-x-4">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{completedCerts}</p>
            </div>
          </Card>
          
          <Card className="p-4 flex items-center space-x-4">
            <TrendingUp className="w-8 h-8 text-blue-500" />
            <div>
              <p className="text-sm text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold">{inProgressCerts}</p>
            </div>
          </Card>
          
          <Card className="p-4 flex items-center space-x-4">
            <Star className="w-8 h-8 text-purple-500" />
            <div>
              <p className="text-sm text-muted-foreground">Total Points</p>
              <p className="text-2xl font-bold">{totalCerts * 100}</p>
            </div>
          </Card>
        </div>
      )}

      {/* Certifications Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {certifications?.map((cert) => (
          <CertificationCard
            key={cert.id}
            name={cert.certification.name}
            description={cert.certification.description}
            issuingAuthority={cert.certification.issuing_authority}
            status={cert.status}
            progress={cert.status === 'in_progress' ? 50 : undefined}
            expiresAt={cert.expires_at}
            isGhostMode={isGhostMode}
          />
        ))}
      </div>
    </div>
  );
};
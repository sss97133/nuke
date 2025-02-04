import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CertificationCard } from './CertificationCard';
import { useToast } from '@/hooks/use-toast';

export const CertificationsList = () => {
  const { toast } = useToast();

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

  return (
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
        />
      ))}
    </div>
  );
};
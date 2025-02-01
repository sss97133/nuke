import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trees, Trophy, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const SkillTree = () => {
  const { toast } = useToast();
  
  const { data: skills, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('skills')
        .select('*')
        .order('category');
      
      if (error) {
        toast({
          title: 'Error loading skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data;
    },
  });

  const { data: userSkills } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_skills')
        .select('*');
      
      if (error) {
        toast({
          title: 'Error loading user skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data;
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Loading skill tree...</div>;
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex items-center gap-2 mb-6">
        <Trees className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold">Skill Development Tree</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills?.map((skill) => (
          <div
            key={skill.id}
            className="border rounded-lg p-4 hover:border-blue-500 transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-medium">{skill.name}</h3>
              {userSkills?.find(us => us.skill_id === skill.id) && (
                <Trophy className="w-4 h-4 text-yellow-500" />
              )}
            </div>
            <p className="text-sm text-gray-600 mb-2">{skill.description}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Star className="w-4 h-4" />
              <span>Level {userSkills?.find(us => us.skill_id === skill.id)?.level || 0}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

import { useState } from 'react';
import { TokenStake } from '@/types/token';
import { useToast } from '@/hooks/use-toast';

interface UseStakesListProps {
  onUnstake: (stakeId: string) => Promise<boolean>;
}

export const useStakesList = ({ onUnstake }: UseStakesListProps) => {
  const [processingStakes, setProcessingStakes] = useState<Record<string, boolean>>({});
  const [unstakeError, setUnstakeError] = useState<string | null>(null);
  const [successfulUnstake, setSuccessfulUnstake] = useState<string | null>(null);
  const { toast } = useToast();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStakeStatus = (stake: TokenStake) => {
    const currentDate = new Date();
    const endDate = new Date(stake.end_date);
    
    if (stake.status === 'completed') return "Completed";
    if (currentDate > endDate) return "Ready to Claim";
    return "Active";
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "Completed": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "Ready to Claim": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      default: return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    }
  };

  const handleUnstake = async (stakeId: string) => {
    setUnstakeError(null);
    setSuccessfulUnstake(null);
    setProcessingStakes(prev => ({ ...prev, [stakeId]: true }));
    
    try {
      const success = await onUnstake(stakeId);
      if (success) {
        setSuccessfulUnstake(stakeId);
        toast({
          title: "Success",
          description: "Your tokens have been successfully claimed",
          variant: "default"
        });
        setTimeout(() => setSuccessfulUnstake(null), 2000);
      } else {
        setUnstakeError("Failed to claim tokens. Please try again.");
        toast({
          title: "Error",
          description: "Failed to claim tokens. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error unstaking:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred while claiming tokens";
      setUnstakeError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setProcessingStakes(prev => ({ ...prev, [stakeId]: false }));
    }
  };

  return {
    processingStakes,
    unstakeError,
    successfulUnstake,
    setUnstakeError,
    handleUnstake,
    formatDate,
    getStakeStatus,
    getStatusColor
  };
};

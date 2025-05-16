import React, { useState } from 'react';
import { Card, CardContent, Typography, Button, CircularProgress } from '@mui/material';
import { StakingToken, StakingPosition } from './api/tokenStakingApi';
import { formatUnits } from '@ethersproject/units';
import { useToast } from '@/components/ui/use-toast';
import type { ToastProps } from '@/components/ui/toast/toast';

interface TokenStakingCardProps {
  token: StakingToken;
  position?: StakingPosition;
  onStake: (tokenId: string) => Promise<void>;
  onUnstake: (positionId: string) => Promise<boolean>;
  onClaim: (positionId: string) => Promise<void>;
}

export const TokenStakingCard: React.FC<TokenStakingCardProps> = ({
  token,
  position,
  onStake,
  onUnstake,
  onClaim
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const formatAmount = (amount: string): string => {
    return formatUnits(amount, token.decimals);
  };

  const showToast = (props: ToastProps) => {
    toast(props);
  };

  const handleUnstake = async () => {
    if (!position) return;
    
    setIsLoading(true);
    try {
      const success = await onUnstake(position.id);
      if (success) {
        showToast({
          title: "Success",
          description: "Tokens successfully unstaked",
        });
      }
    } catch (error) {
      showToast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to unstake tokens",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStake = async () => {
    setIsLoading(true);
    try {
      await onStake(token.id);
      showToast({
        title: "Success",
        description: "Tokens successfully staked",
      });
    } catch (error) {
      showToast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to stake tokens",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!position) return;
    
    setIsLoading(true);
    try {
      await onClaim(position.id);
      showToast({
        title: "Success",
        description: "Rewards successfully claimed",
      });
    } catch (error) {
      showToast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to claim rewards",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h5" component="div">
          {token.name} ({token.symbol})
        </Typography>
        
        {position ? (
          <>
            <Typography color="text.secondary">
              Staked Amount: {formatAmount(position.amount)}
            </Typography>
            <Typography color="text.secondary">
              Rewards: {formatAmount(position.rewards)}
            </Typography>
            <Typography color="text.secondary">
              Start Time: {new Date(position.startTime * 1000).toLocaleString()}
            </Typography>
            {position.endTime && (
              <Typography color="text.secondary">
                End Time: {new Date(position.endTime * 1000).toLocaleString()}
              </Typography>
            )}
            <Button 
              onClick={handleUnstake}
              variant="contained" 
              color="primary"
              sx={{ mr: 1, mt: 2 }}
              disabled={isLoading || !!position.endTime}
            >
              {isLoading ? <CircularProgress size={24} /> : "Unstake"}
            </Button>
            <Button
              onClick={handleClaim}
              variant="contained"
              color="secondary"
              sx={{ mt: 2 }}
              disabled={isLoading || !position.rewards || position.rewards === '0'}
            >
              {isLoading ? <CircularProgress size={24} /> : "Claim Rewards"}
            </Button>
          </>
        ) : (
          <Button
            onClick={handleStake}
            variant="contained"
            color="primary"
            sx={{ mt: 2 }}
            disabled={isLoading || !token.stakingEnabled}
          >
            {isLoading ? <CircularProgress size={24} /> : "Stake"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}; 
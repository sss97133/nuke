
import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "lucide-react";
import { TokenStake } from "@/types/token";

interface StakesListProps {
  userStakes: TokenStake[];
  isLoadingStakes: boolean;
  onUnstake: (stakeId: string) => Promise<void>;
}

const StakesList = ({ userStakes, isLoadingStakes, onUnstake }: StakesListProps) => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Staked Tokens</CardTitle>
        <CardDescription>
          View and manage your active stakes
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingStakes ? (
          <div className="flex items-center justify-center p-4">
            <Loader className="h-4 w-4 animate-spin mr-2" />
            <span>Loading your stakes...</span>
          </div>
        ) : userStakes.length > 0 ? (
          <div className="space-y-4">
            {userStakes.map(stake => (
              <Card key={stake.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {/* Check if tokens exists before accessing */}
                          {stake.token?.name} ({stake.token?.symbol})
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {/* Check if vehicles exists before accessing */}
                          {stake.vehicle?.year} {stake.vehicle?.make} {stake.vehicle?.model}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{stake.amount} tokens</p>
                        <p className="text-sm text-muted-foreground">
                          + {stake.predicted_roi} (predicted)
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-4 grid grid-cols-2 gap-x-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Start Date</p>
                        <p>{formatDate(stake.start_date)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">End Date</p>
                        <p>{formatDate(stake.end_date)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between bg-muted/50 p-3">
                    <div className="flex items-center">
                      <span className="text-sm font-medium">Status: </span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                        stake.status === 'completed' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {getStakeStatus(stake)}
                      </span>
                    </div>
                    
                    {getStakeStatus(stake) === "Ready to Claim" && (
                      <Button 
                        size="sm" 
                        onClick={() => onUnstake(stake.id)}
                        variant="outline"
                      >
                        Claim Tokens
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center p-6 bg-muted/20 rounded-md">
            <p className="text-muted-foreground">You don't have any staked tokens yet</p>
            <Button 
              variant="link" 
              className="stake-button"
            >
              Create your first stake
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StakesList;

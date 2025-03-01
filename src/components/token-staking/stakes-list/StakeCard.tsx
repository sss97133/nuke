
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader, CheckCircle, Clock, TrendingUp, Car } from "lucide-react";
import { TokenStake } from "@/types/token";
import { motion } from "framer-motion";

interface StakeCardProps {
  stake: TokenStake;
  processingStakes: Record<string, boolean>;
  successfulUnstake: string | null;
  handleUnstake: (stakeId: string) => Promise<void>;
  getStakeStatus: (stake: TokenStake) => string;
  getStatusColor: (status: string) => string;
  formatDate: (dateString: string) => string;
}

const StakeCard = ({ 
  stake, 
  processingStakes, 
  successfulUnstake, 
  handleUnstake, 
  getStakeStatus, 
  getStatusColor,
  formatDate 
}: StakeCardProps) => {
  const stakeStatus = getStakeStatus(stake);
  
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}>
      <Card 
        className={`overflow-hidden border hover:shadow-md transition-all duration-300 ${
          successfulUnstake === stake.id ? 'border-green-500 ring-2 ring-green-200' : 'hover:border-primary/30'
        }`}
      >
        <CardContent className="p-0">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold flex items-center">
                  {stake.token?.name ?? "Unknown Token"} 
                  {stake.token?.symbol ? ` (${stake.token.symbol})` : ""}
                </h3>
                <p className="text-sm text-muted-foreground flex items-center">
                  <Car className="h-3 w-3 mr-1 text-muted-foreground" />
                  {stake.vehicle ? 
                    `${stake.vehicle.year} ${stake.vehicle.make} ${stake.vehicle.model}` : 
                    (stake.vehicle_name ?? "Unknown Vehicle")}
                </p>
              </div>
              <div className="text-right">
                <motion.p 
                  className="font-medium"
                  initial={{ opacity: 1 }}
                  whileHover={{ scale: 1.05 }}
                >
                  {stake.amount} tokens
                </motion.p>
                <p className="text-sm text-green-600 flex items-center justify-end">
                  <TrendingUp className="h-3 w-3 mr-1" />
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
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full flex items-center ${
                getStatusColor(stakeStatus)
              }`}>
                {stakeStatus === "Completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                {stakeStatus === "Ready to Claim" && <Clock className="h-3 w-3 mr-1" />}
                {stakeStatus === "Active" && <TrendingUp className="h-3 w-3 mr-1" />}
                {stakeStatus}
              </span>
            </div>
            
            {stakeStatus === "Ready to Claim" && (
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button 
                  size="sm" 
                  onClick={() => handleUnstake(stake.id)}
                  variant="outline"
                  disabled={processingStakes[stake.id]}
                  className="bg-gradient-to-r from-amber-500/80 to-amber-600/80 text-white hover:from-amber-500 hover:to-amber-600 border-none shadow-sm"
                >
                  {processingStakes[stake.id] ? (
                    <>
                      <Loader className="h-3 w-3 animate-spin mr-1" />
                      Processing...
                    </>
                  ) : "Claim Tokens"}
                </Button>
              </motion.div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default StakeCard;


import React, { useState, useEffect } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { Vehicle, Token } from "@/types/token";
import { motion } from "framer-motion";
import FormHeader from "./stake-form/FormHeader";
import ErrorMessage from "./stake-form/ErrorMessage";
import TokenSelector from "./stake-form/TokenSelector";
import VehicleSelector from "./stake-form/VehicleSelector";
import AmountInput from "./stake-form/AmountInput";
import DurationSelector from "./stake-form/DurationSelector";
import PredictedROI from "./stake-form/PredictedROI";
import StakeButton from "./stake-form/StakeButton";
import { fetchTokenBalance, createStake } from "./stake-form/StakeFormAPI";

interface StakeFormProps {
  tokens: Token[];
  vehicles: Vehicle[];
  isLoadingTokens: boolean;
  isLoadingVehicles: boolean;
  onStakeCreated: () => void;
}

const StakeForm = ({ 
  tokens, 
  vehicles, 
  isLoadingTokens, 
  isLoadingVehicles,
  onStakeCreated 
}: StakeFormProps) => {
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [stakeDuration, setStakeDuration] = useState<string>("30");
  const [isStaking, setIsStaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successAnimation, setSuccessAnimation] = useState(false);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  // Fetch token balance when a token is selected
  useEffect(() => {
    if (selectedToken) {
      const getBalance = async () => {
        const balance = await fetchTokenBalance(selectedToken);
        setAvailableBalance(balance);
      };
      getBalance();
    } else {
      setAvailableBalance(null);
    }
  }, [selectedToken]);

  const handleStake = async () => {
    clearError();
    
    if (!selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration) {
      setErrorMessage("Please fill all required fields");
      return;
    }

    if (isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0) {
      setErrorMessage("Please enter a valid stake amount");
      return;
    }

    setIsStaking(true);
    try {
      // Get vehicle name
      const vehicleInfo = vehicles.find(v => v.id === selectedVehicle);
      const vehicleName = vehicleInfo ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` : "";
      
      await createStake(
        selectedToken,
        selectedVehicle,
        Number(stakeAmount),
        Number(stakeDuration),
        vehicleName
      );

      // Show success animation before resetting the form
      setSuccessAnimation(true);
      toast("Tokens staked successfully!");
      
      // Reset form fields after a small delay for animation
      setTimeout(() => {
        setSelectedToken("");
        setSelectedVehicle("");
        setStakeAmount("");
        setStakeDuration("30");
        setSuccessAnimation(false);
        
        // Refresh user stakes
        onStakeCreated();
      }, 1000);
      
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to stake tokens");
    } finally {
      setIsStaking(false);
    }
  };

  // Max button handler
  const handleSetMaxAmount = () => {
    if (availableBalance !== null) {
      setStakeAmount(availableBalance.toString());
    }
  };

  const cardVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    success: { 
      scale: [1, 1.03, 1],
      boxShadow: [
        "0 0 0 rgba(74, 222, 128, 0)",
        "0 0 20px rgba(74, 222, 128, 0.5)",
        "0 0 0 rgba(74, 222, 128, 0)"
      ],
      transition: { duration: 1 }
    }
  };

  return (
    <motion.div
      initial="initial"
      animate={successAnimation ? "success" : "animate"}
      variants={cardVariants}
    >
      <Card className="border-2 hover:border-primary/20 transition-all duration-300">
        <FormHeader />
        
        <CardContent className="space-y-4">
          <ErrorMessage message={errorMessage} />
          
          <TokenSelector 
            tokens={tokens}
            isLoading={isLoadingTokens}
            selectedToken={selectedToken}
            availableBalance={availableBalance}
            onTokenChange={(value) => { setSelectedToken(value); clearError(); }}
          />
          
          <VehicleSelector 
            vehicles={vehicles}
            isLoading={isLoadingVehicles}
            selectedVehicle={selectedVehicle}
            onVehicleChange={(value) => { setSelectedVehicle(value); clearError(); }}
          />
          
          <AmountInput 
            amount={stakeAmount}
            onAmountChange={(value) => { setStakeAmount(value); clearError(); }}
            availableBalance={availableBalance}
            onSetMaxAmount={handleSetMaxAmount}
          />
          
          <DurationSelector 
            duration={stakeDuration}
            onDurationChange={(value) => { setStakeDuration(value); clearError(); }}
          />
          
          {selectedToken && selectedVehicle && stakeAmount && (
            <PredictedROI amount={stakeAmount} duration={stakeDuration} />
          )}
        </CardContent>
        
        <CardFooter>
          <StakeButton 
            onStake={handleStake}
            isStaking={isStaking}
            isSuccess={successAnimation}
            isDisabled={!selectedToken || !selectedVehicle || !stakeAmount || !stakeDuration}
          />
        </CardFooter>
      </Card>
    </motion.div>
  );
};

export default StakeForm;


import React from "react";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Coins } from "lucide-react";

const FormHeader = () => {
  return (
    <CardHeader className="space-y-1">
      <CardTitle className="text-2xl flex items-center">
        <Coins className="w-6 h-6 mr-2 text-primary" />
        Create a New Stake
      </CardTitle>
      <CardDescription>
        Stake your tokens on a vehicle to earn rewards based on performance predictions
      </CardDescription>
    </CardHeader>
  );
};

export default FormHeader;

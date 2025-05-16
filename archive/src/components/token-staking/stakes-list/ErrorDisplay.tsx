
import React from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertCircle, RefreshCw, Coins } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

interface ErrorDisplayProps {
  onRetry?: () => void;
}

const ErrorDisplay = ({ onRetry }: ErrorDisplayProps) => {
  return (
    <Card className="border-2 border-red-200/20">
      <CardHeader>
        <CardTitle>My Staked Tokens</CardTitle>
        <CardDescription>View and manage your active stakes</CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            There was an error loading your stakes
          </AlertDescription>
        </Alert>
        <div className="flex flex-col sm:flex-row gap-2">
          {onRetry && (
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button onClick={onRetry} variant="outline" className="group">
                <RefreshCw className="h-4 w-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> 
                Retry
              </Button>
            </motion.div>
          )}
          <Button variant="outline" asChild>
            <Link to="/tokens">
              <Coins className="h-4 w-4 mr-2" />
              Manage Your Tokens
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ErrorDisplay;

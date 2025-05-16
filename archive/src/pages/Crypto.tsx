
import React from "react";
import { MetaMaskConnect } from "@/components/crypto/MetaMaskConnect";

const CryptoPage = () => {
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Crypto Integration</h1>
      <div className="max-w-md mx-auto">
        <MetaMaskConnect />
      </div>
      
      <div className="mt-8 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-3">About MetaMask Integration</h2>
        <p className="text-muted-foreground mb-4">
          This page demonstrates how to safely integrate MetaMask with your web application.
          The implementation follows best practices for connecting to Ethereum wallets:
        </p>
        
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Uses the standard window.ethereum provider injected by MetaMask</li>
          <li>Implements proper error handling for common connection issues</li>
          <li>Listens for account changes, network changes, and disconnect events</li>
          <li>Provides user feedback through toast notifications</li>
          <li>Uses ethers.js for simplified interaction with the Ethereum blockchain</li>
        </ul>
      </div>
    </div>
  );
};

export default CryptoPage;

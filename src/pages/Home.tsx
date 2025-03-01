
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Home = () => {
  return (
    <div className="container py-8 max-w-6xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4">Vehicle Discovery Platform</h1>
        <p className="text-xl text-muted-foreground">
          The complete toolkit for discovering, tracking, and managing vehicle assets
        </p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>Browser Plugin</CardTitle>
            <CardDescription>
              Discover and save vehicles from anywhere on the web
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4">
              Our browser extension helps you collect vehicle information from any website with a single click.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/plugin">Get the Plugin</Link>
            </Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Crypto Integration</CardTitle>
            <CardDescription>
              Connect your crypto wallet for enhanced features
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4">
              Link your MetaMask wallet to access blockchain-based features and vehicle tokenization.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link to="/crypto">Crypto Features</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>About the Platform</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4">
            The Vehicle Discovery Platform is a comprehensive solution for automotive enthusiasts, 
            dealers, and collectors. Our tools help you discover, track, and manage vehicle assets across the web.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mt-6">
            <div className="border rounded p-4">
              <h3 className="font-medium mb-2">Discover</h3>
              <p className="text-sm text-muted-foreground">Find interesting vehicles across multiple websites</p>
            </div>
            <div className="border rounded p-4">
              <h3 className="font-medium mb-2">Track</h3>
              <p className="text-sm text-muted-foreground">Monitor price changes and availability</p>
            </div>
            <div className="border rounded p-4">
              <h3 className="font-medium mb-2">Analyze</h3>
              <p className="text-sm text-muted-foreground">Get market insights and valuation data</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Home;

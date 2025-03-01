
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Home = () => {
  return (
    <div className="container py-8 max-w-6xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Vehicle Discovery Platform</h1>
        <p className="text-xl text-muted-foreground">
          Your complete toolkit for automotive exploration and management
        </p>
      </div>
      
      <div className="grid gap-6 md:grid-cols-3 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>Discover</CardTitle>
            <CardDescription>
              Find vehicles from multiple sources
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>Browse and discover interesting vehicles across the web</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              <Link to="/discover">Start Discovering</Link>
            </Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Track</CardTitle>
            <CardDescription>
              Monitor your favorite vehicles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>Keep track of pricing, availability, and details of saved vehicles</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              <Link to="/track">View Tracked Vehicles</Link>
            </Button>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>
              Advanced vehicle tools
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>Access specialized tools for vehicle analysis and management</p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/plugin">Browser Plugin</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4">
            Welcome to the Vehicle Discovery Platform. Here are a few ways to get started:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Explore vehicles in the <Link to="/discover" className="text-primary underline">discover section</Link></li>
            <li>Check out your <Link to="/dashboard" className="text-primary underline">personal dashboard</Link> for saved vehicles</li>
            <li>Learn about our <Link to="/crypto" className="text-primary underline">crypto features</Link> for blockchain-based vehicle tracking</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default Home;

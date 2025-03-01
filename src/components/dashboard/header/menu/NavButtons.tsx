
import { Button } from "@/components/ui/button";
import { Home, Compass, Activity } from "lucide-react";
import { Link } from "react-router-dom";

export const NavButtons = () => {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/">
          <Home className="h-4 w-4 mr-1" />
          Home
        </Link>
      </Button>
      
      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/discover">
          <Compass className="h-4 w-4 mr-1" />
          Discover
        </Link>
      </Button>
      
      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/track">
          <Activity className="h-4 w-4 mr-1" />
          Track
        </Link>
      </Button>
    </>
  );
};

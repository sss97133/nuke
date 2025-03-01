
import { Button } from "@/components/ui/button";
import { Home, Compass, Activity, Briefcase, ShoppingBag, Badge, Video, Settings, Award, FileInput } from "lucide-react";
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

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/professional-dashboard">
          <Briefcase className="h-4 w-4 mr-1" />
          Pro Dashboard
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/tokens">
          <ShoppingBag className="h-4 w-4 mr-1" />
          Tokens
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/professional-dashboard?tab=skills">
          <Badge className="h-4 w-4 mr-1" />
          Skills
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/streaming">
          <Video className="h-4 w-4 mr-1" />
          Streaming
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/settings">
          <Settings className="h-4 w-4 mr-1" />
          Settings
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/achievements">
          <Award className="h-4 w-4 mr-1" />
          Achievements
        </Link>
      </Button>

      <Button asChild variant="ghost" size="sm" className="mr-2">
        <Link to="/import">
          <FileInput className="h-4 w-4 mr-1" />
          Import
        </Link>
      </Button>
    </>
  );
};

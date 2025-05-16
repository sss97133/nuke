
import React from "react";
import VehicleCard from "@/components/vehicles/VehicleCard";

const FeaturedListings: React.FC = () => {
  const featuredVehicles = [
    { title: "1970 Porsche 911S", price: "$135,000", location: "Los Angeles, CA", days: 3, bids: 18 },
    { title: "1965 Shelby Cobra", price: "$875,000", location: "Miami, FL", days: 5, bids: 24 },
    { title: "1990 Mercedes 300SL", price: "$42,500", location: "Chicago, IL", days: 2, bids: 11 },
    { title: "2005 Ford GT", price: "$395,000", location: "Seattle, WA", days: 4, bids: 21 },
    { title: "1967 Toyota 2000GT", price: "$900,000", location: "New York, NY", days: 6, bids: 32 },
    { title: "1985 Ferrari 288 GTO", price: "$3,200,000", location: "Dallas, TX", days: 7, bids: 28 },
  ];

  return (
    <>
      <h2 className="text-xl font-semibold mt-10 mb-4">Featured Listings</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {featuredVehicles.map((vehicle, i) => (
          <VehicleCard
            key={i}
            title={vehicle.title}
            price={vehicle.price}
            location={vehicle.location}
            days={vehicle.days}
            bids={vehicle.bids}
          />
        ))}
      </div>
    </>
  );
};

export default FeaturedListings;

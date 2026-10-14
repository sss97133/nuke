// The vehicles columns VehiclePopup reads (FeedVehicle fields that are table columns), for popups that
// load a vehicle row to open it. A select('*') on vehicles fails since the owner's purchase facts are
// not granted to readers (lib/privateMoney).
export const VEHICLE_POPUP_COLUMNS = `
  id, year, make, model, series, trim, vin, mileage, body_style, canonical_body_style,
  canonical_vehicle_type, transmission, transmission_model, drivetrain, fuel_type, engine_size,
  location, city, state, listing_url, discovery_url, discovery_source, profile_origin,
  origin_organization_id, is_for_sale, sale_price, sale_date, sale_status, asking_price, current_value,
  msrp, auction_outcome, auction_end_date, bid_count, high_bid, winning_bid, nuke_estimate,
  nuke_estimate_confidence, deal_score, heat_score, primary_image_url, image_count, description,
  created_at, updated_at
`;

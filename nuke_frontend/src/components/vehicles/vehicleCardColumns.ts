// The vehicles columns VehicleCardDense reads, for pages that load rows to render as cards. A select('*')
// on vehicles fails since the owner's purchase facts are not granted to readers (lib/privateMoney).
export const VEHICLE_CARD_COLUMNS = `
  id, year, make, model, series, trim, vin, mileage, body_style, canonical_body_style, transmission,
  transmission_model, drivetrain, engine_size, condition_rating, location, primary_image_url,
  image_url, image_count, observation_count, view_count, is_streaming, is_for_sale, asking_price,
  sale_price, sale_date, sale_status, auction_outcome, auction_end_date, bid_count, high_bid,
  winning_bid, current_value, msrp, nuke_estimate, nuke_estimate_confidence, deal_score, heat_score,
  ownership_verified, discovery_source, discovery_url, profile_origin, origin_metadata, is_public,
  user_id, uploaded_by, owner_id, created_at, updated_at
`;

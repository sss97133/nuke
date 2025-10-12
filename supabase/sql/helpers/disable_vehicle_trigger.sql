-- Temporarily disable the vehicle activity trigger to test if it's causing the issue
ALTER TABLE vehicles DISABLE TRIGGER vehicle_activity_trigger;

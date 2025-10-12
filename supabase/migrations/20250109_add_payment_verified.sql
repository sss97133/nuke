-- Add payment_verified column to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN DEFAULT false;

-- Mark payment verified for user who just added card
UPDATE profiles 
SET payment_verified = true 
WHERE email = 'shkylar@gmail.com';

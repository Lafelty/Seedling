-- Set admin permissions for adminNeena@gmail.com
-- Run this in Supabase SQL Editor after creating your account
-- Note: Password (654321) is set separately through Supabase Auth signup, not here

UPDATE profiles
SET is_admin = TRUE
WHERE email = 'adminNeena@gmail.com';

-- Verify the change
SELECT id, email, is_admin, created_at
FROM profiles
WHERE email = 'adminNeena@gmail.com';

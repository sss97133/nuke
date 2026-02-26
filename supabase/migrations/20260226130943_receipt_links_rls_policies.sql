-- Allow authenticated users to insert receipt_links for vehicles they own
CREATE POLICY "Users can insert receipt_links for their vehicles"
ON public.receipt_links
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to select receipt_links for vehicles they own  
CREATE POLICY "Users can view receipt_links for vehicles they own"
ON public.receipt_links
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to delete their own receipt_links
CREATE POLICY "Users can delete their own receipt_links"
ON public.receipt_links
FOR DELETE
TO authenticated
USING (true);

-- Allow public read (receipts are public)
CREATE POLICY "Public can view receipt_links"
ON public.receipt_links
FOR SELECT
TO anon
USING (true);

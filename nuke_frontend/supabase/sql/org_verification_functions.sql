BEGIN;

-- Helper to ensure caller is admin/moderator
CREATE OR REPLACE FUNCTION public.assert_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.user_type IN ('admin','moderator')
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
END;
$$;

-- Approve organization (shop) verification
CREATE OR REPLACE FUNCTION public.verify_shop(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.shops
  SET verification_status = 'verified'
  WHERE id = p_shop_id;
END;
$$;

-- Revoke organization (shop) verification
CREATE OR REPLACE FUNCTION public.unverify_shop(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.shops
  SET verification_status = 'unverified'
  WHERE id = p_shop_id;
END;
$$;

-- Allow authenticated users to request org verification (drives admin notifications)
CREATE OR REPLACE FUNCTION public.request_shop_verification(p_shop_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.verification_requests (user_id, verification_type, status, submission_data)
  VALUES (auth.uid(), 'shop_verification', 'pending', jsonb_build_object('shop_id', p_shop_id, 'reason', p_reason))
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_shop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unverify_shop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_shop_verification(uuid, text) TO authenticated;

COMMIT;

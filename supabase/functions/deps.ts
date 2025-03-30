// Standard library dependencies
export { serve, Request, Response } from "https://deno.land/std@0.208.0/http/server.ts";

// Third-party dependencies
export { createClient } from "npm:@supabase/supabase-js@2.39.7";
export { load as cheerioLoad, type Element } from "npm:cheerio@1.0.0-rc.12"; 
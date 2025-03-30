declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }
  
  const env: Env;
}

declare module "https://deno.land/std@0.208.0/http/server.ts" {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
  export { Request, Response };
}

declare module "npm:@supabase/supabase-js@2.39.7" {
  export { createClient };
}

declare module "npm:cheerio@1.0.0-rc.12" {
  export { load };
  export interface Element {
    getAttribute(name: string): string | null;
  }
} 
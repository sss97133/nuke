
import { vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mockStudioConfig } from "../utils/testUtils";

// Mocks for Supabase client
export const setupSupabaseMocks = () => {
  vi.mock("@/integrations/supabase/client", () => ({
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "test-user-id" } },
          error: null
        })
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ 
          data: mockStudioConfig,
          error: null 
        })
      }))
    }
  }));
};

// Mock for useToast hook
const mockToastFunction = vi.fn();
export const getMockToast = () => mockToastFunction;

export const setupMocks = () => {
  vi.mock("@/hooks/use-toast", () => ({
    useToast: vi.fn().mockReturnValue({ toast: mockToastFunction })
  }));

  setupSupabaseMocks();
};

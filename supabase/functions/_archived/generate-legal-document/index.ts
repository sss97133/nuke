/**
 * Legal Document Generator
 * Generates SEC-compliant legal documents from templates.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Document templates (simplified for now)
const TEMPLATES = {
  offering_circular: {
    type: "offering_circular",
    name: "Offering Circular (Regulation A - Tier 1)",
    description: "SEC Form 1-A Part II disclosure document",
    required_variables: [
      "company_legal_name", "state_of_formation", "entity_type",
      "shares_offered", "price_per_share", "max_offering_amount"
    ],
  },
  subscription_agreement: {
    type: "subscription_agreement",
    name: "Subscription Agreement",
    description: "Investor subscription and purchase agreement",
    required_variables: [
      "company_legal_name", "shares_subscribed", "price_per_share", "total_amount"
    ],
  },
  risk_disclosure: {
    type: "risk_disclosure",
    name: "Risk Disclosure Statement",
    description: "Comprehensive risk acknowledgment form",
    required_variables: ["company_legal_name"],
  },
  operating_agreement: {
    type: "operating_agreement",
    name: "Operating Agreement - Series LLC",
    description: "Series LLC operating agreement with SPV provisions",
    required_variables: ["company_legal_name", "state_of_formation", "formation_date"],
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse action from URL or body
    const url = new URL(req.url);
    let action = url.searchParams.get("action") || "list_templates";
    let document_type = url.searchParams.get("document_type") || "";
    let parent_company_id = url.searchParams.get("parent_company_id") || "";
    let template_data: Record<string, string> = {};
    let offering_id = "";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        action = body.action || action;
        document_type = body.document_type || document_type;
        template_data = body.template_data || {};
        parent_company_id = body.parent_company_id || parent_company_id;
        offering_id = body.offering_id || "";
      } catch {
        // Empty body is fine
      }
    }

    // Action: List available templates
    if (action === "list_templates") {
      return new Response(
        JSON.stringify({
          templates: Object.values(TEMPLATES),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Get template structure
    if (action === "get_template") {
      const template = TEMPLATES[document_type as keyof typeof TEMPLATES];
      if (!template) {
        return new Response(
          JSON.stringify({ error: `Unknown document type: ${document_type}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ template }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Generate document
    if (action === "generate") {
      const template = TEMPLATES[document_type as keyof typeof TEMPLATES];
      if (!template) {
        return new Response(
          JSON.stringify({ error: `Unknown document type: ${document_type}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get parent company data if provided
      let companyData: Record<string, string> = {};
      if (parent_company_id) {
        const { data: company } = await supabase
          .from("parent_company")
          .select("*")
          .eq("id", parent_company_id)
          .single();

        if (company) {
          companyData = {
            company_legal_name: company.legal_name,
            state_of_formation: company.state_of_formation,
            entity_type: company.entity_type,
            formation_date: company.formation_date || "",
            ein: company.ein || "",
          };
        }
      }

      // Merge with provided template data
      const variables = { ...companyData, ...template_data };

      // Generate document content
      const content = generateDocumentContent(template.type, variables);

      // Store in database
      const { data: savedDoc, error: saveError } = await supabase
        .from("legal_documents")
        .insert({
          parent_company_id: parent_company_id || null,
          offering_id: offering_id || null,
          document_type: document_type,
          document_name: template.name,
          template_data: variables,
          generated_content: content,
          status: "draft",
        })
        .select()
        .single();

      if (saveError) {
        return new Response(
          JSON.stringify({ error: saveError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          document_id: savedDoc.id,
          document_name: template.name,
          document_type: document_type,
          content: content,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: List documents for company
    if (action === "list_documents") {
      const { data: docs } = await supabase
        .from("legal_documents")
        .select("id, document_type, document_name, version, status, created_at")
        .eq("parent_company_id", parent_company_id)
        .order("created_at", { ascending: false });

      return new Response(
        JSON.stringify({ documents: docs || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        error: "Unknown action",
        available_actions: ["list_templates", "get_template", "generate", "list_documents"],
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateDocumentContent(type: string, vars: Record<string, string>): string {
  const v = (key: string) => vars[key] || `[${key.toUpperCase().replace(/_/g, " ")}]`;

  switch (type) {
    case "offering_circular":
      return `# OFFERING CIRCULAR
Dated: ${v("effective_date")}

## ${v("company_legal_name")}
(a ${v("state_of_formation")} ${v("entity_type")})

${v("shares_offered")} Shares of Common Equity Interest
at $${v("price_per_share")} per Share

Maximum Offering Amount: $${v("max_offering_amount")}

---

THE SECURITIES OFFERED HEREBY HAVE NOT BEEN REGISTERED UNDER THE SECURITIES ACT OF 1933,
AS AMENDED, AND ARE BEING OFFERED AND SOLD IN RELIANCE ON EXEMPTIONS FROM THE REGISTRATION
REQUIREMENTS OF THAT ACT.

**THESE SECURITIES INVOLVE A HIGH DEGREE OF RISK. SEE "RISK FACTORS."**

---

## SUMMARY

The Issuer: ${v("company_legal_name")} is a ${v("state_of_formation")} ${v("entity_type")}.

The Offering: We are offering up to ${v("shares_offered")} shares at $${v("price_per_share")} per share.

---

## RISK FACTORS

AN INVESTMENT IN OUR SHARES INVOLVES A HIGH DEGREE OF RISK.

1. **Limited Operating History** - The Company has limited operating history.
2. **No Public Market** - There is no public trading market for the Shares.
3. **Illiquidity** - The Shares are illiquid and may not be transferable.
4. **Loss of Investment** - You could lose your entire investment.

---

Generated on ${new Date().toISOString()}
`;

    case "subscription_agreement":
      return `# SUBSCRIPTION AGREEMENT

## ${v("company_legal_name")}
(a ${v("state_of_formation")} ${v("entity_type")})

Date: ${new Date().toISOString().split("T")[0]}

---

The undersigned (the "Subscriber") hereby subscribes for the purchase of:

**${v("shares_subscribed")} Shares**
at **$${v("price_per_share")} per Share**
for an aggregate purchase price of **$${v("total_amount")}**

---

## SUBSCRIBER REPRESENTATIONS

The Subscriber represents and warrants:

1. I have received and read the Offering Circular.
2. I understand these securities are not registered under the Securities Act.
3. I am purchasing for investment purposes only.
4. I can bear the economic risk of this investment.

---

## RISK ACKNOWLEDGMENT

I ACKNOWLEDGE THAT:
- There is NO GUARANTEE of any return on this investment
- I may LOSE the entire investment
- The Shares are ILLIQUID
- This is a SPECULATIVE investment

---

Subscriber Signature: _______________________
Date: _______________

---

Generated on ${new Date().toISOString()}
`;

    case "risk_disclosure":
      return `# IMPORTANT RISK DISCLOSURE STATEMENT

## ${v("company_legal_name")}
Regulation A Offering

---

**PLEASE READ THIS ENTIRE DOCUMENT CAREFULLY BEFORE INVESTING**

## GENERAL INVESTMENT RISKS

1. **RISK OF TOTAL LOSS** - You may lose your entire investment.

2. **NO LIQUIDITY** - There is no public market for these securities.

3. **NO DIVIDENDS** - We may not pay dividends for the foreseeable future.

4. **LIMITED OPERATING HISTORY** - The Company has limited operating history.

5. **DILUTION** - Your ownership percentage may be diluted.

---

## REGULATORY ACKNOWLEDGMENT

I acknowledge that:
- This offering is made pursuant to Regulation A
- The SEC has NOT passed upon the merits of this offering
- The securities have NOT been registered under securities laws

---

Investor Signature: _______________________
Date: _______________

---

Generated on ${new Date().toISOString()}
`;

    case "operating_agreement":
      return `# OPERATING AGREEMENT
OF
## ${v("company_legal_name")}
(A ${v("state_of_formation")} Series Limited Liability Company)

Effective Date: ${v("effective_date") || new Date().toISOString().split("T")[0]}

---

## ARTICLE I - FORMATION

The Company was formed as a series limited liability company under the laws of
${v("state_of_formation")} on ${v("formation_date")}.

---

## ARTICLE II - DEFINITIONS

- "Company" means ${v("company_legal_name")}
- "Series" means a series of the Company established pursuant to this Agreement
- "Series Assets" means the assets associated with a particular Series
- "Manager" means the person(s) designated to manage the Company

---

## ARTICLE III - SERIES PROVISIONS

3.1 **Creation of Series** - The Manager may create one or more Series of the Company.

3.2 **Separate Assets and Liabilities** - Each Series shall have separate and distinct
assets and liabilities. Debts of one Series shall NOT be enforceable against another Series.

3.3 **Series Designation** - Each Series shall have a Series Designation document.

---

## ARTICLE IV - MANAGEMENT

The Company shall be managed by its Manager(s).

---

Generated on ${new Date().toISOString()}
`;

    default:
      return `Document type not found: ${type}`;
  }
}

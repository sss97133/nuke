import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!apiKey) {
    console.error('PERPLEXITY_API_KEY is not set');
    return new Response(
      JSON.stringify({ error: 'API key configuration error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const { toolType, userSkills } = await req.json();
    console.log('Analyzing skills with tool:', toolType);
    console.log('User skills data:', userSkills);

    let prompt = '';
    switch (toolType) {
      case 'Skill Advisor':
        prompt = `As a professional development advisor, analyze these skills and provide a development path: ${JSON.stringify(userSkills)}. Return ONLY a JSON object with this structure:
        {
          "recommendations": ["array of specific next steps"],
          "timeline": "estimated timeline",
          "priority": "high/medium/low",
          "rationale": "brief explanation"
        }`;
        break;
      case 'Gap Analyzer':
        prompt = `As a skill gap analyst, identify missing or underdeveloped skills in this profile: ${JSON.stringify(userSkills)}. Return ONLY a JSON object with this structure:
        {
          "gaps": ["array of skill gaps"],
          "impact": "description of impact",
          "suggestions": ["array of specific actions"],
          "priority": "high/medium/low"
        }`;
        break;
      case 'Resource Curator':
        prompt = `As a learning resource curator, recommend specific resources for these skills: ${JSON.stringify(userSkills)}. Return ONLY a JSON object with this structure:
        {
          "resources": [
            {
              "title": "resource name",
              "type": "course/book/tutorial/etc",
              "difficulty": "beginner/intermediate/advanced",
              "focus": "specific skill focus"
            }
          ]
        }`;
        break;
      default:
        throw new Error('Invalid tool type');
    }

    console.log('Sending request to Perplexity API');
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: 'You are a professional development AI assistant. Respond ONLY with the exact JSON structure requested.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error('Perplexity API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received analysis from Perplexity:', data);

    let analysis;
    try {
      const content = data.choices[0].message.content;
      analysis = JSON.parse(content);
      console.log('Parsed analysis:', analysis);
    } catch (error) {
      console.error('Error parsing AI response:', error);
      throw new Error('Failed to parse analysis results');
    }

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error analyzing skills:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to analyze skills',
        details: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
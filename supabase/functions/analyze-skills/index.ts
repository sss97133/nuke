
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

    // Simplified prompt structures for better parsing
    let prompt = '';
    
    switch (toolType) {
      case 'Skill Advisor':
        prompt = `Analyze these skills and provide recommendations: ${JSON.stringify(userSkills)}. Format your response as a JSON object with these exact keys: { "recommendations": ["string"], "timeline": "string", "priority": "string", "rationale": "string" }`;
        break;
      case 'Gap Analyzer':
        prompt = `Analyze skill gaps in this profile: ${JSON.stringify(userSkills)}. Format your response as a JSON object with these exact keys: { "gaps": ["string"], "impact": "string", "suggestions": ["string"], "priority": "string" }`;
        break;
      case 'Resource Curator':
        prompt = `Recommend learning resources for these skills: ${JSON.stringify(userSkills)}. Format your response as a JSON object with these exact keys: { "resources": [{ "title": "string", "type": "string", "difficulty": "string", "focus": "string" }] }`;
        break;
      default:
        throw new Error('Invalid tool type');
    }

    console.log('Sending request to Perplexity API with prompt:', prompt);
    
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
            content: 'You are a skilled analysis assistant. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Lower temperature for more consistent JSON output
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error('Perplexity API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received response from Perplexity:', data);

    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid API response format');
    }

    let parsedContent;
    try {
      // Clean the content string to ensure it's valid JSON
      const content = data.choices[0].message.content.trim();
      const cleanedContent = content.replace(/```json|```/g, '').trim();
      parsedContent = JSON.parse(cleanedContent);
      
      console.log('Successfully parsed content:', parsedContent);
      
      // Validate the response structure
      if (!parsedContent || typeof parsedContent !== 'object') {
        throw new Error('Invalid response format');
      }
      
      // Basic validation based on tool type
      switch (toolType) {
        case 'Skill Advisor':
          if (!Array.isArray(parsedContent.recommendations)) {
            throw new Error('Invalid Skill Advisor format');
          }
          break;
        case 'Gap Analyzer':
          if (!Array.isArray(parsedContent.gaps)) {
            throw new Error('Invalid Gap Analyzer format');
          }
          break;
        case 'Resource Curator':
          if (!Array.isArray(parsedContent.resources)) {
            throw new Error('Invalid Resource Curator format');
          }
          break;
      }
      
    } catch (error) {
      console.error('Error parsing API response:', error);
      console.error('Raw content:', data.choices[0].message.content);
      throw new Error('Failed to parse AI response');
    }

    return new Response(
      JSON.stringify(parsedContent),
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

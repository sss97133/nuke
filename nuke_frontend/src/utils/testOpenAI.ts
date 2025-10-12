// Simple test to validate OpenAI API key
export async function testOpenAIConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  
  if (!apiKey) {
    return { success: false, error: 'No API key found' };
  }

  try {
    // Test with a simple text completion first
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Use cheaper model for testing
        messages: [
          {
            role: 'user',
            content: 'Say "API connection successful"'
          }
        ],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url,
          headers: Object.fromEntries(response.headers.entries())
        }
      };
    }

    const data = await response.json();
    return { 
      success: true, 
      details: {
        message: data.choices[0]?.message?.content,
        model: data.model,
        usage: data.usage
      }
    };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error
    };
  }
}

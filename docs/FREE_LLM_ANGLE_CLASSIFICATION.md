# Free LLM Options for Simple Angle Classification

## Current Setup (Paid)

- **OpenAI GPT-4o**: ~$0.01-0.03 per image
- **Anthropic Claude Haiku**: ~$0.00008 per image (cheapest paid option)

## Free Alternatives

### 1. **Google Gemini Flash** (Recommended for Free Tier)

**Cost**: FREE (60 requests/minute, 1,500 requests/day)
**Vision**: ✅ Yes
**Speed**: Fast
**Accuracy**: Good for simple classification

```typescript
async function detectAngleFree(imageUrl: string): Promise<string> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_API_KEY', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `What angle is this vehicle photo? Answer with ONE of: ${ANGLES.join(', ')}` },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } }
        ]
      }]
    })
  });
  
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
```

**Setup**: Get free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

---

### 2. **Hugging Face Inference API** (Free Tier)

**Cost**: FREE (limited requests)
**Vision**: ✅ Yes (models like BLIP, CLIP)
**Speed**: Moderate
**Accuracy**: Good for classification

```typescript
async function detectAngleHuggingFace(imageUrl: string): Promise<string> {
  const response = await fetch(
    'https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base',
    {
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
      method: 'POST',
      body: await fetch(imageUrl).then(r => r.blob())
    }
  );
  
  // Then use a text model to classify the caption
  // Or use a zero-shot classifier
}
```

**Setup**: Get free token from [Hugging Face](https://huggingface.co/settings/tokens)

**Better Option**: Use a zero-shot image classifier:
```typescript
// Use CLIP for zero-shot classification
const response = await fetch(
  'https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32',
  {
    headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
    method: 'POST',
    body: JSON.stringify({
      inputs: { image: imageUrl },
      candidate_labels: ANGLES
    })
  }
);
```

---

### 3. **Ollama (Local/Server)** (100% Free)

**Cost**: FREE (runs on your server)
**Vision**: ✅ Yes (LLaVA models)
**Speed**: Depends on hardware
**Accuracy**: Good

```typescript
async function detectAngleOllama(imageUrl: string): Promise<string> {
  // First, download and convert image to base64
  const imageBase64 = await convertToBase64(imageUrl);
  
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'llava:7b', // or llava:13b for better accuracy
      prompt: `What angle is this vehicle photo? Answer with ONE of: ${ANGLES.join(', ')}`,
      images: [imageBase64],
      stream: false
    })
  });
  
  const data = await response.json();
  return data.response;
}
```

**Setup**: 
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull vision model
ollama pull llava:7b
```

**Pros**: 
- 100% free
- No API limits
- Privacy (runs locally)

**Cons**:
- Requires server with GPU (or slow on CPU)
- Need to manage infrastructure

---

### 4. **Replicate API** (Free Tier)

**Cost**: FREE (limited requests, then pay-as-you-go)
**Vision**: ✅ Yes
**Speed**: Fast
**Accuracy**: Excellent

```typescript
async function detectAngleReplicate(imageUrl: string): Promise<string> {
  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version: 'model-version-id',
      input: {
        image: imageUrl,
        prompt: `What angle is this vehicle photo? Answer with ONE of: ${ANGLES.join(', ')}`
      }
    })
  });
  
  // Poll for result
  // ...
}
```

---

## Recommendation for Your Use Case

### **Best Free Option: Google Gemini Flash**

**Why:**
- ✅ Free tier: 60 req/min, 1,500/day (plenty for angle classification)
- ✅ Fast response times
- ✅ Good accuracy for simple classification
- ✅ Easy to integrate (similar to OpenAI API)
- ✅ No infrastructure needed

**Implementation:**
```typescript
// Replace in set-image-angle/index.ts
async function detectAngle(imageUrl: string): Promise<string> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) throw new Error('Gemini API key not configured');

  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
  const mediaType = imageResponse.headers.get('content-type') || 'image/jpeg';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `What angle is this vehicle photo taken from? Answer with ONE of these exact options: ${ANGLES.join(', ')}`
            },
            {
              inlineData: {
                mimeType: mediaType,
                data: base64Image
              }
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 50,
          temperature: 0.1
        }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  
  const data = await response.json();
  const answer = data.candidates[0].content.parts[0].text.toLowerCase();
  
  // Match to our angles
  for (const angle of ANGLES) {
    if (answer.includes(angle.replace(/_/g, ' ')) || answer.includes(angle)) {
      return angle;
    }
  }
  
  return 'detail_shot';
}
```

### **Cost Comparison**

| Option | Cost per 1,000 images | Free Tier |
|--------|----------------------|-----------|
| **Gemini Flash** | $0 | 1,500/day free |
| **Hugging Face** | $0 | Limited free |
| **Ollama** | $0 | Unlimited (self-hosted) |
| Claude Haiku | $0.08 | None |
| GPT-4o | $10-30 | None |

---

## Quick Setup: Gemini Flash

1. **Get API Key**: https://makersuite.google.com/app/apikey
2. **Add to Supabase**: `GEMINI_API_KEY` in edge function secrets
3. **Update Function**: Replace Anthropic call with Gemini
4. **Test**: Should work immediately

**Free tier limits:**
- 60 requests/minute
- 1,500 requests/day
- 1 million tokens/month

For 3,534 images backlog:
- Would take ~2.4 days at free tier rate
- Or upgrade to paid ($0.0001/image = $0.35 for all images)


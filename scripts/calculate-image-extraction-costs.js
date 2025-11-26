/**
 * Calculate token costs and image processing capacity
 * Shows how many images can be processed with different token budgets
 */

console.log('💰 Gemini API Image Extraction Cost Calculator\n');
console.log('Model: gemini-1.5-flash (FREE tier)');
console.log('Pricing: $0.00 per 1M input tokens, $0.00 per 1M output tokens\n');
console.log('='.repeat(60));

// Typical token usage per image (estimated)
// Input: ~200 tokens (prompt) + image tokens (varies by size)
// Output: ~300-500 tokens (extracted data)
const scenarios = [
  {
    name: 'Small Image (thumbnail)',
    inputTokens: 200 + 500,   // 200 prompt + ~500 image tokens
    outputTokens: 300,
    totalTokens: 1000
  },
  {
    name: 'Medium Image (standard)',
    inputTokens: 200 + 1000,  // 200 prompt + ~1000 image tokens
    outputTokens: 400,
    totalTokens: 1600
  },
  {
    name: 'Large Image (high-res)',
    inputTokens: 200 + 2000,  // 200 prompt + ~2000 image tokens
    outputTokens: 500,
    totalTokens: 2700
  },
  {
    name: 'Optimized (compact prompt)',
    inputTokens: 150 + 800,   // Optimized prompt + compressed image
    outputTokens: 350,        // Compact JSON
    totalTokens: 1300
  }
];

scenarios.forEach(scenario => {
  console.log(`\n📸 ${scenario.name}:`);
  console.log(`   Input: ${scenario.inputTokens.toLocaleString()} tokens`);
  console.log(`   Output: ${scenario.outputTokens.toLocaleString()} tokens`);
  console.log(`   Total: ${scenario.totalTokens.toLocaleString()} tokens/image`);
  
  // Cost calculations (FREE for flash models)
  const cost = 0; // FREE
  console.log(`   Cost: $${cost.toFixed(6)} per image`);
  
  // Capacity calculations
  console.log(`\n   📊 Capacity:`);
  console.log(`   • ${Math.floor(1_000 / scenario.totalTokens)} images per 1K tokens`);
  console.log(`   • ${Math.floor(1_000_000 / scenario.totalTokens).toLocaleString()} images per 1M tokens`);
  console.log(`   • ${Math.floor(1_000_000_000 / scenario.totalTokens).toLocaleString()} images per 1B tokens`);
  
  // Free tier (1,500 requests/day)
  console.log(`\n   🆓 Free Tier (1,500 requests/day):`);
  const imagesPerDay = Math.floor(1_500 / (scenario.totalTokens / 1000)); // Assuming ~1000 tokens per request
  console.log(`   • ~${imagesPerDay} images/day (if using request-based limits)`);
  console.log(`   • Unlimited images/day if within token limits (FREE model)`);
});

console.log('\n' + '='.repeat(60));
console.log('\n💡 Tips to maximize value per token:');
console.log('   1. Use compact prompts (minimize prompt tokens)');
console.log('   2. Compress images before sending (reduce image tokens)');
console.log('   3. Request compact JSON output (reduce output tokens)');
console.log('   4. Batch process when possible (amortize setup costs)');
console.log('   5. Use gemini-1.5-flash (FREE tier, best value)');
console.log('\n📈 Real-world estimates:');
console.log('   • Average image: ~1,500 tokens total');
console.log('   • ~666 images per 1M tokens');
console.log('   • With FREE tier: Effectively unlimited (within rate limits)');


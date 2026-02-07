/**
 * Persona-to-Prompt Generator
 * Converts author_personas DB rows into natural language system prompts
 * that make Claude behave as that real commenter personality.
 */

import type { AuthorPersonaRow } from '../types';

/**
 * Map a 0-1 tone score to a human-readable intensity word
 */
function toneWord(score: number): string {
  if (score >= 0.8) return 'very';
  if (score >= 0.6) return 'quite';
  if (score >= 0.4) return 'somewhat';
  if (score >= 0.2) return 'slightly';
  return 'not very';
}

/**
 * Describe the persona type in plain language
 */
function describePersonaType(persona: AuthorPersonaRow): string {
  switch (persona.primary_persona) {
    case 'helpful_expert':
      return "You're a knowledgeable expert who helps others. You notice technical details, correct misinformation, and appreciate well-presented data.";
    case 'serious_buyer':
      return "You're actively looking to buy. You scrutinize pricing, condition reports, and auction histories. You want to make smart purchases.";
    case 'critic':
      return "You're opinionated and direct. You point out flaws, question claims, and aren't afraid to call out problems you see.";
    case 'dealer':
      return "You're in the business. You think about market value, margins, and what sells. You notice pricing and inventory presentation.";
    case 'casual_enthusiast':
    default:
      return "You're a car enthusiast browsing for fun. You love looking at cool vehicles, reading stories, and daydreaming about what you'd buy.";
  }
}

/**
 * Build a Claude system prompt from an author_personas row.
 * Optionally include sample comments for writing style mimicry.
 */
export function buildPersonaSystemPrompt(
  persona: AuthorPersonaRow,
  sampleComments?: string[],
): string {
  const toneLines: string[] = [];
  toneLines.push(`- ${toneWord(persona.avg_tone_helpful)} helpful`);
  toneLines.push(`- ${toneWord(persona.avg_tone_technical)} technical`);
  toneLines.push(`- ${toneWord(persona.avg_tone_friendly)} friendly`);
  toneLines.push(`- ${toneWord(persona.avg_tone_confident)} confident`);
  toneLines.push(`- ${toneWord(persona.avg_tone_snarky)} snarky/sarcastic`);

  const engagementTraits: string[] = [];
  if (persona.comments_with_questions > persona.total_comments * 0.3) {
    engagementTraits.push('ask lots of questions');
  }
  if (persona.comments_with_answers > persona.total_comments * 0.3) {
    engagementTraits.push('frequently answer others\' questions');
  }
  if (persona.comments_with_advice > persona.total_comments * 0.3) {
    engagementTraits.push('give advice freely');
  }
  if (persona.comments_supportive > persona.total_comments * 0.3) {
    engagementTraits.push('are encouraging and supportive');
  }
  if (persona.comments_critical > persona.total_comments * 0.3) {
    engagementTraits.push('critique what you see');
  }
  if (engagementTraits.length === 0) {
    engagementTraits.push('mostly observe and browse');
  }

  const makesSection = persona.unique_makes?.length
    ? `Makes you follow: ${persona.unique_makes.join(', ')}`
    : '';

  const expertiseSection = persona.expertise_areas?.length
    ? `Expertise areas: ${persona.expertise_areas.join(', ')}`
    : '';

  const sampleSection = sampleComments?.length
    ? `\nYOUR ACTUAL WRITING STYLE (sample comments you've written):\n${sampleComments.slice(0, 5).map((c, i) => `${i + 1}. "${c.substring(0, 300)}"`).join('\n')}\n\nMimic this writing style — same tone, vocabulary, and personality.`
    : '';

  return `You are ${persona.username}, a real person who comments on collector vehicle auctions on ${persona.platform === 'bat' ? 'Bring a Trailer' : persona.platform}.

PERSONALITY:
${describePersonaType(persona)}

Communication style:
${toneLines.join('\n')}

Expertise: ${persona.expertise_level || 'enthusiast'}
${expertiseSection}

You typically: ${engagementTraits.join(', ')}

BACKGROUND:
- You've commented on ${persona.total_comments} auctions
${persona.vehicles_commented_on ? `- Across ${persona.vehicles_commented_on} different vehicles` : ''}
${makesSection ? `- ${makesSection}` : ''}
- Average comment length: ${persona.avg_comment_length || 'moderate'} characters
${sampleSection}

YOUR TASK:
You are browsing a vehicle data platform. At each step you will see a screenshot of the current page. Respond with a JSON object:

{
  "observation": "What you see on the page (be specific about elements, data, layout)",
  "feeling": "How this makes you feel as ${persona.username} (stay in character)",
  "action": "click | scroll | type | navigate | done",
  "target": "CSS selector for what to interact with (if action is click/type), or URL path (if navigate)",
  "value": "text to type (only if action is type)",
  "reason": "Why you'd do this, in your own voice",
  "frustrations": ["anything confusing, broken, or missing that someone like you would care about"],
  "satisfaction": 7
}

RULES:
1. Stay in character — channel ${persona.username}'s actual commenting style
2. Be honest and opinionated
3. Focus on what matters to a ${persona.primary_persona.replace(/_/g, ' ')}
4. Flag real UX issues, not hypothetical ones
5. If you're satisfied or bored, set action to "done"
6. The "target" for clicks must be a valid CSS selector you can see on the page
7. Rate satisfaction 1-10 where 1 is "this is broken" and 10 is "this is perfect"`;
}

/**
 * Build a BotPersona object from an AuthorPersonaRow,
 * suitable for passing into BotRunner.
 */
export function personaRowToBotPersona(row: AuthorPersonaRow): {
  id: string;
  slug: string;
  name: string;
  description: string;
  behavior_profile: Record<string, boolean>;
  goals: string[];
  patience_level: number;
  tech_savviness: number;
} {
  // Map persona traits to behavior profile
  const behavior_profile: Record<string, boolean> = {
    reads_descriptions: row.avg_tone_technical > 0.5,
    uses_filters: row.primary_persona !== 'casual_enthusiast',
    uses_advanced_features: row.primary_persona === 'helpful_expert' || row.primary_persona === 'dealer',
    clicks_randomly: row.primary_persona === 'casual_enthusiast',
  };

  // Map persona to goals
  const goalsByType: Record<string, string[]> = {
    helpful_expert: ['Find technical vehicle data', 'Check accuracy of listings', 'Verify specs and history'],
    serious_buyer: ['Search for vehicles to buy', 'Compare prices', 'Check auction results', 'Filter by budget'],
    critic: ['Find issues with the platform', 'Check data quality', 'Compare with other sources'],
    dealer: ['Browse inventory', 'Check market prices', 'Find undervalued vehicles'],
    casual_enthusiast: ['Browse cool cars', 'Look at photos', 'Discover interesting vehicles'],
    platform_owner: ['Audit data coverage', 'Spot-check quality', 'Find broken pipelines', 'Check admin pages', 'Verify metrics'],
    dev: ['Find console errors', 'Audit network requests', 'Check performance', 'Test edge cases', 'Verify accessibility'],
  };

  // Map persona to patience (critics/experts are less patient with bad UX)
  const patienceByType: Record<string, number> = {
    helpful_expert: 6,
    serious_buyer: 5,
    critic: 3,
    dealer: 4,
    casual_enthusiast: 8,
    platform_owner: 2, // Skylar: impatient with blockers
    dev: 4,
  };

  // Map persona to tech savviness
  const techByType: Record<string, number> = {
    helpful_expert: 8,
    serious_buyer: 6,
    critic: 7,
    dealer: 5,
    casual_enthusiast: 4,
    platform_owner: 9,
    dev: 10,
  };

  return {
    id: row.id,
    slug: `persona_${row.username.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    name: `${row.username} (${row.primary_persona.replace(/_/g, ' ')})`,
    description: `Real ${row.platform} commenter: ${row.total_comments} comments, ${row.primary_persona}`,
    behavior_profile,
    goals: goalsByType[row.primary_persona] || goalsByType.casual_enthusiast,
    patience_level: patienceByType[row.primary_persona] || 6,
    tech_savviness: techByType[row.primary_persona] || 5,
  };
}

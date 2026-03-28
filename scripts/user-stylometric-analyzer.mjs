#!/usr/bin/env node
/**
 * User Stylometric Analyzer — Layer 0 of the Persona Simulation Pipeline
 *
 * Computes the unconscious writing fingerprint from a user's comment history.
 * These features are produced without dictionaries or AI — pure math on text.
 *
 * Methodology grounding:
 *   - Mosteller & Wallace (1964): function word frequencies for authorship
 *   - Yule (1944): vocabulary richness measurement (K characteristic)
 *   - Pennebaker & King (1999): linguistic style as individual difference
 *   - Hyland (1998): hedging/boosting as expertise signal
 *   - Stamatatos (2009): character/word-level stylometric features
 *
 * The automotive domain has a unique property: expertise is EPISODIC and
 * ACCUMULATIVE, not trait-stable. A user may specialize in Mustangs for 5 years
 * then flip to trucks. The paint expert becomes the mechanical expert.
 * Each era is a palimpsest layer — visible, not erased.
 *
 * The sampler therefore stratifies by BOTH time period AND vehicle category
 * to capture the full expertise landscape including phase transitions.
 *
 * Usage:
 *   node scripts/user-stylometric-analyzer.mjs --username 911r
 *   node scripts/user-stylometric-analyzer.mjs --username 911r --save
 *   node scripts/user-stylometric-analyzer.mjs --top 20 --save
 *   node scripts/user-stylometric-analyzer.mjs --username 1600veloce --eras
 */

import pg from 'pg';
import { parseArgs } from 'node:util';

const { Pool } = pg;

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// Use pooler connection directly — DATABASE_URL in .env is a placeholder
const DB_URL = `postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

const pool = new Pool({ connectionString: DB_URL });

// ─── FUNCTION WORDS ──────────────────────────────────────────────────────────
// The top 100 English function words. These are produced unconsciously and are
// the single most diagnostic feature for authorship (Mosteller & Wallace 1964).
// Topic-independent — they reveal HOW someone thinks, not WHAT they think about.

const FUNCTION_WORDS = [
  'the','of','and','to','a','in','is','it','that','was','for','on','are','with',
  'as','i','his','they','be','at','one','have','this','from','or','had','by',
  'but','some','what','there','we','can','out','other','were','all','your','when',
  'up','use','how','said','an','each','she','which','do','their','if','will',
  'way','about','many','then','them','would','like','so','these','her','has',
  'him','could','no','make','than','been','its','who','did','get','may','after',
  'into','just','also','very','much','not','my','me','more','you','he','well',
  'only','now','know','most','really','think','still','too','any','here','own',
  'going','should','because','where','thing','does','right','want'
];

// ─── HEDGING MARKERS (Hyland 1998) ──────────────────────────────────────────
// Epistemic hedges signal uncertainty. Expert writers hedge precisely and
// strategically; novices hedge vaguely. The RATIO of hedging to boosting
// is more diagnostic than either alone.

const HEDGE_WORDS = [
  'might','could','may','perhaps','possibly','probably','arguably','likely',
  'suggest','indicate','appear','seem','tend','assume','believe','guess',
  'suspect','imagine','suppose','roughly','approximately','somewhat','fairly',
  'usually','generally','typically','often','sometimes','occasionally'
];

const BOOST_WORDS = [
  'clearly','obviously','definitely','certainly','absolutely','undoubtedly',
  'always','never','every','none','must','guarantee','prove','demonstrate',
  'without doubt','no question','for sure','hands down','no doubt','of course'
];

// ─── STYLOMETRIC FUNCTIONS ───────────────────────────────────────────────────

/**
 * Tokenize text into sentences. Handles abbreviations, URLs, and common
 * automotive patterns (e.g., "3.0L", "No. 45", "$12,500").
 */
function splitSentences(text) {
  if (!text) return [];
  // Protect common abbreviations and patterns from sentence splitting
  let protected_ = text
    .replace(/(\d+)\./g, '$1\u0000')        // numbers before dots: "3.0L"
    .replace(/\b(Mr|Mrs|Ms|Dr|Jr|Sr|St|No|vs|etc|approx|orig|incl)\./gi, '$1\u0000')
    .replace(/(\.com|\.org|\.net|\.co)/gi, '\u0000com')  // URLs
    .replace(/\.\.\./g, '\u0001');           // ellipsis → protect

  let sentences = protected_
    .split(/[.!?]+/)
    .map(s => s.replace(/\u0000/g, '.').replace(/\u0001/g, '...').trim())
    .filter(s => s.length > 2);

  return sentences;
}

/**
 * Tokenize into words. Strips punctuation but preserves hyphenated compounds
 * and alphanumeric codes (e.g., "Z28", "L88", "WP0AA29962S621619").
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .split(/[\s,;:()[\]{}"]+/)
    .map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
    .filter(w => w.length > 0);
}

/**
 * Compute Yule's K characteristic — a vocabulary richness measure that is
 * approximately independent of text length (Yule 1944).
 *
 * K = 10^4 * (M2 - N) / N^2
 * where M2 = sum(i^2 * V(i)) for frequency spectrum V(i) = count of words
 * appearing exactly i times, and N = total words.
 *
 * Lower K = richer vocabulary. Typical ranges:
 *   - Literary prose: 80-120
 *   - Academic writing: 100-150
 *   - Forum comments: 120-200+
 *   - Formulaic writing: 200+
 */
function yulesK(words) {
  if (words.length < 10) return null;

  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Build frequency spectrum: spectrum[i] = count of words appearing exactly i times
  const spectrum = {};
  for (const count of Object.values(freq)) {
    spectrum[count] = (spectrum[count] || 0) + 1;
  }

  const N = words.length;
  let M2 = 0;
  for (const [i, vi] of Object.entries(spectrum)) {
    M2 += (Number(i) ** 2) * vi;
  }

  if (N <= 1) return null;
  return 1e4 * (M2 - N) / (N * N);
}

/**
 * Type-Token Ratio — simplest vocabulary diversity measure.
 * unique_words / total_words. Range 0-1.
 *
 * WARNING: Highly length-dependent. Only comparable across similar-length texts.
 * For cross-user comparison, use Yule's K instead.
 */
function typeTokenRatio(words) {
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}

/**
 * Hapax legomena ratio — words appearing exactly once / total unique words.
 * High hapax ratio = wider vocabulary reach, more unusual word choices.
 */
function hapaxRatio(words) {
  if (words.length === 0) return 0;
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const hapax = Object.values(freq).filter(c => c === 1).length;
  const unique = new Set(words).size;
  return unique > 0 ? hapax / unique : 0;
}

/**
 * Function word frequency profile — the unconscious fingerprint.
 * Returns normalized frequencies (per 1000 words) for each function word.
 */
function functionWordProfile(words) {
  if (words.length === 0) return {};
  const total = words.length;
  const counts = {};
  for (const w of words) {
    if (FUNCTION_WORDS.includes(w)) {
      counts[w] = (counts[w] || 0) + 1;
    }
  }
  const profile = {};
  for (const [w, c] of Object.entries(counts)) {
    profile[w] = Math.round((c / total) * 1000 * 100) / 100; // per 1000 words, 2 decimal
  }
  return profile;
}

/**
 * Punctuation signature — rates per sentence.
 */
function punctuationProfile(text, sentenceCount) {
  if (!text || sentenceCount === 0) return {};
  const sc = Math.max(sentenceCount, 1);
  return {
    comma_rate: Math.round(((text.match(/,/g) || []).length / sc) * 100) / 100,
    exclamation_rate: Math.round(((text.match(/!/g) || []).length / sc) * 100) / 100,
    question_rate: Math.round(((text.match(/\?/g) || []).length / sc) * 100) / 100,
    dash_rate: Math.round(((text.match(/[—–-]{2,}|—/g) || []).length / sc) * 100) / 100,
    ellipsis_rate: Math.round(((text.match(/\.{3}/g) || []).length / sc) * 100) / 100,
    paren_rate: Math.round(((text.match(/\(/g) || []).length / sc) * 100) / 100,
    at_mention_rate: Math.round(((text.match(/@\w+/g) || []).length / sc) * 100) / 100,
  };
}

/**
 * Hedging and boosting density — Hyland's epistemic markers.
 * Returns rates per 1000 words and the ratio.
 */
function epistemicProfile(words) {
  if (words.length === 0) return { hedge_density: 0, boost_density: 0, hedge_boost_ratio: null };

  let hedges = 0, boosts = 0;
  const text = words.join(' ');

  for (const h of HEDGE_WORDS) {
    const re = new RegExp(`\\b${h}\\b`, 'gi');
    hedges += (text.match(re) || []).length;
  }
  for (const b of BOOST_WORDS) {
    const re = new RegExp(`\\b${b.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    boosts += (text.match(re) || []).length;
  }

  const perK = 1000 / words.length;
  return {
    hedge_density: Math.round(hedges * perK * 100) / 100,
    boost_density: Math.round(boosts * perK * 100) / 100,
    hedge_boost_ratio: boosts > 0 ? Math.round((hedges / boosts) * 100) / 100 : (hedges > 0 ? Infinity : null),
  };
}

/**
 * Opening pattern classifier — how do they start comments?
 * The first 3-5 words reveal social orientation.
 */
function classifyOpening(text) {
  if (!text) return 'unknown';
  const lower = text.trim().toLowerCase();

  if (/^@\w+/.test(lower)) return '@mention';
  if (/^(hello|hi|hey|greetings|morning|evening)\b/.test(lower)) return 'greeting';
  if (/^(great|beautiful|stunning|gorgeous|wow|amazing|nice|love)\b/.test(lower)) return 'exclamation';
  if (/^(i |i'|my |we |our )\b/.test(lower)) return 'self_reference';
  if (/^(this |that |the |these |those )\b/.test(lower)) return 'demonstrative';
  if (/^(what|how|why|where|when|who|is |are |does |did |can |will )\b/.test(lower)) return 'question';
  if (/^(not |no |don't|doesn't|never)\b/.test(lower)) return 'negation';
  if (/^\$|^\d/.test(lower)) return 'numeric';
  if (/^(as |just |also |well |so )\b/.test(lower)) return 'continuation';
  return 'other';
}

/**
 * Self/other reference rates — LIWC's most basic social orientation dimension.
 * High self-reference = experiential authority. High other-reference = social engagement.
 */
function referenceProfile(words) {
  if (words.length === 0) return { self_rate: 0, other_rate: 0 };

  const selfWords = new Set(['i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'mine', 'myself']);
  const otherWords = new Set(['you', "you're", "you've", "you'd", "you'll", 'your', 'yours', 'yourself']);

  let self_ = 0, other = 0;
  for (const w of words) {
    if (selfWords.has(w)) self_++;
    if (otherWords.has(w)) other++;
  }

  const perK = 1000 / words.length;
  return {
    self_rate: Math.round(self_ * perK * 100) / 100,
    other_rate: Math.round(other * perK * 100) / 100,
  };
}

// ─── SINGLE COMMENT ANALYSIS ────────────────────────────────────────────────

function analyzeComment(text) {
  const sentences = splitSentences(text);
  const words = tokenize(text);
  const sentenceLengths = sentences.map(s => tokenize(s).length).filter(l => l > 0);

  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  const slVariance = sentenceLengths.length > 1
    ? sentenceLengths.reduce((sum, l) => sum + (l - avgSentenceLength) ** 2, 0) / (sentenceLengths.length - 1)
    : 0;

  return {
    char_count: text.length,
    word_count: words.length,
    sentence_count: sentenceLengths.length,
    avg_sentence_length: Math.round(avgSentenceLength * 100) / 100,
    sentence_length_stddev: Math.round(Math.sqrt(slVariance) * 100) / 100,
    avg_word_length: words.length > 0
      ? Math.round((words.reduce((s, w) => s + w.length, 0) / words.length) * 100) / 100
      : 0,
    type_token_ratio: Math.round(typeTokenRatio(words) * 1000) / 1000,
    hapax_ratio: Math.round(hapaxRatio(words) * 1000) / 1000,
    yules_k: yulesK(words),
    punctuation: punctuationProfile(text, sentenceLengths.length),
    opening_pattern: classifyOpening(text),
    references: referenceProfile(words),
    epistemic: epistemicProfile(words),
    // Return raw words for aggregation
    _words: words,
  };
}

// ─── USER-LEVEL AGGREGATION ─────────────────────────────────────────────────

function aggregateProfiles(commentAnalyses) {
  const n = commentAnalyses.length;
  if (n === 0) return null;

  // Collect all words across all comments for corpus-level metrics
  const allWords = commentAnalyses.flatMap(c => c._words);

  // Sentence length distribution
  const allSentenceLengths = commentAnalyses.map(c => c.avg_sentence_length).filter(v => v > 0);
  const avgSL = allSentenceLengths.reduce((a, b) => a + b, 0) / allSentenceLengths.length;
  const slVar = allSentenceLengths.reduce((s, v) => s + (v - avgSL) ** 2, 0) / Math.max(allSentenceLengths.length - 1, 1);

  // Comment length distribution
  const wordCounts = commentAnalyses.map(c => c.word_count).sort((a, b) => a - b);
  const p10 = wordCounts[Math.floor(n * 0.1)] || 0;
  const p50 = wordCounts[Math.floor(n * 0.5)] || 0;
  const p90 = wordCounts[Math.floor(n * 0.9)] || 0;

  // Opening pattern distribution
  const openingCounts = {};
  for (const c of commentAnalyses) {
    openingCounts[c.opening_pattern] = (openingCounts[c.opening_pattern] || 0) + 1;
  }
  const openingDist = {};
  for (const [k, v] of Object.entries(openingCounts)) {
    openingDist[k] = Math.round((v / n) * 1000) / 1000;
  }

  // Aggregate punctuation
  const punctKeys = ['comma_rate', 'exclamation_rate', 'question_rate', 'dash_rate', 'ellipsis_rate', 'paren_rate', 'at_mention_rate'];
  const avgPunct = {};
  for (const k of punctKeys) {
    const vals = commentAnalyses.map(c => c.punctuation[k] || 0);
    avgPunct[k] = Math.round((vals.reduce((a, b) => a + b, 0) / n) * 100) / 100;
  }

  // Aggregate references
  const avgSelfRate = commentAnalyses.reduce((s, c) => s + c.references.self_rate, 0) / n;
  const avgOtherRate = commentAnalyses.reduce((s, c) => s + c.references.other_rate, 0) / n;

  // Aggregate epistemic
  const avgHedge = commentAnalyses.reduce((s, c) => s + c.epistemic.hedge_density, 0) / n;
  const avgBoost = commentAnalyses.reduce((s, c) => s + c.epistemic.boost_density, 0) / n;

  // Corpus-level vocabulary metrics (across ALL comments — captures total range)
  const corpusTTR = typeTokenRatio(allWords);
  const corpusHapax = hapaxRatio(allWords);
  const corpusYulesK = yulesK(allWords);

  // Function word profile (corpus level)
  const fwProfile = functionWordProfile(allWords);
  // Sort by frequency, take top 20
  const topFW = Object.entries(fwProfile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});

  return {
    sample_size: n,
    total_words: allWords.length,

    writing_signature: {
      sentence_length: {
        mean: Math.round(avgSL * 100) / 100,
        stddev: Math.round(Math.sqrt(slVar) * 100) / 100,
      },
      comment_length: {
        p10, median: p50, p90,
        mean: Math.round(wordCounts.reduce((a, b) => a + b, 0) / n),
      },
      avg_word_length: Math.round(
        (commentAnalyses.reduce((s, c) => s + c.avg_word_length, 0) / n) * 100
      ) / 100,
    },

    vocabulary: {
      corpus_ttr: Math.round(corpusTTR * 1000) / 1000,
      corpus_hapax_ratio: Math.round(corpusHapax * 1000) / 1000,
      corpus_yules_k: corpusYulesK ? Math.round(corpusYulesK) : null,
      unique_words: new Set(allWords).size,
    },

    function_word_fingerprint: topFW,

    punctuation_signature: avgPunct,

    opening_patterns: openingDist,

    reference_style: {
      self_rate: Math.round(avgSelfRate * 100) / 100,
      other_rate: Math.round(avgOtherRate * 100) / 100,
    },

    epistemic_stance: {
      hedge_density: Math.round(avgHedge * 100) / 100,
      boost_density: Math.round(avgBoost * 100) / 100,
      hedge_boost_ratio: avgBoost > 0 ? Math.round((avgHedge / avgBoost) * 100) / 100 : null,
    },
  };
}

// ─── ERA DETECTION ──────────────────────────────────────────────────────────
// The "SAE versus metric diorama" — detect phase transitions in a user's
// expertise landscape. A user who does 5 years of Mustangs then flips to
// trucks has two distinct eras, each with their own stylometric fingerprint.

function detectEras(comments) {
  if (comments.length < 20) return [{ label: 'all', comments }];

  // Sort by date
  const sorted = [...comments].sort((a, b) =>
    new Date(a.posted_at || 0) - new Date(b.posted_at || 0)
  );

  // Build make-timeline: for each quarter, what's the dominant make?
  const quarters = {};
  for (const c of sorted) {
    if (!c.posted_at || !c.make) continue;
    const d = new Date(c.posted_at);
    const q = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!quarters[q]) quarters[q] = {};
    quarters[q][c.make] = (quarters[q][c.make] || 0) + 1;
  }

  // Find the dominant make per quarter
  const quarterDominant = {};
  for (const [q, makes] of Object.entries(quarters)) {
    const sorted_ = Object.entries(makes).sort((a, b) => b[1] - a[1]);
    quarterDominant[q] = { make: sorted_[0][0], count: sorted_[0][1], total: Object.values(makes).reduce((a, b) => a + b, 0) };
  }

  // Detect era boundaries: when the dominant make shifts for 2+ quarters
  const qKeys = Object.keys(quarterDominant).sort();
  const eras = [];
  let currentEra = { start: qKeys[0], dominant: quarterDominant[qKeys[0]]?.make, quarters: [qKeys[0]] };

  for (let i = 1; i < qKeys.length; i++) {
    const q = qKeys[i];
    const dom = quarterDominant[q]?.make;

    if (dom !== currentEra.dominant) {
      // Check if next quarter also shifts (not just noise)
      const next = qKeys[i + 1];
      const nextDom = next ? quarterDominant[next]?.make : dom;

      if (nextDom !== currentEra.dominant || i === qKeys.length - 1) {
        // Real shift — close current era, start new one
        currentEra.end = qKeys[i - 1];
        eras.push(currentEra);
        currentEra = { start: q, dominant: dom, quarters: [q] };
      } else {
        currentEra.quarters.push(q);
      }
    } else {
      currentEra.quarters.push(q);
    }
  }
  currentEra.end = qKeys[qKeys.length - 1];
  eras.push(currentEra);

  // Attach comments to eras
  return eras.map(era => {
    const startDate = new Date(era.start.replace('-Q', '-0').replace('Q1', '01').replace('Q2', '04').replace('Q3', '07').replace('Q4', '10') + '-01');
    // Parse end quarter to end of that quarter
    const endQ = era.end.match(/(\d{4})-Q(\d)/);
    const endMonth = endQ ? (parseInt(endQ[2]) * 3) : 12;
    const endDate = new Date(`${endQ ? endQ[1] : '2099'}-${String(endMonth).padStart(2, '0')}-28`);

    const eraComments = sorted.filter(c => {
      const d = new Date(c.posted_at || 0);
      return d >= startDate && d <= endDate;
    });

    return {
      label: `${era.start} → ${era.end} (${era.dominant})`,
      dominant_make: era.dominant,
      quarter_count: era.quarters.length,
      start: era.start,
      end: era.end,
      comments: eraComments,
    };
  }).filter(e => e.comments.length >= 5);
}

// ─── STRATIFIED SAMPLER ─────────────────────────────────────────────────────
// Sample comments stratified by era AND vehicle category to capture the full
// expertise landscape. Does NOT randomly sample — ensures coverage of the
// user's complete behavioral range.

function stratifiedSample(comments, maxTotal = 500) {
  if (comments.length <= maxTotal) return comments;

  // Group by make (vehicle category)
  const byMake = {};
  const noMake = [];
  for (const c of comments) {
    if (c.make) {
      if (!byMake[c.make]) byMake[c.make] = [];
      byMake[c.make].push(c);
    } else {
      noMake.push(c);
    }
  }

  // Sort makes by frequency
  const makes = Object.entries(byMake).sort((a, b) => b[1].length - a[1].length);

  // Allocate proportionally but with minimum representation
  const MIN_PER_MAKE = 3;
  const makesWithMin = makes.filter(([_, cs]) => cs.length >= MIN_PER_MAKE);
  const budget = maxTotal - Math.min(noMake.length, 20); // reserve up to 20 for unmapped

  let allocated = 0;
  const sampled = [];

  for (const [make, cs] of makesWithMin) {
    const proportion = cs.length / comments.length;
    const allocation = Math.max(MIN_PER_MAKE, Math.round(proportion * budget));
    const take = Math.min(allocation, cs.length);

    // Within each make: sample across time (first 20%, middle, last 20%, random)
    const sorted_ = [...cs].sort((a, b) => new Date(a.posted_at || 0) - new Date(b.posted_at || 0));
    const early = sorted_.slice(0, Math.ceil(take * 0.2));
    const late = sorted_.slice(-Math.ceil(take * 0.2));
    const middlePool = sorted_.slice(Math.ceil(sorted_.length * 0.2), -Math.ceil(sorted_.length * 0.2));

    // Shuffle middle and take remaining budget
    const remaining = take - early.length - late.length;
    const middleSample = middlePool.sort(() => Math.random() - 0.5).slice(0, Math.max(0, remaining));

    sampled.push(...early, ...middleSample, ...late);
    allocated += take;

    if (allocated >= budget) break;
  }

  // Add some from unmapped
  sampled.push(...noMake.sort(() => Math.random() - 0.5).slice(0, 20));

  return sampled;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function fetchUserComments(username) {
  // For very large users (50K+ comments), use SQL-side sampling to avoid OOM.
  // We pull up to 5000 comments — enough for stratified sampling and era detection.
  // The sample is spread across the timeline via TABLESAMPLE or modular selection.
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM auction_comments WHERE author_username = $1 AND comment_text IS NOT NULL AND word_count >= 5`,
    [username]
  );
  const totalCount = parseInt(countRows[0].cnt);

  let query;
  const params = [username];

  if (totalCount > 10000) {
    // For very large users (10K+): skip vehicle JOIN to stay fast.
    // Taste fingerprint/eras won't work without make data — acceptable tradeoff.
    query = `
      SELECT ac.comment_text, ac.word_count, ac.comment_type, ac.posted_at,
             ac.is_seller, ac.bid_amount, ac.comment_likes,
             NULL::text as make, NULL::text as model, NULL::int as year
      FROM auction_comments ac
      WHERE ac.author_username = $1
      AND ac.comment_text IS NOT NULL
      AND ac.word_count >= 5
      ORDER BY ac.posted_at ASC NULLS LAST
    `;
  } else {
    query = `
      SELECT ac.comment_text, ac.word_count, ac.comment_type, ac.posted_at,
             ac.is_seller, ac.bid_amount, ac.comment_likes,
             v.make, v.model, v.year
      FROM auction_comments ac
      LEFT JOIN vehicles v ON v.id = ac.vehicle_id
      WHERE ac.author_username = $1
      AND ac.comment_text IS NOT NULL
      AND ac.word_count >= 5
      ORDER BY ac.posted_at ASC NULLS LAST
    `;
  }

  const { rows } = await pool.query(query, params);
  return rows;
}

async function fetchUserCommentCount(username) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM auction_comments WHERE author_username = $1 AND comment_text IS NOT NULL AND word_count >= 5`,
    [username]
  );
  return parseInt(rows[0].cnt);
}

async function analyzeUser(username, opts = {}) {
  const quiet = opts.quiet || false;
  if (!quiet) console.log(`\n═══ Analyzing: ${username} ═══\n`);

  const allComments = await fetchUserComments(username);
  if (!quiet) console.log(`  Total comments: ${allComments.length}`);

  if (allComments.length < 10) {
    if (!quiet) console.log('  Too few comments for reliable analysis');
    return null;
  }

  // Stratified sample
  const sampled = stratifiedSample(allComments, 500);
  if (!quiet) console.log(`  Sampled: ${sampled.length} (stratified by make + time)`);

  // Analyze each comment
  const analyses = sampled
    .filter(c => c.comment_text && c.comment_text.length > 10)
    .map(c => ({
      ...analyzeComment(c.comment_text),
      make: c.make,
      posted_at: c.posted_at,
      comment_type: c.comment_type,
      is_seller: c.is_seller,
    }));

  // Aggregate
  const profile = aggregateProfiles(analyses);
  if (!profile) return null;

  // Add identity
  profile.username = username;
  profile.total_comments_in_db = allComments.length;

  // Era detection
  if (opts.eras) {
    const eras = detectEras(allComments);
    if (!quiet) console.log(`  Detected ${eras.length} era(s):`);

    profile.eras = [];
    for (const era of eras) {
      if (!quiet) console.log(`    ${era.label} (${era.comments.length} comments)`);
      const eraSampled = stratifiedSample(era.comments, 200);
      const eraAnalyses = eraSampled
        .filter(c => c.comment_text && c.comment_text.length > 10)
        .map(c => analyzeComment(c.comment_text));
      const eraProfile = aggregateProfiles(eraAnalyses);
      if (eraProfile) {
        profile.eras.push({
          label: era.label,
          dominant_make: era.dominant_make,
          period: `${era.start} → ${era.end}`,
          comment_count: era.comments.length,
          ...eraProfile,
        });
      }
    }
  }

  // Comment type distribution (behavioral signal)
  const typeDist = {};
  for (const c of allComments) {
    typeDist[c.comment_type || 'unknown'] = (typeDist[c.comment_type || 'unknown'] || 0) + 1;
  }
  profile.comment_type_distribution = {};
  for (const [k, v] of Object.entries(typeDist)) {
    profile.comment_type_distribution[k] = Math.round((v / allComments.length) * 1000) / 1000;
  }

  // Make distribution (taste fingerprint)
  const makeDist = {};
  for (const c of allComments) {
    if (c.make) makeDist[c.make] = (makeDist[c.make] || 0) + 1;
  }
  const totalWithMake = Object.values(makeDist).reduce((a, b) => a + b, 0);
  profile.taste_fingerprint = Object.entries(makeDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .reduce((obj, [k, v]) => { obj[k] = Math.round((v / totalWithMake) * 1000) / 1000; return obj; }, {});

  return profile;
}

async function saveProfile(profile, quiet = false) {
  // Upsert into author_personas or a new table
  // For now, store as JSONB in bat_user_profiles.metadata
  await pool.query(`
    UPDATE bat_user_profiles
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stylometric_profile', $2::jsonb),
        updated_at = now()
    WHERE username = $1
  `, [profile.username, JSON.stringify(profile)]);
  if (!quiet) console.log(`  Saved to bat_user_profiles.metadata.stylometric_profile`);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    username: { type: 'string', short: 'u' },
    top: { type: 'string', short: 't' },
    save: { type: 'boolean', short: 's', default: false },
    eras: { type: 'boolean', short: 'e', default: false },
    json: { type: 'boolean', default: false },
    'skip-existing': { type: 'boolean', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
  },
  strict: false,
});

async function main() {
  try {
    if (args.username) {
      const profile = await analyzeUser(args.username, { eras: args.eras });
      if (profile) {
        if (args.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          printProfile(profile);
        }
        if (args.save) await saveProfile(profile);
      }
    } else if (args.top) {
      const limit = parseInt(args.top) || 20;
      const skipExisting = args['skip-existing'];

      let query;
      if (skipExisting) {
        query = `
          SELECT username, total_comments
          FROM bat_user_profiles
          WHERE total_comments >= 100
          AND total_comments < 40000
          AND username NOT IN ('bringatrailer', 'BringATrailer')
          AND (metadata->>'stylometric_profile' IS NULL)
          ORDER BY total_comments DESC
          LIMIT $1
        `;
      } else {
        query = `
          SELECT username, total_comments
          FROM bat_user_profiles
          WHERE total_comments >= 100
          AND total_comments < 40000
          AND username NOT IN ('bringatrailer', 'BringATrailer')
          ORDER BY total_comments DESC
          LIMIT $1
        `;
      }

      const { rows } = await pool.query(query, [limit]);

      console.log(`Analyzing ${rows.length} users by comment count${skipExisting ? ' (skipping existing profiles)' : ''}...\n`);

      let saved = 0, failed = 0, skipped = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const profile = await analyzeUser(row.username, { eras: args.eras, quiet: args.quiet });
          if (profile) {
            if (!args.json && !args.quiet) printProfile(profile);
            if (args.save) await saveProfile(profile, args.quiet);
            saved++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.log(`  ✗ FAILED: ${row.username} — ${err.message}`);
          failed++;
        }
        if ((i + 1) % 50 === 0) {
          console.log(`\n  ── Progress: ${i + 1}/${rows.length} (${saved} saved, ${failed} failed, ${skipped} skipped) ──\n`);
        }
      }
      console.log(`\n═══ BATCH COMPLETE: ${saved} saved, ${failed} failed, ${skipped} skipped out of ${rows.length} ═══\n`);
    } else {
      console.log('Usage:');
      console.log('  node scripts/user-stylometric-analyzer.mjs --username 911r');
      console.log('  node scripts/user-stylometric-analyzer.mjs --username 911r --eras --save');
      console.log('  node scripts/user-stylometric-analyzer.mjs --top 20 --save');
      console.log('  node scripts/user-stylometric-analyzer.mjs --username 911r --json');
    }
  } finally {
    await pool.end();
  }
}

function printProfile(p) {
  console.log(`\n  ── Writing Signature ──`);
  console.log(`  Sentence length:  μ=${p.writing_signature.sentence_length.mean} σ=${p.writing_signature.sentence_length.stddev}`);
  console.log(`  Comment length:   p10=${p.writing_signature.comment_length.p10} med=${p.writing_signature.comment_length.median} p90=${p.writing_signature.comment_length.p90} mean=${p.writing_signature.comment_length.mean}`);
  console.log(`  Avg word length:  ${p.writing_signature.avg_word_length}`);

  console.log(`\n  ── Vocabulary ──`);
  console.log(`  TTR: ${p.vocabulary.corpus_ttr}  Hapax: ${p.vocabulary.corpus_hapax_ratio}  Yule's K: ${p.vocabulary.corpus_yules_k}  Unique: ${p.vocabulary.unique_words}`);

  console.log(`\n  ── Function Word Fingerprint (top 10) ──`);
  const fwEntries = Object.entries(p.function_word_fingerprint).slice(0, 10);
  console.log(`  ${fwEntries.map(([w, f]) => `${w}:${f}`).join('  ')}`);

  console.log(`\n  ── Punctuation Signature ──`);
  const ps = p.punctuation_signature;
  console.log(`  , ${ps.comma_rate}/sent  ! ${ps.exclamation_rate}/sent  ? ${ps.question_rate}/sent  — ${ps.dash_rate}/sent  … ${ps.ellipsis_rate}/sent  @ ${ps.at_mention_rate}/sent`);

  console.log(`\n  ── Opening Patterns ──`);
  const ops = Object.entries(p.opening_patterns).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  ${ops.map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join('  ')}`);

  console.log(`\n  ── Reference Style ──`);
  console.log(`  Self (I/me/my): ${p.reference_style.self_rate}/1K words  Other (you/your): ${p.reference_style.other_rate}/1K words`);

  console.log(`\n  ── Epistemic Stance ──`);
  console.log(`  Hedging: ${p.epistemic_stance.hedge_density}/1K  Boosting: ${p.epistemic_stance.boost_density}/1K  Ratio: ${p.epistemic_stance.hedge_boost_ratio}`);

  console.log(`\n  ── Taste Fingerprint (top 5) ──`);
  const taste = Object.entries(p.taste_fingerprint).slice(0, 5);
  console.log(`  ${taste.map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join('  ')}`);

  console.log(`\n  ── Comment Roles ──`);
  const roles = Object.entries(p.comment_type_distribution).sort((a, b) => b[1] - a[1]);
  console.log(`  ${roles.map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join('  ')}`);

  if (p.eras?.length > 1) {
    console.log(`\n  ── Eras (${p.eras.length} detected) ──`);
    for (const era of p.eras) {
      console.log(`\n    ${era.label} (${era.comment_count} comments)`);
      console.log(`    Sentence length: μ=${era.writing_signature.sentence_length.mean}`);
      console.log(`    Vocabulary K: ${era.vocabulary.corpus_yules_k}`);
      console.log(`    Hedge/Boost: ${era.epistemic_stance.hedge_density}/${era.epistemic_stance.boost_density}`);
    }
  }

  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });

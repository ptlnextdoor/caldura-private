import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repairContexts = JSON.parse(readFileSync(join(here, '../data/repair_contexts.json'), 'utf8'));

const PRODUCT_PATTERNS = [
  ['button-socket-cap-screw', ['button socket cap screw', 'button soc cap screw', 'button socket cap scr', 'button soc cap scr', 'btn socket cap screw', 'btn soc cap screw', 'bhcs']],
  ['socket-head-cap-screw', ['socket head cap screw', 'socket head cap scr', 'soc head cap screw', 'soc head cap scr', 'shcs']],
  ['phillips-pan-machine-screw', ['phillips pan machine screw', 'phillips pan mach screw', 'phil pan machine screw', 'phil pan mach screw']],
  ['hex-head-bolt', ['hex head bolt', 'hx hd bolt', 'hhb']],
  ['hex-cap-screw', ['hex cap screw', 'hex cap scr', 'hx cap screw', 'hx cap scr', 'hex bolt', 'hcs']],
  ['hex-nut', ['hex nut', 'hex nuts', 'hx nut', 'hx nuts']],
  ['flat-washer', ['flat washer', 'flat washers', 'flat wshr', 'washer', 'washers', 'fw', 'fwsh']],
  ['lock-washer', ['lock washer', 'lock washers', 'lock wshr']],
  ['threaded-rod', ['threaded rod', 'full thread rod', 'thread rod']],
  ['lag-screw', ['lag screw', 'lag screws', 'lag scr']],
  ['tap-bolt', ['tap bolt', 'tap bolts']],
];

const MATERIAL_PATTERNS = [
  ['18-8-stainless-steel', ['18-8 stainless', '18 8 stainless', '18-8 ss', '18 8 ss']],
  ['316-stainless-steel', ['316 stainless', '316 ss']],
  ['a2-stainless-steel', ['a2 stainless', 'a2 ss']],
  ['alloy', ['alloy']],
  ['brass', ['brass']],
  ['steel', ['steel']],
];

const FINISH_PATTERNS = [
  ['yellow-zinc', ['yellow zinc', 'yellow zn', 'yel zinc', 'yel zn']],
  ['mechanical-zinc', ['mechanical zinc', 'mech zinc', 'mech zn']],
  ['black-oxide', ['black oxide']],
  ['hot-dip-galvanized', ['hot dip galvanized', 'hdg']],
  ['zinc', ['zinc', 'zn']],
  ['plain', ['plain', 'pln']],
];

let cache;

export function getData() {
  if (cache) return cache;

  const catalog = parseCsv(readFileSync(join(here, '../data/catalog.csv'), 'utf8')).map((row) => ({
    catalog_id: row.catalog_id,
    sku: row.sku,
    description: row.catalog_description,
    active: ['y', 'yes', 'true', '1', 'active'].includes(String(row.active).toLowerCase()),
  }));
  const orders = parseCsv(readFileSync(join(here, '../data/order_history.csv'), 'utf8'));
  const parsedCatalog = catalog.map((row) => parseText(row.description));
  const profiles = buildProfiles(orders, catalog, parsedCatalog);
  const docs = catalog.map((row, index) => expandedDoc(row, parsedCatalog[index]));
  const index = buildIndex(docs);

  cache = { catalog, orders, parsedCatalog, profiles, index };
  return cache;
}

export function customers() {
  const { profiles } = getData();
  return [...profiles.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      order_count: profile.orderCount,
      profile_summary: profileSummary(profile),
    }));
}

export function searchCatalog(query, customerId) {
  const started = performance.now();
  const { catalog, parsedCatalog, profiles, index } = getData();
  const repair_context = resolveRepairContext(query);
  if (repair_context?.match_behavior === 'guidance-only') {
    return {
      query: { original: query, parsed: parseText(query) },
      results: [],
      meta: {
        latency_ms: Math.round((performance.now() - started) * 10) / 10,
        candidate_count: catalog.length,
        low_confidence_overall: true,
        ambiguous_query: false,
        ambiguous_suggestions: null,
        no_verified_stocked_match: true,
        result_message: 'This repair appears to need a model-specific Apple pentalobe lower-case screw set, not a standard catalog screw.',
      },
      decision: 'guidance-only',
      repair_context,
    };
  }
  const effectiveQuery = repair_context?.canonical_query ?? query;
  const parsed = parseText(effectiveQuery);
  const profile = customerId ? profiles.get(customerId) : null;
  const referenceQuery = /\b(same|usual|again|reorder)\b|last time/i.test(query);
  const hits = bm25Search(index, effectiveQuery, catalog.length);
  const maxBm25 = Math.max(1, hits[0]?.score ?? 1);

  const candidates = hits.map(({ docId, score }) => {
    const row = catalog[docId];
    const attrs = parsedCatalog[docId];
    const matches = attributeMatches(parsed, attrs);
    const attrScore = attributeScore(parsed, matches);
    let finalScore = 0.62 * clamp(score / maxBm25, 0, 1) + 0.38 * attrScore + (row.active ? 0.015 : -0.08);
    let personalized = false;
    let personalization_note = null;

    if (profile) {
      const bias = profileBias(profile, parsed, row.sku, attrs, referenceQuery);
      if (bias.score > 0) {
        finalScore += bias.score;
        personalized = true;
        personalization_note = bias.note;
      }
    }

    if (parsed.product_type && !matches.product_type) finalScore -= 0.12;
    if (parsed.thread_spec && !matches.thread) finalScore -= 0.10;
    if (parsed.length_mm != null && !matches.length) finalScore -= 0.08;
    if (parsed.material && !matches.material) finalScore -= 0.07;
    if (parsed.finish && !matches.finish) finalScore -= 0.06;

    return {
      docId,
      finalScore: clamp(finalScore, 0, 1.25),
      attrScore,
      matches,
      personalized,
      personalization_note,
    };
  });

  candidates.sort((a, b) => (b.finalScore - a.finalScore) || (b.attrScore - a.attrScore));
  const topScore = candidates[0]?.finalScore ?? 0;
  const secondScore = candidates[1]?.finalScore ?? 0;
  const topGap = topScore - secondScore;
  const ambiguous_query = topScore > 0 && topGap < 0.06;
  const low_confidence_overall = topScore < 0.52 || parsed.extraction_confidence < 0.18;
  const topPriorSkuReference = Boolean(referenceQuery && candidates[0]?.personalization_note === 'matches previously ordered SKU');
  const safetyBlocked = repair_context?.safety_class && repair_context.safety_class !== 'low';

  const results = candidates.slice(0, 3).map((candidate, index) => {
    const row = catalog[candidate.docId];
    const analysis = analyzeEvidence(
      parsed,
      parsedCatalog[candidate.docId],
      candidate.matches,
      candidate.personalization_note,
      repair_context,
      topGap,
      topPriorSkuReference,
    );
    const conf = confidence(
      candidate.finalScore,
      topScore,
      topGap,
      parsed.extraction_confidence,
      candidate.attrScore,
      referenceQuery && candidate.personalization_note === 'matches previously ordered SKU',
    );
    const cappedConfidence = analysis.hasHardContradiction
      ? Math.min(conf, 0.40)
      : analysis.hasSoftContradiction
        ? Math.min(conf, 0.82)
        : conf;
    const canAutoOrder = index === 0
      && cappedConfidence >= 0.90
      && !analysis.hasHardContradiction
      && !safetyBlocked
      && (!ambiguous_query || topPriorSkuReference);
    return {
      rank: index + 1,
      sku: row.sku,
      catalog_id: row.catalog_id,
      description: row.description,
      active: row.active,
      score: round3(candidate.finalScore),
      model_closeness: round3(modelCloseness(candidate.finalScore)),
      confidence: round3(cappedConfidence),
      confidence_label: confidenceLabel(cappedConfidence),
      attribute_matches: candidate.matches,
      personalized: candidate.personalized,
      personalization_note: candidate.personalization_note,
      match_evidence: analysis.matchEvidence,
      review_reasons: analysis.reviewReasons,
      contradictions: analysis.contradictions,
      can_auto_order: canAutoOrder,
    };
  });

  return {
    query: { original: query, parsed },
    results,
    meta: {
      latency_ms: Math.round((performance.now() - started) * 10) / 10,
      candidate_count: catalog.length,
      low_confidence_overall,
      ambiguous_query,
      ambiguous_suggestions: ambiguous_query || low_confidence_overall ? suggestions(parsed) : null,
      no_verified_stocked_match: false,
      result_message: null,
    },
    decision: decisionFor(
      results[0]?.confidence ?? 0,
      ambiguous_query,
      Boolean(safetyBlocked),
      topPriorSkuReference,
      Boolean(results[0]?.contradictions?.some((item) => item.severity === 'hard')),
      Boolean(results[0]?.can_auto_order),
    ),
    repair_context,
  };
}

function resolveRepairContext(query) {
  const normalized = normalize(query);
  const matches = repairContexts
    .map((context) => ({ context, score: repairMatchScore(context, normalized) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!matches.length) return null;

  const { context, score } = matches[0];
  const choiceWasSelected = context.clarifying_question?.choices?.some(
    (choice) => normalize(choice.query_rewrite) === normalized,
  ) ?? false;

  return {
    detected: true,
    id: context.id,
    category: context.category,
    title: context.title,
    status: choiceWasSelected ? 'ready' : context.status,
    safety_class: context.safety_class,
    match_behavior: context.match_behavior,
    stock_status: context.stock_status,
    canonical_query: context.canonical_query,
    recommended_part: context.recommended_part,
    recommended_tool: context.recommended_tool,
    fitment_note: context.fitment_note,
    confidence: round2(clamp(context.confidence + score * 0.015 + (choiceWasSelected ? 0.08 : 0), 0.05, 0.95)),
    missing_facts: choiceWasSelected ? [] : context.missing_facts,
    clarifying_question: choiceWasSelected ? null : context.clarifying_question,
    kit: context.kit,
    warnings: context.warnings,
    provenance: context.provenance,
  };
}

function repairMatchScore(context, normalized) {
  return context.triggers.reduce((score, trigger) => {
    const normalizedTrigger = normalize(trigger);
    if (!normalized.includes(normalizedTrigger)) return score;
    return score + Math.max(1, normalizedTrigger.split(/\s+/).length);
  }, 0);
}

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.filter((items) => items.length === headers.length).map((items) =>
    Object.fromEntries(headers.map((header, index) => [header, items[index]])),
  );
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/×/g, ' x ')
    .replace(/[“”]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text)
    .replace(/["()]/g, ' ')
    .split(/\s+/)
    .flatMap((token) => expandToken(token.replace(/^[^a-z0-9/#-]+|[^a-z0-9/#-]+$/gi, '')))
    .filter((token) => token.length > 1 || token === 'x');
}

function expandToken(token) {
  const extra = {
    hx: ['hex', 'head'],
    soc: ['socket'],
    scr: ['screw'],
    hcs: ['hex', 'cap', 'screw'],
    fw: ['flat', 'washer'],
    wshr: ['washer'],
    btn: ['button'],
    phil: ['phillips'],
    mach: ['machine'],
    washers: ['washer'],
    nuts: ['nut'],
    screws: ['screw'],
    hdg: ['hot', 'dip', 'galvanized'],
    galvanized: ['hdg'],
    mech: ['mechanical'],
    mechanical: ['mech'],
    zn: ['zinc'],
    yel: ['yellow'],
    pln: ['plain'],
    ss: ['stainless'],
  };
  return token ? [token, ...(extra[token] ?? [])] : [];
}

function parseText(text) {
  const normalized = normalize(text);
  const spec = {
    thread_spec: null,
    thread_size_normalized: null,
    length_mm: null,
    length_raw: null,
    product_type: null,
    material: null,
    finish: null,
    standard: null,
    extraction_confidence: 0,
    raw_tokens_unconsumed: [],
  };

  let match = normalized.match(/\bm\s?(\d+(?:\.\d+)?)(?:[-\s](\d+\.\d+))?\b/);
  if (match) {
    spec.thread_spec = `M${trimNumber(match[1])}${match[2] ? `-${trimNumber(match[2])}` : ''}`;
    spec.thread_size_normalized = Number(match[1]);
  } else if ((match = normalized.match(/\b(\d+\/\d+)-(\d+)\b/))) {
    spec.thread_spec = match[0];
    spec.thread_size_normalized = fractionToMm(match[1]);
  } else if ((match = normalized.match(/#\s?(\d+)-(\d+)/))) {
    spec.thread_spec = `#${match[1]}-${match[2]}`;
    spec.thread_size_normalized = numberedScrewMm(match[1]);
  } else if ((match = normalized.match(/\b(\d+\/\d+)\b/))) {
    spec.thread_spec = match[1];
    spec.thread_size_normalized = fractionToMm(match[1]);
  }

  if ((match = normalized.match(/\b(\d+(?:\.\d+)?)\s*mm\b/))) {
    spec.length_raw = match[0];
    spec.length_mm = Number(match[1]);
  } else if ((match = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\b/))) {
    spec.length_raw = match[0];
    spec.length_mm = Number(match[1]) * 304.8;
  } else if ((match = normalized.match(/\b(\d+(?:-\d+\/\d+)?|\d+\/\d+)\s*(?:"|in|inch|inches)\b/))) {
    spec.length_raw = match[0];
    spec.length_mm = imperialLenToMm(match[1]);
  }

  spec.product_type = lookupPhrase(normalized, PRODUCT_PATTERNS);
  spec.material = lookupPhrase(normalized, MATERIAL_PATTERNS);
  spec.finish = lookupPhrase(normalized, FINISH_PATTERNS);

  const filled = [
    spec.thread_spec,
    spec.length_mm != null,
    spec.product_type,
    spec.material,
    spec.finish,
    spec.standard,
  ].filter(Boolean).length;
  let extraction = filled / 6;
  if (spec.thread_spec) extraction *= 1.2;
  if (spec.product_type) extraction += 0.12;
  spec.extraction_confidence = Math.min(1, extraction);
  spec.raw_tokens_unconsumed = tokens(normalized).filter((token) => !['x', 'class'].includes(token));
  return spec;
}

function lookupPhrase(text, entries) {
  let winner = null;
  for (const [value, phrases] of entries) {
    for (const phrase of phrases) {
      if (` ${text} `.includes(` ${phrase} `) && (!winner || phrase.length > winner.phrase.length)) {
        winner = { value, phrase };
      }
    }
  }
  return winner?.value ?? null;
}

function expandedDoc(row, attrs) {
  return [
    row.sku,
    row.catalog_id,
    row.description,
    attrs.product_type,
    attrs.product_type?.replace(/-/g, ' '),
    attrs.material,
    attrs.material?.replace(/-/g, ' '),
    attrs.finish,
    attrs.finish?.replace(/-/g, ' '),
  ].filter(Boolean).join(' ');
}

function buildIndex(docs) {
  const inverted = new Map();
  const lengths = [];
  docs.forEach((doc, docId) => {
    const docTokens = tokens(doc);
    lengths.push(docTokens.length);
    for (const token of docTokens) {
      if (!inverted.has(token)) inverted.set(token, new Map());
      const postings = inverted.get(token);
      postings.set(docId, (postings.get(docId) ?? 0) + 1);
    }
  });
  return {
    inverted,
    lengths,
    avgLength: lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
    nDocs: docs.length,
    k1: 1.5,
    b: 0.75,
  };
}

function bm25Search(index, query, topK) {
  const queryTokens = new Set(tokens(query.replace(/shcs/g, 'socket head cap screw').replace(/bhcs/g, 'button socket cap screw').replace(/hhb/g, 'hex head bolt')));
  const scores = new Map();
  for (const token of queryTokens) {
    const postings = index.inverted.get(token);
    if (!postings) continue;
    const df = postings.size;
    const idf = Math.log(((index.nDocs - df + 0.5) / (df + 0.5)) + 1);
    for (const [docId, tf] of postings) {
      const docLen = index.lengths[docId];
      const denom = tf + index.k1 * (1 - index.b + index.b * docLen / Math.max(1, index.avgLength));
      scores.set(docId, (scores.get(docId) ?? 0) + idf * (tf * (index.k1 + 1)) / denom);
    }
  }
  const ranked = scores.size
    ? [...scores.entries()].map(([docId, score]) => ({ docId, score }))
    : Array.from({ length: index.nDocs }, (_, docId) => ({ docId, score: 0 }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, topK);
}

function attributeMatches(query, candidate) {
  return {
    thread: threadMatches(query, candidate),
    type: Boolean(query.product_type && query.product_type === candidate.product_type),
    product_type: Boolean(query.product_type && query.product_type === candidate.product_type),
    length: query.length_mm != null && candidate.length_mm != null && (Math.abs(query.length_mm - candidate.length_mm) <= 1 || Math.abs(query.length_mm - candidate.length_mm) / Math.max(query.length_mm, 1) <= 0.03),
    material: Boolean(query.material && query.material === candidate.material),
    finish: Boolean(query.finish && query.finish === candidate.finish),
  };
}

function attributeScore(query, matches) {
  const fields = [
    [query.thread_spec, matches.thread, 0.34],
    [query.product_type, matches.product_type, 0.28],
    [query.length_mm != null, matches.length, 0.18],
    [query.material, matches.material, 0.11],
    [query.finish, matches.finish, 0.09],
  ];
  let possible = 0;
  let score = 0;
  for (const [present, matched, weight] of fields) {
    if (present) {
      possible += weight;
      if (matched) score += weight;
    }
  }
  return possible > 0 ? score / possible : 0.15;
}

function threadMatches(query, candidate) {
  if (!query.thread_spec || !candidate.thread_spec) return false;
  const q = query.thread_spec;
  const c = candidate.thread_spec;
  return q === c || c.startsWith(`${q}-`) || q.startsWith(`${c}-`) || (
    query.thread_size_normalized != null &&
    candidate.thread_size_normalized != null &&
    Math.abs(query.thread_size_normalized - candidate.thread_size_normalized) < 0.05
  );
}

function buildProfiles(orders, catalog, parsedCatalog) {
  const bySku = new Map(catalog.map((row, index) => [row.sku, { row, attrs: parsedCatalog[index] }]));
  const profiles = new Map();
  for (const order of orders) {
    const found = bySku.get(order.sku);
    if (!found) continue;
    if (!profiles.has(order.customer_id)) {
      profiles.set(order.customer_id, {
        id: order.customer_id,
        name: order.customer_name,
        orderCount: 0,
        skus: new Set(),
        productTypes: new Map(),
        materials: new Map(),
        finishes: new Map(),
        threadSizes: new Map(),
      });
    }
    const profile = profiles.get(order.customer_id);
    profile.orderCount += 1;
    profile.skus.add(order.sku);
    inc(profile.productTypes, found.attrs.product_type, Number(order.quantity) || 1);
    inc(profile.materials, found.attrs.material, Number(order.quantity) || 1);
    inc(profile.finishes, found.attrs.finish, Number(order.quantity) || 1);
    inc(profile.threadSizes, found.attrs.thread_size_normalized, Number(order.quantity) || 1);
  }
  return profiles;
}

function profileBias(profile, parsed, sku, attrs, referenceQuery) {
  if (profile.skus.has(sku)) return { score: referenceQuery ? 0.2 : 0.11, note: 'matches previously ordered SKU' };
  if (parsed.product_type && parsed.product_type !== attrs.product_type) return { score: 0, note: null };

  let score = 0;
  let note = null;
  if (attrs.product_type && profile.productTypes.has(attrs.product_type)) {
    score += referenceQuery ? 0.075 : 0.035;
    note = 'matches usual product family';
  }
  if (attrs.material && profile.materials.has(attrs.material)) score += 0.025;
  if (attrs.finish && profile.finishes.has(attrs.finish)) score += 0.025;
  if (attrs.thread_size_normalized != null) {
    for (const size of profile.threadSizes.keys()) {
      if (Math.abs(Number(size) - attrs.thread_size_normalized) < 0.05) {
        score += 0.02;
        break;
      }
    }
  }
  return { score: Math.min(score, referenceQuery ? 0.14 : 0.08), note };
}

function profileSummary(profile) {
  return [
    `mostly ${top(profile.materials) ?? 'mixed materials'}`,
    top(profile.finishes) ?? 'mixed finishes',
    `frequent ${top(profile.productTypes) ?? 'mixed product families'}`,
  ].join(', ');
}

function modelCloseness(score) {
  return clamp(score / 1.25, 0, 1);
}

function confidence(score, topScore, topGap, parsedConfidence, attrScore, priorSkuReference) {
  if (topScore <= 0) return 0;
  const absolute = modelCloseness(score);
  const relative = clamp(score / topScore, 0, 1);
  const gapBonus = clamp(topGap * 1.3, 0, 0.08);
  const exactSignalBonus = attrScore >= 0.99 && parsedConfidence >= 0.45 ? 0.14 : 0;
  const priorBonus = priorSkuReference ? 0.24 : 0;
  const ambiguityPenalty = topGap < 0.04 ? 0.07 : 0;
  let value = 0.34 * absolute
    + 0.30 * attrScore
    + 0.18 * relative
    + 0.16 * parsedConfidence
    + gapBonus
    + exactSignalBonus
    + priorBonus
    - ambiguityPenalty;

  if (parsedConfidence < 0.18) {
    value = Math.min(value, 0.72);
  } else if (parsedConfidence < 0.35 && !priorSkuReference) {
    value = Math.min(value, 0.84);
  }
  if (topGap < 0.04 && attrScore < 0.99 && !priorSkuReference) {
    value = Math.min(value, 0.89);
  }
  return clamp(value, 0.05, 0.97);
}

function confidenceLabel(value) {
  if (value >= 0.90) return 'high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

function decisionFor(confidence, ambiguousQuery, safetyBlocked, topPriorSkuReference, topHasHardContradiction, topCanAutoOrder) {
  return topCanAutoOrder
    && confidence >= 0.90
    && (!ambiguousQuery || topPriorSkuReference)
    && !safetyBlocked
    && !topHasHardContradiction
    ? 'ready-to-order'
    : 'sales-review';
}

function analyzeEvidence(query, candidate, matches, personalizationNote, repairContext, topGap, topPriorSkuReference) {
  const matchEvidence = [];
  const reviewReasons = [];
  const contradictions = [];

  if (query.thread_spec) {
    if (matches.thread) {
      matchEvidence.push(`Thread ${query.thread_spec} matched`);
    } else {
      contradictions.push(contradiction('thread', query.thread_spec, candidate.thread_spec ?? 'missing', 'hard'));
      reviewReasons.push('Thread mismatch blocks auto-order');
    }
  }
  if (
    query.thread_spec &&
    candidate.thread_spec &&
    threadSystem(query.thread_spec) !== threadSystem(candidate.thread_spec)
  ) {
    contradictions.push(contradiction('thread_system', threadSystem(query.thread_spec) ?? 'unknown', threadSystem(candidate.thread_spec) ?? 'unknown', 'hard'));
    reviewReasons.push('Metric/imperial thread system conflict');
  }
  if (query.product_type) {
    if (matches.product_type) {
      matchEvidence.push(`Type ${displayValue(query.product_type)} matched`);
    } else {
      contradictions.push(contradiction('type', query.product_type, candidate.product_type ?? 'missing', 'hard'));
      reviewReasons.push('Product type mismatch blocks auto-order');
    }
  }
  if (query.length_mm != null) {
    if (matches.length) {
      matchEvidence.push('Length matched');
    } else {
      contradictions.push(contradiction('length', query.length_raw ?? 'specified', candidate.length_raw ?? 'missing', 'soft'));
      reviewReasons.push('Length needs verification');
    }
  }
  if (query.material) {
    if (matches.material) {
      matchEvidence.push(`Material ${displayValue(query.material)} matched`);
    } else {
      contradictions.push(contradiction('material', query.material, candidate.material ?? 'missing', 'soft'));
      reviewReasons.push('Material mismatch needs review');
    }
  }
  if (query.finish) {
    if (matches.finish) {
      matchEvidence.push(`Finish ${displayValue(query.finish)} matched`);
    } else {
      contradictions.push(contradiction('finish', query.finish, candidate.finish ?? 'missing', 'soft'));
      reviewReasons.push('Finish mismatch needs review');
    }
  }
  if (personalizationNote === 'matches previously ordered SKU') {
    matchEvidence.push('Previous customer SKU matched');
  } else if (personalizationNote === 'matches usual product family') {
    matchEvidence.push('Customer history supports product family');
  } else if (personalizationNote) {
    matchEvidence.push(personalizationNote);
  }
  if (topGap < 0.06 && !topPriorSkuReference) {
    reviewReasons.push('Close alternatives need review');
  }
  if (repairContext?.safety_class && repairContext.safety_class !== 'low') {
    reviewReasons.push('Repair context needs human verification');
  }
  if (repairContext?.match_behavior === 'guidance-only') {
    contradictions.push(contradiction('fitment', 'model-specific repair', 'no verified stocked fitment', 'hard'));
    reviewReasons.push('Model-specific repair needs fitment evidence');
  }

  const dedup = (items) => [...new Set(items)].sort();
  const uniqueContradictions = [];
  const seen = new Set();
  for (const item of contradictions) {
    const key = `${item.field}|${item.query_value}|${item.result_value}|${item.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueContradictions.push(item);
  }
  return {
    matchEvidence: dedup(matchEvidence),
    reviewReasons: dedup(reviewReasons),
    contradictions: uniqueContradictions,
    hasHardContradiction: uniqueContradictions.some((item) => item.severity === 'hard'),
    hasSoftContradiction: uniqueContradictions.some((item) => item.severity === 'soft'),
  };
}

function contradiction(field, queryValue, resultValue, severity) {
  return {
    field,
    query_value: String(queryValue),
    result_value: String(resultValue),
    severity,
  };
}

function threadSystem(thread) {
  if (!thread) return null;
  return String(thread).toLowerCase().startsWith('m') ? 'metric' : 'imperial';
}

function displayValue(value) {
  return String(value).replace(/-/g, ' ');
}

function suggestions(parsed) {
  const out = [];
  if (!parsed.product_type) out.push({ label: 'Add product type', query_rewrite: 'M8 flat washer' });
  if (!parsed.thread_spec) out.push({ label: 'Add thread or size', query_rewrite: '1/4-20 x 3/4 hex cap screw' });
  if (!parsed.material) out.push({ label: 'Add material', query_rewrite: 'brass hex nut 1/2-13' });
  return out.length ? out : null;
}

function inc(map, key, amount) {
  if (key != null) map.set(key, (map.get(key) ?? 0) + amount);
}

function top(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function trimNumber(input) {
  return input.endsWith('.0') ? input.slice(0, -2) : input;
}

function fractionToMm(value) {
  const [n, d] = value.split('/').map(Number);
  return n / d * 25.4;
}

function numberedScrewMm(value) {
  return { 4: 2.84, 6: 3.51, 8: 4.17, 10: 4.83, 12: 5.49 }[value] ?? null;
}

function imperialLenToMm(value) {
  if (value.includes('-')) {
    const [whole, fraction] = value.split('-');
    return (Number(whole) + fractionToFloat(fraction)) * 25.4;
  }
  if (value.includes('/')) return fractionToFloat(value) * 25.4;
  return Number(value) * 25.4;
}

function fractionToFloat(value) {
  const [n, d] = value.split('/').map(Number);
  return n / d;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

import type { Candidate } from './contracts';

/** Pure lead policy. Callers own observation storage and retirement scope. */
export const balancedLeadPolicyVersion = 'hn-balanced-lead-v1';
export const balancedLeadConfig = Object.freeze({
  weights: Object.freeze({ points: 35, comments: 15, pointRate: 30, commentRate: 10, freshness: 10 }),
  freshnessHalfLifeHours: 24,
  switchMargin: 5,
  historyMinMs: 30 * 60_000,
  historyMaxMs: 150 * 60_000,
  pointRateNormalizationFloor: 20,
  commentRateNormalizationFloor: 10,
});
// Storage/retirement schema remains v1. Scoring versions are pinned per draft.
export const currentLeadScoringVersion = 'hn-balanced-lead-v2';
export type LeadScoringVersion = typeof balancedLeadPolicyVersion | typeof currentLeadScoringVersion;
export const freshnessLeadConfig = Object.freeze({...balancedLeadConfig, weights:Object.freeze({
 points:35*70/90, comments:15*70/90, pointRate:30*70/90, commentRate:10*70/90, freshness:30,
})});
export function leadScoringConfig(version:LeadScoringVersion){
 if(version===balancedLeadPolicyVersion)return balancedLeadConfig;
 if(version===currentLeadScoringVersion)return freshnessLeadConfig;
 throw new TypeError('Unsupported lead scoring version');
}
export const balancedLeadLimits = Object.freeze({
  maxCandidates: 1_000,
  maxFrontPageIds: 30,
  maxObservations: 20_000,
  maxRetiredIdentifiers: 20_000,
  maxKeyLength: 4_096,
});

/** observedAt and the selection cutoff are epoch milliseconds; Candidate.time is seconds. */
export type LeadObservation = Readonly<{ id: number; observedAt: number; score: number; comments: number }>;
export type BalancedLeadInput = Readonly<{
  candidates: readonly Candidate[];
  frontPageIds: readonly number[];
  at: number;
  incumbentId?: number;
  observations?: readonly LeadObservation[];
  retiredIds?: ReadonlySet<number>;
  retiredKeys?: ReadonlySet<string>;
  /** Transient exclusion only; these IDs are not marked permanently retired. */
  suppressedIds?: ReadonlySet<number>;
  /** Keys are supplied, never inferred or canonicalized by this policy. */
  candidateKeys?: ReadonlyMap<number, string>;
}>;
export type LeadNormalizers = { points: number; comments: number; pointRate: number; commentRate: number };
export type LeadComponents = LeadNormalizers & { freshness: number };
export type LeadRateAudit = {
  status: 'measured' | 'unknown';
  priorObservedAt: number | null;
  deltaHours: number | null;
  deltaPoints: number | null;
  deltaComments: number | null;
  pointRate: number | null;
  commentRate: number | null;
};
export type LeadCandidateAudit = {
  id: number;
  key: string | null;
  frontPageRank: number;
  points: number;
  comments: number;
  ageHours: number;
  retired: boolean;
  suppressed: boolean;
  historyKnown: boolean;
  rates: LeadRateAudit;
  components: LeadComponents;
  balancedScore: number;
};
type LeadAudit = {
  policyVersion: LeadScoringVersion;
  at: number;
  normalizers: LeadNormalizers;
  /** All valid current page-one candidates, including retired candidates. */
  ranked: LeadCandidateAudit[];
  eligibleCount: number;
  missingFrontPageIds: number[];
};
export type BalancedLeadResult = LeadAudit & (
  | { status: 'blocked'; reason: 'no-eligible-front-page-candidate'; leadId: null; rawBestId: null }
  | {
    status: 'selected';
    reason: 'initialize' | 'incumbent-ineligible' | 'incumbent-highest-score' | 'retain-within-switch-margin' | 'challenger-clears-switch-margin';
    leadId: number;
    rawBestId: number;
  }
);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}
function timestamp(value: unknown): value is number {
  return nonnegativeInteger(value) && value <= 8_640_000_000_000_000;
}
function key(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= balancedLeadLimits.maxKeyLength;
}
function invalid(message: string): never {
  throw new TypeError('Invalid balanced lead input: ' + message);
}
function boundedArray(value: unknown, maximum: number, name: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(name + ' must be an array of at most ' + maximum + ' entries');
}
function validate(input: BalancedLeadInput): void {
  if (!record(input) || !timestamp(input.at)) invalid('at must be an epoch-millisecond timestamp');
  boundedArray(input.candidates, balancedLeadLimits.maxCandidates, 'candidates');
  boundedArray(input.frontPageIds, balancedLeadLimits.maxFrontPageIds, 'frontPageIds');
  boundedArray(input.observations === undefined ? [] : input.observations, balancedLeadLimits.maxObservations, 'observations');
  if (input.incumbentId !== undefined && !id(input.incumbentId)) invalid('incumbentId');
  const seen = new Set<number>();
  for (const candidate of input.candidates) {
    if (!record(candidate) || !id(candidate.id) || seen.has(candidate.id) || !nonnegativeInteger(candidate.score) || !nonnegativeInteger(candidate.comments) || !nonnegativeInteger(candidate.time) || candidate.time > 8_640_000_000_000) invalid('candidate IDs, counters or timestamps');
    seen.add(candidate.id);
  }
  seen.clear();
  for (const frontId of input.frontPageIds) {
    if (!id(frontId) || seen.has(frontId)) invalid('frontPageIds must be unique positive IDs');
    seen.add(frontId);
  }
  for (const [name, values, valid] of [
    ['retiredIds', input.retiredIds, id],
    ['retiredKeys', input.retiredKeys, key],
    ['suppressedIds', input.suppressedIds, id],
  ] as const) {
    if (values === undefined) continue;
    if (!(values instanceof Set) || values.size > balancedLeadLimits.maxRetiredIdentifiers) invalid(name + ' must be a bounded Set');
    for (const value of values) if (!valid(value)) invalid(name + ' contains an invalid identifier');
  }
  if (input.candidateKeys !== undefined) {
    if (!(input.candidateKeys instanceof Map) || input.candidateKeys.size > balancedLeadLimits.maxCandidates) invalid('candidateKeys must be a bounded Map');
    for (const [candidateId, candidateKey] of input.candidateKeys) if (!id(candidateId) || !key(candidateKey)) invalid('candidateKeys contains an invalid entry');
  }
  if (input.retiredKeys?.size) {
    for (const candidate of input.candidates) {
      if (seen.has(candidate.id) && !input.candidateKeys?.has(candidate.id)) invalid('every page-one candidate needs a key when retiredKeys are supplied');
    }
  }
}

function priorObservations(observations: readonly LeadObservation[], at: number) {
  const byId = new Map<number, Map<number, LeadObservation>>();
  for (const observation of observations) {
    if (!record(observation) || !id(observation.id) || !timestamp(observation.observedAt) || !nonnegativeInteger(observation.score) || !nonnegativeInteger(observation.comments)) {
      invalid('observation IDs, counters or timestamps');
    }
    let stamps = byId.get(observation.id);
    if (!stamps) byId.set(observation.id, stamps = new Map());
    const existing = stamps.get(observation.observedAt);
    if (existing === undefined) stamps.set(observation.observedAt, observation);
    else if (existing.score !== observation.score || existing.comments !== observation.comments) invalid('conflicting observations for the same ID and timestamp');
  }
  const latest = new Map<number, LeadObservation>();
  for (const [candidateId, stamps] of byId) {
    for (const observation of stamps.values()) {
      const elapsed = at - observation.observedAt;
      if (elapsed < balancedLeadConfig.historyMinMs || elapsed > balancedLeadConfig.historyMaxMs) continue;
      if (observation.observedAt > (latest.get(candidateId)?.observedAt ?? -1)) latest.set(candidateId, observation);
    }
  }
  return latest;
}

/**
 * Select only from current page one. Missing rates earn no rate bonus, never a
 * points/age substitute. Invalid current inputs throw; no eligible lead blocks.
 */
export function selectBalancedLead(input: BalancedLeadInput, version:LeadScoringVersion=balancedLeadPolicyVersion): BalancedLeadResult {
  const config=leadScoringConfig(version);
  validate(input);
  const { candidates, frontPageIds, at, incumbentId } = input;
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const history = priorObservations(input.observations ?? [], at);
  const unscored: Omit<LeadCandidateAudit, 'components' | 'balancedScore'>[] = [];
  const missingFrontPageIds: number[] = [];
  for (const [index, candidateId] of frontPageIds.entries()) {
    const candidate = byId.get(candidateId);
    if (!candidate) { missingFrontPageIds.push(candidateId); continue; }
    const prior = history.get(candidateId);
    let rates: LeadRateAudit = { status: 'unknown', priorObservedAt: null, deltaHours: null, deltaPoints: null, deltaComments: null, pointRate: null, commentRate: null };
    if (prior) {
      const deltaHours = (at - prior.observedAt) / 3_600_000;
      const deltaPoints = candidate.score - prior.score;
      const deltaComments = candidate.comments - prior.comments;
      rates = { status: 'measured', priorObservedAt: prior.observedAt, deltaHours, deltaPoints, deltaComments, pointRate: Math.max(0, deltaPoints) / deltaHours, commentRate: Math.max(0, deltaComments) / deltaHours };
    }
    const candidateKey = input.candidateKeys?.get(candidateId) ?? null;
    unscored.push({
      id: candidateId, key: candidateKey, frontPageRank: index + 1, points: candidate.score, comments: candidate.comments,
      ageHours: Math.max(0, (at - candidate.time * 1_000) / 3_600_000),
      retired: !!input.retiredIds?.has(candidateId) || (candidateKey !== null && !!input.retiredKeys?.has(candidateKey)),
      suppressed: !!input.suppressedIds?.has(candidateId),
      historyKnown: prior !== undefined, rates,
    });
  }
  // Retirement affects selection, not the comparison scale. Historical stories
  // and later HN pages never influence any normalizer, even with larger totals.
  const normalizers: LeadNormalizers = { points: 1, comments: 1, pointRate: balancedLeadConfig.pointRateNormalizationFloor, commentRate: balancedLeadConfig.commentRateNormalizationFloor };
  for (const candidate of unscored) {
    normalizers.points = Math.max(normalizers.points, candidate.points);
    normalizers.comments = Math.max(normalizers.comments, candidate.comments);
    normalizers.pointRate = Math.max(normalizers.pointRate, candidate.rates.pointRate ?? 0);
    normalizers.commentRate = Math.max(normalizers.commentRate, candidate.rates.commentRate ?? 0);
  }
  const weights = config.weights;
  const ranked: LeadCandidateAudit[] = unscored.map(candidate => {
    const components: LeadComponents = {
      points: weights.points * Math.log1p(candidate.points) / Math.log1p(normalizers.points),
      comments: weights.comments * Math.log1p(candidate.comments) / Math.log1p(normalizers.comments),
      pointRate: weights.pointRate * Math.log1p(candidate.rates.pointRate ?? 0) / Math.log1p(normalizers.pointRate),
      commentRate: weights.commentRate * Math.log1p(candidate.rates.commentRate ?? 0) / Math.log1p(normalizers.commentRate),
      freshness: weights.freshness * 2 ** (-candidate.ageHours / balancedLeadConfig.freshnessHalfLifeHours),
    };
    const balancedScore = components.points + components.comments + components.pointRate + components.commentRate + components.freshness;
    return { ...candidate, components, balancedScore };
  }).sort((a, b) => b.balancedScore - a.balancedScore || a.frontPageRank - b.frontPageRank || a.id - b.id);
  const eligible = ranked.filter(candidate => !candidate.retired && !candidate.suppressed);
  const audit: LeadAudit = {
    policyVersion: version, at, normalizers, ranked, eligibleCount: eligible.length, missingFrontPageIds,
  };
  const best = eligible[0];
  if (!best) return { ...audit, status: 'blocked', reason: 'no-eligible-front-page-candidate', leadId: null, rawBestId: null };
  const incumbent = eligible.find(candidate => candidate.id === incumbentId);
  let leadId = best.id;
  let reason: Extract<BalancedLeadResult, { status: 'selected' }>['reason'];
  if (incumbentId === undefined) reason = 'initialize';
  else if (!incumbent) reason = 'incumbent-ineligible';
  else if (incumbent.id === best.id) reason = 'incumbent-highest-score';
  else if (best.balancedScore >= incumbent.balancedScore + balancedLeadConfig.switchMargin) reason = 'challenger-clears-switch-margin';
  else { leadId = incumbent.id; reason = 'retain-within-switch-margin'; }
  return { ...audit, status: 'selected', reason, leadId, rawBestId: best.id };
}

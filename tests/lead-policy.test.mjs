import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-balanced-lead-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
await build({ entryPoints: ['lib/lead-policy.ts'], bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'lead-policy.mjs') });
const { selectBalancedLead, balancedLeadConfig, balancedLeadLimits } = await import(pathToFileURL(path.join(temp, 'lead-policy.mjs')));
const at = Date.parse('2026-11-03T21:00:00Z');
const hour = 3_600_000;
const story = (id, extra = {}) => ({ id, title: `Story ${id}`, url: `https://example.org/${id}`, score: 100, comments: 20, time: at / 1_000 - 3_600, category: 'Technology', editorialScore: 0, hnPage: 1, hnRank: id, ...extra });
const observation = (id, minutes, score = 80, comments = 10) => ({ id, observedAt: at - minutes * 60_000, score, comments });
const select = (candidates, options = {}) => selectBalancedLead({ candidates, frontPageIds: candidates.map(s => s.id), at, ...options });
const row = (result, id) => result.ranked.find(candidate => candidate.id === id);
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11, `${actual} != ${expected}`);

test('exact approved logarithmic components, maxima, measured deltas, and 24-hour half-life', () => {
  const result = select([story(1, { score: 600, comments: 120, time: at / 1_000 - 24 * 3_600 })], { observations: [observation(1, 60, 500, 100)] });
  assert.equal(result.status, 'selected');
  assert.equal(result.leadId, 1);
  assert.equal(result.reason, 'initialize');
  assert.deepEqual(result.normalizers, { points: 600, comments: 120, pointRate: 100, commentRate: 20 });
  assert.deepEqual(result.ranked[0].rates, { status: 'measured', priorObservedAt: at - hour, deltaHours: 1, deltaPoints: 100, deltaComments: 20, pointRate: 100, commentRate: 20 });
  assert.equal(result.ranked[0].historyKnown, true);
  for (const [component, expected] of Object.entries({ points: 35, comments: 15, pointRate: 30, commentRate: 10, freshness: 5 })) approximately(result.ranked[0].components[component], expected);
  approximately(result.ranked[0].balancedScore, 95);
});

test('normalizer floors and logarithmic submaximal components are exact and unrounded', () => {
  const candidates = [story(1, { score: 9, comments: 2 }), story(2, { score: 99, comments: 9 })];
  const result = select(candidates, { observations: [observation(1, 60, 6, 1), observation(2, 60, 98, 8)] });
  assert.deepEqual(result.normalizers, { points: 99, comments: 9, pointRate: 20, commentRate: 10 });
  const expected = { points: 35 * Math.log1p(9) / Math.log1p(99), comments: 15 * Math.log1p(2) / Math.log1p(9), pointRate: 30 * Math.log1p(3) / Math.log1p(20), commentRate: 10 * Math.log1p(1) / Math.log1p(10), freshness: 10 * 2 ** (-1 / 24) };
  assert.deepEqual(row(result, 1).components, expected);
  assert.equal(row(result, 1).balancedScore, Object.values(expected).reduce((sum, value) => sum + value, 0));
  assert.notEqual(row(result, 1).balancedScore, Math.round(row(result, 1).balancedScore * 10_000) / 10_000);
});

test('zero totals and zero measured gains remain finite with floor normalizers', () => {
  const result = select([story(1, { score: 0, comments: 0, time: at / 1_000 })], { observations: [observation(1, 30, 0, 0)] });
  assert.deepEqual(result.normalizers, { points: 1, comments: 1, pointRate: 20, commentRate: 10 });
  assert.deepEqual(result.ranked[0].components, { points: 0, comments: 0, pointRate: 0, commentRate: 0, freshness: 10 });
  assert.equal(result.ranked[0].balancedScore, 10);
  assert.equal(result.ranked[0].rates.status, 'measured');
  assert.equal(result.ranked[0].rates.pointRate, 0);
  assert.equal(result.ranked[0].rates.commentRate, 0);
});

test('cold start and genuinely missing history have unknown rates, no points/age proxy', () => {
  const candidates = [story(1, { score: 10_000, comments: 1_000, time: at / 1_000 - 1 }), story(2)];
  const result = select(candidates, { observations: [observation(2, 10)] });
  for (const candidate of result.ranked) {
    assert.equal(candidate.historyKnown, false);
    assert.deepEqual(candidate.rates, { status: 'unknown', priorObservedAt: null, deltaHours: null, deltaPoints: null, deltaComments: null, pointRate: null, commentRate: null });
    assert.equal(candidate.components.pointRate, 0);
    assert.equal(candidate.components.commentRate, 0);
    assert.ok(candidate.balancedScore <= 60);
  }
  assert.deepEqual(result.normalizers, { points: 10_000, comments: 1_000, pointRate: 20, commentRate: 10 });
  assert.deepEqual(result, select(candidates));
});

test('the most recent qualifying observation is used, regardless of history order', () => {
  const history = [observation(1, 120, 0, 0), observation(1, 40, 92, 16), observation(1, 60, 80, 10), observation(1, 29, 99, 19)];
  const result = select([story(1)], { observations: history });
  assert.equal(result.ranked[0].rates.priorObservedAt, at - 40 * 60_000);
  assert.equal(result.ranked[0].rates.deltaHours, 2 / 3);
  assert.equal(result.ranked[0].rates.pointRate, 12);
  assert.equal(result.ranked[0].rates.commentRate, 6);
  assert.deepEqual(result, select([story(1)], { observations: [...history].reverse() }));
});

test('30- and 150-minute endpoints are inclusive, and actual milliseconds determine rates', () => {
  for (const milliseconds of [30 * 60_000, 150 * 60_000, 73 * 60_000 + 123]) {
    const result = select([story(1)], { observations: [{ id: 1, observedAt: at - milliseconds, score: 50, comments: 10 }] });
    assert.equal(result.ranked[0].rates.status, 'measured');
    assert.equal(result.ranked[0].rates.deltaHours, milliseconds / hour);
    assert.equal(result.ranked[0].rates.pointRate, 50 / (milliseconds / hour));
    assert.equal(result.ranked[0].rates.commentRate, 10 / (milliseconds / hour));
  }
  const result = select([story(1)], { observations: [observation(1, 150, 0, 0), observation(1, 30, 90, 15)] });
  assert.equal(result.ranked[0].rates.priorObservedAt, at - 30 * 60_000);
  assert.equal(result.ranked[0].rates.pointRate, 20);
});

test('observations one millisecond outside either bound, current, and future earn no rate bonus', () => {
  for (const milliseconds of [30 * 60_000 - 1, 150 * 60_000 + 1, 0, -hour]) {
    const result = select([story(1)], { observations: [{ id: 1, observedAt: at - milliseconds, score: 0, comments: 0 }] });
    assert.equal(result.ranked[0].rates.status, 'unknown');
    assert.equal(result.ranked[0].components.pointRate, 0);
    assert.equal(result.ranked[0].components.commentRate, 0);
  }
});

test('negative gains clamp separately to zero without hiding the measured raw deltas', () => {
  const result = select([story(1), story(2), story(3)], { observations: [observation(1, 60, 105, 25), observation(2, 60, 105, 15), observation(3, 60, 95, 25)] });
  for (const candidate of result.ranked) assert.equal(candidate.rates.status, 'measured');
  assert.deepEqual(row(result, 1).rates, { status: 'measured', priorObservedAt: at - hour, deltaHours: 1, deltaPoints: -5, deltaComments: -5, pointRate: 0, commentRate: 0 });
  assert.equal(row(result, 2).rates.pointRate, 0);
  assert.equal(row(result, 2).rates.commentRate, 5);
  assert.equal(row(result, 3).rates.pointRate, 5);
  assert.equal(row(result, 3).rates.commentRate, 0);
  assert.equal(row(result, 1).components.pointRate, 0);
  assert.equal(row(result, 1).components.commentRate, 0);
});

test('only the explicit current first-page list determines candidates, order and maxima', () => {
  const first = story(1);
  const outlier = story(2, { score: 1_000_000, comments: 1_000_000, hnRank: 1, hnPage: 2 });
  const result = select([outlier, first], { frontPageIds: [1], observations: [observation(2, 30, 0, 0)] });
  assert.equal(result.leadId, 1);
  assert.deepEqual(result.ranked.map(s => s.id), [1]);
  assert.deepEqual(result.normalizers, { points: 100, comments: 20, pointRate: 20, commentRate: 10 });
  assert.deepEqual(result, select([first], { observations: [observation(2, 30, 0, 0)] }));
  const missing = select([first], { frontPageIds: [99, 1, 98] });
  assert.deepEqual(missing.missingFrontPageIds, [99, 98]);
  assert.equal(missing.ranked[0].frontPageRank, 2);
});

test('retired candidates contribute every normalizer but cannot win or retain incumbency', () => {
  const candidates = [story(1, { score: 10, comments: 5 }), story(2, { score: 1_000, comments: 500 })];
  const result = select(candidates, { incumbentId: 2, retiredIds: new Set([2]), observations: [observation(2, 60, 0, 0)] });
  assert.equal(result.leadId, 1);
  assert.equal(result.reason, 'incumbent-ineligible');
  assert.equal(result.rawBestId, 1);
  assert.equal(result.eligibleCount, 1);
  assert.deepEqual(result.normalizers, { points: 1_000, comments: 500, pointRate: 1_000, commentRate: 500 });
  assert.equal(row(result, 2).retired, true);
  assert.equal(result.ranked[0].id, 2);
  assert.equal(row(result, 1).components.points, 35 * Math.log1p(10) / Math.log1p(1_000));
});

test('externally supplied article keys exclude repost IDs without inventing identity or scope', () => {
  const candidates = [story(1), story(2, { score: 1_000 }), story(3, { score: 500 })];
  const candidateKeys = new Map([[1, 'article:live'], [2, 'article:retired'], [3, 'article:retired']]);
  const result = select(candidates, { candidateKeys, retiredKeys: new Set(['article:retired']) });
  assert.equal(result.leadId, 1);
  assert.equal(result.eligibleCount, 1);
  assert.equal(row(result, 2).retired, true);
  assert.equal(row(result, 3).retired, true);
  assert.equal(row(result, 1).key, 'article:live');
  assert.throws(() => select(candidates, { retiredKeys: new Set(['article:retired']) }), /every page-one candidate needs a key/);
  assert.throws(() => select(candidates, { retiredKeys: new Set(['article:retired']), candidateKeys: new Map([[2, 'article:retired']]) }), /every page-one candidate needs a key/);
});

test('transient suppression excludes a current article repost without marking it retired or changing maxima', () => {
  const candidates = [story(1, { score: 100 }), story(2, { score: 1_000 }), story(3, { score: 0, comments: 0 })];
  const result = select(candidates, { incumbentId: 1, suppressedIds: new Set([2]), candidateKeys: new Map([[1, 'same-article'], [2, 'same-article'], [3, 'other-article']]), observations: [observation(2, 60, 0, 0)] });
  assert.equal(result.leadId, 1);
  assert.equal(result.eligibleCount, 2);
  assert.equal(row(result, 2).suppressed, true);
  assert.equal(row(result, 2).retired, false);
  assert.equal(row(result, 1).suppressed, false);
  assert.equal(result.normalizers.points, 1_000);
  assert.equal(result.normalizers.pointRate, 1_000);
  assert.equal(select([story(1)], { suppressedIds: new Set([1]) }).status, 'blocked');
  assert.equal(select(candidates).leadId, 2, 'suppression does not persist implicitly');
});

test('exhaustion is explicitly blocked, with no retired or off-page fallback', () => {
  for (const result of [
    select([]),
    select([story(1)], { frontPageIds: [] }),
    select([story(1)], { frontPageIds: [2] }),
    select([story(1)], { incumbentId: 1, retiredIds: new Set([1]) }),
    select([story(1), story(2)], { frontPageIds: [1], incumbentId: 1, retiredIds: new Set([1]) }),
    select([story(1)], { incumbentId: 1, candidateKeys: new Map([[1, 'old']]), retiredKeys: new Set(['old']) }),
  ]) {
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'no-eligible-front-page-candidate');
    assert.equal(result.leadId, null);
    assert.equal(result.rawBestId, null);
    assert.equal(result.eligibleCount, 0);
  }
});

test('incumbent is retained just below five, switches exactly at five, and above five', () => {
  const challenger = story(2, { score: 0, comments: 0, time: at / 1_000 });
  for (const [offsetSeconds, expectedId] of [[1, 1], [0, 2], [-1, 2]]) {
    const incumbent = story(1, { score: 0, comments: 0, time: at / 1_000 - 24 * 3_600 + offsetSeconds });
    const result = select([incumbent, challenger], { incumbentId: 1 });
    assert.equal(result.rawBestId, 2);
    assert.equal(result.leadId, expectedId);
    assert.equal(result.reason, expectedId === 1 ? 'retain-within-switch-margin' : 'challenger-clears-switch-margin');
    const margin = row(result, 2).balancedScore - row(result, 1).balancedScore;
    if (offsetSeconds === 0) assert.equal(margin, 5);
    if (offsetSeconds === 1) {
      assert.ok(margin < 5);
      assert.equal(Math.round(margin * 10_000) / 10_000, 5, 'rounded scores would make the wrong decision');
    }
    if (offsetSeconds === -1) assert.ok(margin > 5);
  }
});

test('tie order follows the HN front-page list, not input order, ID or stale hnRank', () => {
  const candidates = [story(100, { hnRank: 1 }), story(7, { hnRank: 30 })];
  const result = select(candidates, { frontPageIds: [7, 100] });
  assert.equal(result.leadId, 7);
  assert.deepEqual(result.ranked.map(s => s.id), [7, 100]);
  const incumbent = select(candidates, { frontPageIds: [7, 100], incumbentId: 100 });
  assert.equal(incumbent.leadId, 100);
  assert.equal(incumbent.rawBestId, 7);
  assert.equal(incumbent.reason, 'retain-within-switch-margin');
});

test('a sub-rounding score difference beats front-page order without an incumbent', () => {
  const result = select([story(1, { score: 0, comments: 0, time: at / 1_000 - 24 * 3_600 }), story(2, { score: 0, comments: 0, time: at / 1_000 - 24 * 3_600 + 1 })]);
  assert.equal(result.leadId, 2);
  assert.ok(row(result, 2).balancedScore > row(result, 1).balancedScore);
  assert.equal(Math.round(row(result, 2).balancedScore * 10_000), Math.round(row(result, 1).balancedScore * 10_000));
});

test('highest-scoring incumbent stays; an off-page incumbent cannot suppress a new eligible lead', () => {
  const candidates = [story(1, { score: 1_000 }), story(2)];
  assert.equal(select(candidates, { incumbentId: 1 }).reason, 'incumbent-highest-score');
  const result = select(candidates, { frontPageIds: [2], incumbentId: 1 });
  assert.equal(result.leadId, 2);
  assert.equal(result.reason, 'incumbent-ineligible');
});

test('freshness uses the pinned cutoff, with future timestamps clamped to age zero', () => {
  const result = select([story(1, { time: at / 1_000 + 3_600 }), story(2, { time: at / 1_000 - 48 * 3_600 })]);
  assert.equal(row(result, 1).ageHours, 0);
  assert.equal(row(result, 1).components.freshness, 10);
  assert.equal(row(result, 2).ageHours, 48);
  assert.equal(row(result, 2).components.freshness, 2.5);
  const later = select([story(1, { time: at / 1_000 })], { at: at + 24 * hour });
  assert.equal(later.ranked[0].components.freshness, 5);
});

test('duplicate identical observations dedupe; conflicting same-ID/time observations fail closed', () => {
  const prior = observation(1, 60);
  assert.deepEqual(select([story(1)], { observations: [prior, { ...prior }] }), select([story(1)], { observations: [prior] }));
  for (const changes of [{ score: prior.score + 1 }, { comments: prior.comments + 1 }]) {
    const conflict = { ...prior, ...changes };
    for (const observations of [[prior, conflict], [conflict, prior], [prior, prior, conflict]]) assert.throws(() => select([story(1)], { observations }), /conflicting observations/);
  }
  // Corruption stays visible even when the contradictory timestamp is too old.
  assert.throws(() => select([story(1)], { observations: [observation(1, 151, 1), observation(1, 151, 2)] }), /conflicting observations/);
});

test('malformed history never masquerades as unknown, including unrelated history', () => {
  const prior = observation(1, 60);
  for (const bad of [null, [], {}, { ...prior, id: 0 }, { ...prior, id: 1.1 }, { ...prior, observedAt: NaN }, { ...prior, observedAt: at + 0.5 }, { ...prior, observedAt: '2026-11-03' }, { ...prior, score: -1 }, { ...prior, comments: NaN }, { ...prior, score: 1.1 }, { ...prior, comments: Number.MAX_SAFE_INTEGER + 1 }, { ...prior, id: 999, observedAt: at - 1_000 * hour, score: -1 }]) {
    assert.throws(() => select([story(1)], { observations: [bad] }), /Invalid balanced lead input/);
  }
  for (const observations of [null, {}, 'history']) assert.throws(() => select([story(1)], { observations }), /observations/);
});

test('invalid candidates, IDs, cutoffs and identity containers fail closed', () => {
  for (const change of [{ id: 0 }, { id: 1.5 }, { score: -1 }, { comments: -1 }, { score: NaN }, { comments: Infinity }, { score: 1.5 }, { time: -1 }, { time: Infinity }, { time: 1.5 }, { time: 8_640_000_000_001 }]) assert.throws(() => select([story(1, change)]), /Invalid balanced lead input/);
  assert.throws(() => select([story(1), story(1)]), /candidate/);
  for (const bad of [NaN, Infinity, -1, at + 0.5, '2026-11-03', 8_640_000_000_000_001]) assert.throws(() => select([story(1)], { at: bad }), /at must/);
  for (const frontPageIds of [[1, 1], [0], [-1], [1.1], null, {}]) assert.throws(() => select([story(1)], { frontPageIds }), /frontPageIds/);
  for (const incumbentId of [null, 0, -1, 1.5, Infinity]) assert.throws(() => select([story(1)], { incumbentId }), /incumbentId/);
  for (const bad of [null, {}, [null]]) assert.throws(() => selectBalancedLead({ candidates: bad, frontPageIds: [], at }), /candidate/);
  for (const retiredIds of [[], null, new Set([0]), new Set(['1'])]) assert.throws(() => select([story(1)], { retiredIds }), /retiredIds/);
  for (const suppressedIds of [[], null, new Set([0]), new Set(['1'])]) assert.throws(() => select([story(1)], { suppressedIds }), /suppressedIds/);
  for (const retiredKeys of [[], null, new Set(['']), new Set([' ']), new Set([1]), new Set(['x'.repeat(balancedLeadLimits.maxKeyLength + 1)])]) assert.throws(() => select([story(1)], { retiredKeys }), /retiredKeys/);
  for (const candidateKeys of [[], null, {}, new Map([[0, 'valid']]), new Map([[1, '']]), new Map([[1, 5]])]) assert.throws(() => select([story(1)], { candidateKeys }), /candidateKeys/);
  for (const bad of [null, undefined, [], {}]) assert.throws(() => selectBalancedLead(bad), /Invalid balanced lead input/);
});

test('collection bounds reject oversized inputs and accept the exact limits', () => {
  const candidates = Array.from({ length: balancedLeadLimits.maxCandidates }, (_, index) => story(index + 1));
  const frontPageIds = candidates.slice(0, balancedLeadLimits.maxFrontPageIds).map(s => s.id);
  assert.equal(select(candidates, { frontPageIds }).ranked.length, 30);
  assert.throws(() => select([...candidates, story(candidates.length + 1)], { frontPageIds }), /candidates must/);
  assert.throws(() => select(candidates, { frontPageIds: [...frontPageIds, 31] }), /frontPageIds must/);
  const observations = Array.from({ length: balancedLeadLimits.maxObservations }, () => observation(1, 60));
  assert.equal(select([story(1)], { observations }).ranked[0].historyKnown, true);
  assert.throws(() => select([story(1)], { observations: [...observations, observation(1, 60)] }), /observations must/);
  const retiredIds = new Set(Array.from({ length: balancedLeadLimits.maxRetiredIdentifiers }, (_, index) => index + 1));
  assert.equal(select([story(1)], { retiredIds }).status, 'blocked');
  retiredIds.add(retiredIds.size + 1);
  assert.throws(() => select([story(1)], { retiredIds }), /retiredIds must/);
  assert.throws(() => select([story(1)], { suppressedIds: retiredIds }), /suppressedIds must/);
  const retiredKeys = new Set(Array.from({ length: balancedLeadLimits.maxRetiredIdentifiers }, (_, index) => String(index)));
  assert.equal(select([story(1)], { retiredKeys, candidateKeys: new Map([[1, '0']]) }).status, 'blocked');
  retiredKeys.add('overflow');
  assert.throws(() => select([story(1)], { retiredKeys }), /retiredKeys must/);
  const candidateKeys = new Map(candidates.map(candidate => [candidate.id, String(candidate.id)]));
  assert.equal(select([story(1)], { candidateKeys }).status, 'selected');
  candidateKeys.set(candidates.length + 1, 'overflow');
  assert.throws(() => select([story(1)], { candidateKeys }), /candidateKeys must/);
});

test('selection and the full audit are permutation invariant without mutating caller state', () => {
  const candidates = [story(1, { score: 200 }), story(2, { score: 180, comments: 50 }), story(3, { score: 1_000, comments: 200 }), story(4, { score: 1_000_000, hnPage: 2 })];
  const observations = [observation(1, 60, 100, 5), observation(1, 30, 180, 15), observation(2, 120, 50, 5), observation(3, 60, 800, 100)];
  const options = { at, frontPageIds: [2, 1, 3], incumbentId: 1, observations, retiredIds: new Set([3]), candidateKeys: new Map([[1, 'one'], [2, 'two'], [3, 'three']]) };
  const expected = select(candidates, options);
  function* permutations(values) {
    if (values.length === 0) { yield []; return; }
    for (let index = 0; index < values.length; index++) for (const remainder of permutations(values.filter((_, i) => i !== index))) yield [values[index], ...remainder];
  }
  for (const pool of permutations(candidates)) for (const history of permutations(observations)) assert.deepEqual(select(pool, { ...options, observations: history }), expected);
  const before = JSON.stringify({ candidates, options: { ...options, retiredIds: [...options.retiredIds], candidateKeys: [...options.candidateKeys] } });
  Object.freeze(candidates); Object.freeze(observations); Object.freeze(options.frontPageIds);
  candidates.forEach(Object.freeze); observations.forEach(Object.freeze);
  assert.deepEqual(select(candidates, options), expected);
  assert.equal(JSON.stringify({ candidates, options: { ...options, retiredIds: [...options.retiredIds], candidateKeys: [...options.candidateKeys] } }), before);
  assert.ok(Object.isFrozen(balancedLeadConfig));
  assert.ok(Object.isFrozen(balancedLeadConfig.weights));
  assert.ok(Object.isFrozen(balancedLeadLimits));
});


test('v2 freshness is exactly30; all engagement signals proportionally retain70 with v1 replay intact',()=>{
 const input={candidates:[story(1,{score:600,comments:120,time:at/1000-24*3600})],frontPageIds:[1],at,observations:[observation(1,60,500,100)]};
 const old=selectBalancedLead(input,'hn-balanced-lead-v1'),next=selectBalancedLead(input,'hn-balanced-lead-v2');
 assert.equal(next.policyVersion,'hn-balanced-lead-v2');assert.equal(next.ranked[0].components.freshness,15);
 for(const k of ['points','comments','pointRate','commentRate'])approximately(next.ranked[0].components[k],old.ranked[0].components[k]*70/90);
 approximately(next.ranked[0].balancedScore,85);assert.equal(old.ranked[0].balancedScore,95);
 assert.deepEqual(selectBalancedLead(input,'hn-balanced-lead-v1'),old);
 assert.throws(()=>selectBalancedLead(input,'unknown'),/Unsupported lead scoring/);
 const retired=selectBalancedLead({...input,retiredIds:new Set([1])},'hn-balanced-lead-v2');assert.equal(retired.status,'blocked');
});

test('v2 retains the five-point switch threshold and unchanged off-page replacement',()=>{
 const newer=story(2,{score:0,comments:0,time:at/1000});
 for(const [gap,winner] of [[4.99,1],[5.01,2]]){
  const age=-24*Math.log2((30-gap)/30),older=story(1,{score:0,comments:0,time:Math.round(at/1000-age*3600)});
  assert.equal(selectBalancedLead({candidates:[older,newer],frontPageIds:[1,2],incumbentId:1,at},'hn-balanced-lead-v2').leadId,winner);
 }
 assert.equal(selectBalancedLead({candidates:[newer],frontPageIds:[2],incumbentId:1,at},'hn-balanced-lead-v2').leadId,2);
});

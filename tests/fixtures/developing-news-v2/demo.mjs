import { pathToFileURL } from 'node:url';
import { buildRequest, endpoint, fingerprint, model, proposeRoster, questionTemplates } from './decision-policy.mjs';

// Entirely fictional fixtures. These probabilities are hand-authored to exercise
// the rules, not results from OpenAI or evidence of model quality.
export function exampleStory(id, overrides = {}) {
  return {
    id,
    title: `Fictional ${id} follow-up`,
    central_question: 'Will the announced software migration meet its published reliability target?',
    known_facts: 'The operator has committed to a reliability target. The migration is underway; the next measurement has not been released.',
    status: 'active',
    pinned: false,
    excluded: false,
    activated_at: '2026-11-01T12:00:00Z',
    last_material_at: '2026-11-10T12:00:00Z',
    next_expected_event: null,
    collection: { status: 'complete', checked_at: '2026-11-14T11:00:00Z' },
    evidence: [{
      id: `${id}-e1`,
      url: `https://news.fictional.example/${id}/update`,
      provenance: 'Fictional operator progress report used only for this demo.',
      published_at: '2026-11-10T12:00:00Z',
      retrieved_at: '2026-11-14T11:00:00Z',
      excerpt: 'The migration is still underway. The operator will publish follow-up reliability measurements; no final outcome is available yet.'
    }],
    new_evidence_ids: [],
    ...overrides
  };
}

export function exampleSnapshot(stories = [exampleStory('migration')], overrides = {}) {
  return {
    as_of: '2026-11-14T12:00:00Z',
    roster_revision: 42,
    initialized: true,
    last_promotion_at: '2026-11-10T12:00:00Z',
    discovery_ok: true,
    budget_available: true,
    stories,
    ...overrides
  };
}

export function syntheticEvaluation(snapshot, judgments = {}) {
  const request = buildRequest(snapshot);
  const answers = request.questions.map(question => {
    const separator = question.name.lastIndexOf('.');
    const storyId = question.name.slice(0, separator);
    const key = question.name.slice(separator + 1);
    const defaults = { evidence: 'sufficient', question_status: 'open', plausible_followup: 0.95, latest_development: 'repetition', priority: 3 };
    const value = judgments[storyId]?.[key] ?? defaults[key];
    if (value === 'refusal') return { type: 'refusal', name: question.name };
    if (question.type === 'predicate') return { type: 'predicate', name: question.name, probability: value };
    if (question.type === 'choice') {
      return {
        type: 'choice', name: question.name, choice: value, confidence: 0.96,
        probabilities: question.choices.map(option => ({ value: option.value, probability: option.value === value ? 0.96 : 0.02 }))
      };
    }
    // For fractional scores, distribute across adjacent rubric levels.
    const lower = Math.floor(value);
    const fraction = value - lower;
    const probabilities = question.levels.map((level, index) => ({ label: level.label, value: index, probability: index === lower ? 1 - fraction : index === lower + 1 ? fraction : 0 }));
    return { type: 'score', name: question.name, score: value, confidence: Math.max(...probabilities.map(item => item.probability)), probabilities };
  });
  return { synthetic: true, request_hash: fingerprint(request), response: { model, answers } };
}

export function demoScenario() {
  const revival = exampleStory('old-appeal', {
    title: 'A six-month-old appeal receives a new hearing date',
    central_question: 'Will the pending appeal change the software project’s license obligations?',
    known_facts: 'A license ruling was appealed in May. At the last update, no appeal hearing had been scheduled.',
    status: 'quiet',
    activated_at: '2026-05-01T12:00:00Z',
    last_material_at: '2026-05-14T12:00:00Z',
    evidence: [{
      id: 'appeal-new-hearing',
      url: 'https://court.fictional.example/appeal-123/hearing',
      provenance: 'Fictional court docket, supplied as a primary-source fixture.',
      published_at: '2026-11-14T10:00:00Z',
      retrieved_at: '2026-11-14T11:00:00Z',
      excerpt: 'The pending license appeal has been set for a hearing on November 19. The merits of the appeal have not yet been decided.'
    }],
    new_evidence_ids: ['appeal-new-hearing'],
    next_expected_event: { at: '2026-11-19T12:00:00Z', evidence_id: 'appeal-new-hearing' }
  });
  const snapshot = exampleSnapshot([
    exampleStory('migration'),
    exampleStory('security-fix', { pinned: true }),
    exampleStory('release'),
    exampleStory('research'),
    exampleStory('standards'),
    revival
  ]);
  const evaluation = syntheticEvaluation(snapshot, { migration: { priority: 2 }, 'old-appeal': { latest_development: 'material', priority: 4 } });
  return { snapshot, evaluation };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { snapshot, evaluation } = demoScenario();
  const mode = process.argv[2] ?? 'plan';
  const outputs = {
    snapshot,
    request: buildRequest(snapshot),
    response: evaluation,
    plan: proposeRoster(snapshot, evaluation),
    contract: { endpoint, question_types: questionTemplates.map(question => ({ name: question.name, type: question.type })) }
  };
  if (!(mode in outputs)) throw new Error('Use plan, snapshot, request, response, or contract');
  process.stdout.write(JSON.stringify(outputs[mode], null, 2) + '\n');
}

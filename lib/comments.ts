import {readArchive,readPublication} from './publication';
import {layoutContract} from './layout';
import bundledEdition from '../data/published-seed.json';
import bundledVersion from '../data/prebuilt-version.json';
import {createCommentsService as createCore,type EditionLike,type Dependencies} from './comments-core';
export * from './comments-core';
function positiveId(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
async function defaultEdition(request: Request, env: Cloudflare.Env, date: string | null, version: string | null): Promise<EditionLike | null> {
  if (version) {
    // A tab's displayed snapshot remains eligible after an hourly replacement.
    // Accept only content-addressed publication IDs, never caller storage keys.
    let edition: EditionLike | null = null;
    if (version === bundledVersion.version) edition = bundledEdition;
    else if (/^e-[a-f0-9]{24}$/.test(version)) {
      const object = await env.BUCKET?.get('publication/versions/' + version + '.json');
      if (!object) return null;
      const value: unknown = await object.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const record = value as { version?: unknown; edition?: EditionLike };
      const candidate = record.edition;
      if (record.version !== version || !candidate || !Array.isArray(candidate.stories) || candidate.stories.length < 1 || !candidate.stories.every(story => story && positiveId(story.id)) || new Set(candidate.stories.map(story => story.id)).size !== candidate.stories.length || typeof candidate.generatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.generatedAt))) return null;
      if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 1) return null;
      if (candidate.layoutVersion !== undefined && (!Number.isSafeInteger(candidate.layoutVersion) || candidate.layoutVersion < 1)) return null;
      try { if (candidate.stories.length > layoutContract(candidate.layoutVersion ?? 1).capacity.total) return null; }
      catch { return null; }
      edition = candidate;
    }
    if (!edition || (date && date !== (edition.editionDate || edition.generatedAt?.slice(0, 10)))) return null;
    return edition;
  }
  if (date) return (await readArchive(request, env, date))?.edition ?? null;
  return (await readPublication(request, env)).publication.current.edition;
}

export function createCommentsService(dependencies:Partial<Dependencies>={}){return createCore({...dependencies,readEdition:dependencies.readEdition??defaultEdition});}
export const commentsApi=createCommentsService();

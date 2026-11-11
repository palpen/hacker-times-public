import {RequestError} from '../security';
// Identifier-only boundary of the prior platform interruption, never editorial copy.
// Fresh hosting, an empty ledger, or owner approval does not clear this boundary.
export const restrictedIds = new Set([50414427,50414234,50414155,50414215,50366902,50373004,50347552]);
export function assertPermittedSelection(stories:readonly {id:number}[]) {
  if(stories.some(s=>restrictedIds.has(s.id))) throw new RequestError('Complete selection overlaps the prior restricted batch; retain publication. No substitution or reconstruction.',409);
}

import {categories,legacyCategories,type Edition,type Story} from './contracts';

// A presentation contract, independent of policy/algorithm versions. Existing
// placed editions predate layoutVersion; unplaced editions use the legacy rail.
export const LAYOUT_VERSION = 1;
export const layoutCapacity = {top:7,total:34} as const;
export const monthlyLayoutCapacity={top:7,total:42} as const;
export function layoutContract(version=1){if(version===1)return {capacity:layoutCapacity,categories:legacyCategories};if(version===2)return {capacity:monthlyLayoutCapacity,categories};throw Error('Unsupported edition layout version');}
export function editionLayout(edition:Edition){
 const stories=edition.stories;
 const {capacity,categories}=layoutContract(edition.layoutVersion??1);
 if(edition.schemaVersion!==undefined&&edition.schemaVersion!==1)throw Error('Unsupported edition schema version');
 const expanded=edition.layoutVersion!==undefined||stories.some(s=>s.placement!==undefined);
 if(!expanded)return {categories,expanded,lead:stories[0],features:stories.slice(0,8),rail:stories.slice(8),desks:[] as {name:string;stories:Story[]}[]};
 if(new Set(stories.map(s=>s.id)).size!==stories.length)throw Error('Duplicate layout story');
 if(stories.some(s=>!['lead','top','discussion','section'].includes(s.placement||'')))throw Error('Every story needs a supported placement');
 const leads=stories.filter(s=>s.placement==='lead');
 const top=stories.filter(s=>s.placement==='top');
 if(leads.length!==1||top.length>capacity.top||stories.length>capacity.total)throw Error('Edition exceeds supported layout capacity');
 const section=stories.filter(s=>s.placement==='section');
 if(section.some(s=>!categories.some(c=>c===s.category)))throw Error('Unsupported topic desk');
 return {categories,expanded,lead:leads[0],features:[leads[0],...top],rail:stories.filter(s=>s.placement==='discussion'),desks:categories.map(name=>({name,stories:section.filter(s=>s.category===name)})).filter(d=>d.stories.length)};
}

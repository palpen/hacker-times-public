import {editionAssets} from './edition-assets';

export const mobileSectionsAssets=()=>`<link data-mobile-sections rel="stylesheet" href="${editionAssets.mobileSectionsCss}" media="(max-width: 680px)"><script src="${editionAssets.mobileSectionsJs}" defer></script>`;

// Enhance retained edition HTML on reads without rewriting the publication,
// edition data, or existing versioned assets.
export function withMobileSections(html:string){
 if(html.includes('<link data-mobile-sections ')||!html.includes('<script id="edition-data"')||!html.includes('<nav class="sections"'))return html;
 const reader=/<script src="\/reader-assets\/reader-[a-f0-9]{16}\.js" defer><\/script>/;
 return html.replace(reader,match=>match+mobileSectionsAssets());
}

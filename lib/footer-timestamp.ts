import {editionAssets} from './edition-assets';

// Move the existing label in retained HTML at read time. Saved edition data,
// archive records, publication identities and article submission ages stay intact.
export function withFooterTimestamp(html:string){
 if(html.includes('class="edition-update footer-update"')||!html.includes('</footer>'))return html;
 const original=html.match(/<span class="desktop-date edition-update"[^>]*>[\s\S]*?<\/span>/)?.[0];
 if(!original)return html;
 const footer=original.replace('<span class="desktop-date edition-update"','<p class="edition-update footer-update"').replace(/<\/span>$/,'</p>');
 return html.replace(original,'').replace('</footer>',footer+'</footer>').replace('</head>',`<link rel="stylesheet" href="${editionAssets.footer}"></head>`);
}

import {editionAssets} from './edition-assets';
import type {Edition} from './contracts';
export const submissionAgeScript=()=>`<script data-submission-ages src="${editionAssets.ages}" defer></script>`;
// Presentation-only enhancement for immutable old archive HTML. Do not rewrite
// saved records, timestamps, identifiers, comment versions or their asset hashes.
export function withSubmissionAges(html:string,edition:Edition){
 if(html.includes('<script data-submission-ages '))return html;
 const times=JSON.stringify((edition.discussionHighlights?.sources??[]).map(({id,time})=>({id,time}))).replace(/</g,'\\u003c');
 return html.replace('</head>',`<script id="hn-submission-times" type="application/json">${times}</script>`+submissionAgeScript()+'</head>');
}

import {categories} from './contracts';
import {editionAssets} from './edition-assets';

// Update retained editions at read time without changing their saved content,
// publication version, timestamps, or discussion snapshot.
export function withSectionHeadingLinks(html:string){
 let updated=html;
 for(const name of categories){
  const id='desk-'+name.toLowerCase();
  updated=updated.replace(
   `<h2 id="${id}">${name}</h2><button data-section="${name}">View all <span aria-hidden="true">→</span></button>`,
   `<h2 id="${id}"><a href="#${id}" data-section="${name}">${name}</a></h2>`
  );
 }
 // Also update the immediately previous grid stylesheet in saved editions.
 const previousGridCSS='/reader-assets/paper-45999a7f119cb388.css';
 if(updated===html&&!html.includes('href="'+previousGridCSS+'"'))return html;
 return updated.replace(/<link rel="stylesheet" href="\/reader-assets\/paper-[a-f0-9]{16}\.css">/,`<link rel="stylesheet" href="${editionAssets.css}">`);
}

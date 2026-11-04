import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';

// Resolve the actual class/type selectors, specificity and source order across
// all viewport breakpoints, rather than matching an overridden declaration.
const targets = {
 lead: [['h2'], ['article','article','lead'], ['div','lead-column']],
 secondary: [['h2'], ['article','article','secondary'], ['div','lead-column']],
 side: [['h2'], ['article','article'], ['div','side-column']],
 brief: [['h2'], ['article','article','brief'], ['div','side-column']],
 grid: [['h2'], ['article','article'], ['div','story-grid']],
 feature: [['h2'], ['article','article','desk-feature']],
 deskBrief: [['h2'], ['article','article','desk-brief']],
 rail: [['h3'], ['article','rail-card']],
};
const matchesPart = (part, element) => {
 if (!/^(?:[a-z][a-z0-9]*)?(?:\.[\w-]+)*$/i.test(part)) return false;
 const tag=part.match(/^[a-z][a-z0-9]*/i)?.[0];
 return (!tag || tag===element[0]) && [...part.matchAll(/\.([\w-]+)/g)].every(m=>element.slice(1).includes(m[1]));
};
function matches(selector, elements) {
 const parts=selector.trim().split(/\s+/).reverse();
 if (!matchesPart(parts[0],elements[0])) return false;
 let ancestor=1;
 for (const part of parts.slice(1)) {
  while(ancestor<elements.length && !matchesPart(part,elements[ancestor])) ancestor++;
  if (ancestor===elements.length) return false;
  ancestor++;
 }
 return true;
}
function value(css,width,elements,property) {
 let result; let best=-1;
 postcss.parse(css).walkRules(rule=>{
  for(let parent=rule.parent;parent;parent=parent.parent) {
   if(parent.type!=='atrule') continue;
   if(parent.name!=='media') return;
   const query=parent.params.replaceAll(' ','');
   const max=query.match(/^\(max-width:(\d+)px\)$/);
   if(!max || width>Number(max[1])) return;
  }
  for(const selector of rule.selector.split(',')) {
   if(!matches(selector,elements)) continue;
   const specificity=(selector.match(/\./g)||[]).length*100+(selector.match(/(?:^|\s)[a-z][\w-]*/gi)||[]).length;
   rule.walkDecls(property,decl=>{
    const rank=specificity+(decl.important?10000:0);
    if(rank>=best){best=rank;result=decl.value;}
   });
  }
 });
 return result;
}
const source=fs.readFileSync('app/globals.css','utf8');
const assets=JSON.parse(fs.readFileSync('lib/edition-assets.ts','utf8').match(/editionAssets=(.*);/)[1]);
const bundled=fs.readFileSync('public/edition-assets/'+assets.css.split('/').pop(),'utf8');
const widths=[280,320,359,360,361,375,393,430,679,680,681,1000,1001,1280];
for(const [label,css] of [['source',source],['served bundle',bundled]]) {
 for(const width of widths) {
  const sizes=width<=360?[32,27,25,22,24,25,22,21]:width<=680?[36,28,26,22,25,26,22,21]:width<=1000?[42,30,25,22,25,28,22,20]:[48,30,25,22,25,28,22,20];
  for(const [[name,elements],size] of Object.entries(targets).map((entry,i)=>[entry,sizes[i]])) {
   assert.equal(value(css,width,elements,'font-size'),`${size}px`,`${label}: ${name} at ${width}px`);
   if(name==='rail') continue;
   const deck=[['p','deck'],...elements.slice(1)];
   const expected=width<=360?17:width<=680?(name==='lead'?18:17):name==='lead'?(width<=1000?18:19):name==='secondary'?16:15;
   assert.equal(value(css,width,deck,'font-size'),`${expected}px`,`${label}: ${name} deck at ${width}px`);
   if(width<=680) assert.ok(Number(value(css,width,deck,'line-height'))>=1.5,`${name} deck line-height`);
  }
  assert.equal(value(css,width,[['div','story-meta']],'font-size'),'12px');
  assert.equal(value(css,width,[['figcaption'],['figure','story-photo']],'font-size'),width<=680?'14px':'12px');
  assert.equal(value(css,width,[['button','icon-button']],'width'),'44px');
  assert.equal(value(css,width,[['button','icon-button']],'height'),'44px');
  assert.equal(value(css,width,[['h1'],['a','brand']],'font-size'),width<=360?'40px':width<=680?'46px':width<=1000?'64px':'78px');
  // Selected preview E: keep 17px on every mobile width, including the
  // narrowest breakpoint, and 19px above 680px. Resolve the effective cascade
  // in source and the served asset so stale or overriding rules cannot pass.
  const excerpt=[['p','highlight-excerpt'],['article','highlight-slide']];
  const excerptSize=value(css,width,excerpt,'font-size');
  const excerptLineHeight=value(css,width,excerpt,'line-height');
  assert.equal(excerptSize,width<=680?'17px':'19px',`${label}: comment size at ${width}px`);
  assert.equal(excerptLineHeight,width<=680?'1.48':'1.45',`${label}: comment line-height at ${width}px`);
  assert.equal((Number.parseFloat(excerptSize)*Number(excerptLineHeight)).toFixed(2),width<=680?'25.16':'27.55',`${label}: comment line box at ${width}px`);
  assert.equal(value(css,width,[['h2'],['div','highlight-heading']],'font-size'),width<=360?'25px':width<=680?'27px':'31px',`${label}: preserved discussion heading at ${width}px`);
  assert.equal(value(css,width,[['h3','highlight-story'],['article','highlight-slide']],'font-size'),width<=680?'13px':'14px',`${label}: preserved discussion story label at ${width}px`);
  assert.equal(value(css,width,[['div','highlight-attribution'],['article','highlight-slide']],'font-size'),'12px',`${label}: preserved discussion attribution at ${width}px`);
 }
}
console.log(`PASS: source and served CSS effective type scale at ${widths.length} widths; selected 17px mobile / 19px desktop comments and line boxes; preserved article and discussion headings, decks, masthead, captions, metadata and touch targets.`);
// Only the one-row front-page grid loses its redundant desktop closing rules.
// Search/filter result grids and mobile interior story separators stay intact.
for(const [label,css] of [['source',source],['served bundle',bundled]]){
 const tree=postcss.parse(css);let rule;
 tree.walkRules('.story-grid:not(.filtered-grid)>.article',node=>{rule=node;});
 assert.ok(rule,`${label}: scoped front-page closing-rule override`);
 assert.equal(rule.parent.name,'media');assert.equal(rule.parent.params.replaceAll(' ',''),'(min-width:681px)');
 assert.deepEqual(rule.nodes.map(d=>[d.prop,d.value]),[['border-bottom','0']]);
 let articleRule,sectionRule;
 tree.walkRules('.article',node=>{if(node.parent.type==='root')articleRule=node;});
 tree.walkRules('#discussion-highlights',node=>{if(node.parent.type==='root')sectionRule=node;});
 assert.equal(articleRule.nodes.find(d=>d.prop==='border-bottom')?.value,'1px solid var(--line)');
 assert.equal(sectionRule.nodes.find(d=>d.prop==='border-top')?.value,'2px solid var(--ink)');
}
for(const file of ['app/front-page.tsx','lib/render-edition.ts'])assert.ok(fs.readFileSync(file,'utf8').includes('features.slice(5,8)'),`${file}: closing-rule scope remains a one-row front-page grid`);
console.log('PASS: front-page-only desktop closing rules removed; mobile, filter grids and bold carousel boundary preserved.');

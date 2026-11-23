import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const {mobileSectionsJs}=JSON.parse(fs.readFileSync('lib/edition-assets.ts','utf8').match(/editionAssets=(.*);/)[1]);
const script=fs.readFileSync('public/edition-assets/'+mobileSectionsJs.split('/').at(-1),'utf8');

test('mobile section controls reuse masthead navigation and track scroll, dismissal and viewport',()=>{
 let activeObserver,visibilityObserver,viewportHandler,lastScroll,navigations=[];
 class Element{
  constructor(tag='div'){this.tag=tag;this.dataset={};this.attrs={};this.children=[];this.handlers={};this.hidden=false;this.open=false;}
  setAttribute(key,value){this.attrs[key]=value;}
  removeAttribute(key){delete this.attrs[key];}
  addEventListener(name,handler){this.handlers[name]=handler;}
  appendChild(node){Object.assign(node,{parent:this});this.children.push(node);}
  insertBefore(node,position){assert.equal(position,this.firstChild);Object.assign(node,{parent:this});this.children.unshift(node);}
  get firstChild(){return this.children[0];}
  remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
  getBoundingClientRect(){return {top:100,bottom:150};}
  focus(opts){assert.equal(opts.preventScroll,true);this.focused=true;}
  set innerHTML(_){
   if(this.tag==='dialog'){this.appendChild(new Element('button'));this.appendChild(new Element('nav'));}
   if(this.tag==='nav'){this.appendChild(new Element('div'));}
  }
  querySelector(key){
   if(key==='[aria-current=page]')return this.children.find(n=>n.attrs['aria-current']==='page');
   return this.children.find(x=>x.tag===(key==='.mobile-sections-links'?'div':key));
  }
  querySelectorAll(selector){
   if(selector==='a[href]')return this.children.filter(n=>n.tag==='a');
   if(selector==='[data-mobile-section]')return this.children.flatMap(n=>n.dataset.mobileSection?[n]:n.querySelectorAll(selector));
   return [];
  }
  click(event={}){
   const e={defaultPrevented:false,button:0,preventDefault(){this.defaultPrevented=true;},...event};
   if(!e.target)Reflect.set(e,"target",this);this.handlers.click?.(e);return e;
  }
 }
 class Dialog extends Element{
  constructor(){super('dialog');}
  showModal(){this.open=true;}
  close(){this.open=false;}
 }
 const footer=new Element('footer'),footerLine=new Element('footer-line');footer.appendChild(footerLine);
 const body=new Element('body'),top=new Element('nav'),filteredHeading=new Element('h2'),brand=new Element('a');
 const names=['Today','Technology','AI','Software','Science','Culture','Business','Games','Developing News'];
 for(const name of names){
  const link=new Element('a');link.textContent=name;link.href=name==='Developing News'?'/developing-news':'/?section='+name;
  if(name!=='Developing News')link.dataset.section=name;
  link.addEventListener('click',()=>{
   navigations.push(name);
   top.children.forEach(a=>a.removeAttribute('aria-current'));link.setAttribute('aria-current','page');activeObserver.fn();
  });
  top.appendChild(link);
 }
 top.firstChild.setAttribute('aria-current','page');
 const media={matches:false,addEventListener(type,fn){assert.equal(type,'change');viewportHandler=fn;}};
 runInNewContext(script,{
  document:{querySelector:key=>({'nav.sections':top,'main.paper > footer':footer,'#filtered-heading':filteredHeading,'.masthead .brand':brand})[key],
   body,createElement:tag=>tag==='dialog'?new Dialog():new Element(tag)},
  HTMLDialogElement:Dialog,matchMedia:()=>media,window:{scrollTo:opts=>{lastScroll=opts.top;assert.equal(opts.behavior,'instant');}},
  IntersectionObserver:class{constructor(fn){visibilityObserver={fn};}observe(){}disconnect(){visibilityObserver.disconnected=true;}},
  MutationObserver:class{constructor(fn){activeObserver={fn};}observe(){}disconnect(){activeObserver.disconnected=true;}},
 });
 assert.equal(body.children.length,0);
 media.matches=true;viewportHandler();
 assert.equal(footer.children[1],footerLine,'original footer stays immediately after index');
 const [trigger,sheet]=body.children,index=footer.firstChild;
 assert.equal(trigger.hidden,true);
 assert.equal(trigger.attrs['aria-haspopup'],'dialog');
 assert.equal(sheet.attrs['aria-labelledby'],'mobile-sections-title');
 assert.deepEqual(sheet.querySelector('nav').children.map(n=>n.textContent),names);
 assert.deepEqual(index.querySelector('div').children.map(n=>n.textContent),names);
 assert.equal(sheet.querySelector('nav').firstChild.attrs['aria-current'],'page');
 visibilityObserver.fn([{target:top,isIntersecting:false,boundingClientRect:{top:-15}}]);
 assert.equal(trigger.hidden,false);
 trigger.click();assert.equal(sheet.open,true);
 sheet.querySelector('button').click();assert.equal(sheet.open,false);assert.equal(lastScroll,undefined);
 trigger.click();sheet.click({clientY:20});assert.equal(sheet.open,false);assert.equal(lastScroll,undefined);
 trigger.click();
 const ai=sheet.querySelector('nav').children[2];
 assert.equal(ai.click({metaKey:true}).defaultPrevented,false);assert.deepEqual(navigations,[]);
 assert.equal(ai.click().defaultPrevented,true);assert.deepEqual(navigations,['AI']);
 assert.equal(sheet.open,false);assert.equal(ai.attrs['aria-current'],'page');
 assert.equal(index.querySelector('div').children[2].attrs['aria-current'],'page');
 assert.equal(lastScroll,0);assert.equal(filteredHeading.focused,true);
 visibilityObserver.fn([{target:index,isIntersecting:true}]);assert.equal(trigger.hidden,true);
 const external=index.querySelector('div').children.at(-1);
 assert.equal(external.href,'/developing-news');assert.equal(external.click().defaultPrevented,false);
 media.matches=false;viewportHandler();assert.deepEqual(body.children,[]);assert.deepEqual(footer.children,[footerLine]);
 assert.equal(activeObserver.disconnected,true);assert.equal(visibilityObserver.disconnected,true);
});

import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hacker-theme-'));
await build({entryPoints:['lib/theme.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'theme.mjs')});
const {resolveTheme,nextTheme,themeInitScript,THEME_KEY}=await import(pathToFileURL(path.join(temp,'theme.mjs')).href);
assert.equal(resolveTheme(null,false),'light');assert.equal(resolveTheme(null,true),'dark');
assert.equal(resolveTheme('dark',false),'dark');assert.equal(resolveTheme('light',true),'light');assert.equal(resolveTheme('invalid',true),'dark');
assert.equal(nextTheme('dark'),'light');assert.equal(nextTheme('light'),'dark');
for(const [saved,system,expected] of [[null,false,'light'],[null,true,'dark'],['dark',false,'dark'],['light',true,'light']]){
 const document={documentElement:{dataset:{},style:{}}};
 vm.runInNewContext(themeInitScript,{document,localStorage:{getItem:key=>{assert.equal(key,THEME_KEY);return saved}},matchMedia:()=>({matches:system})});
 assert.equal(document.documentElement.dataset.theme,expected);assert.equal(document.documentElement.style.colorScheme,expected);
}
assert.doesNotThrow(()=>vm.runInNewContext(themeInitScript,{localStorage:{getItem:()=>{throw Error('storage blocked')}},document:{}}));
function luminance(hex){return hex.match(/[\da-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0)}
function contrast(a,b){const l=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05)}
const palette={light:{paper:'#ffffff',ink:'#121212',deck:'#535353',muted:'#666666',focus:'#00699e'},dark:{paper:'#151515',ink:'#f2f2f2',deck:'#bdbdbd',muted:'#a3a3a3',focus:'#8cc8ee'}};
for(const [mode,colors] of Object.entries(palette))for(const key of ['ink','deck','muted','focus']){const ratio=contrast(colors[key],colors.paper);assert.ok(ratio>=4.5,`${mode} ${key}: ${ratio}`);console.log(`${mode} ${key}: ${ratio.toFixed(2)}:1`)}
const css=fs.readFileSync('app/globals.css','utf8'),page=fs.readFileSync('app/front-page.tsx','utf8');
assert.ok(css.includes('prefers-color-scheme:dark'));assert.ok(page.includes('aria-pressed={theme'));assert.ok(page.includes('localStorage.setItem(THEME_KEY,selected)'));assert.ok(!page.includes('THE LATEST EDITION'));assert.ok(!page.includes('A NOTE FROM THE DESK'));assert.ok(!page.includes('THE LEAD'));
console.log('PASS: system preference, saved override, toggle, early theme application, blocked-storage resilience, accessible control hooks, WCAG AA text/focus contrast.');
fs.rmSync(temp,{recursive:true,force:true});

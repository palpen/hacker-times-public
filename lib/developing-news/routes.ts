import type {ProductionEnv} from '../production/types';
import type {PublicNews,PublicThread} from './types';
import {renderDevelopingIndex,renderDevelopingStory} from './render';
import {THEME_KEY} from '../theme';
export async function developingRequest(env:ProductionEnv,path:string,method='GET'){
 if(!env.DEVELOPING_NEWS)return new Response('Unavailable',{status:503});
 return env.DEVELOPING_NEWS.get(env.DEVELOPING_NEWS.idFromName('developing-v1')).fetch(new Request('https://developing.internal'+path,{method}));
}
export async function developingList(env:ProductionEnv):Promise<PublicNews|null>{
 try{const r=await developingRequest(env,'/list');return r.ok?await r.json() as PublicNews:null;}catch{return null;}
}
export async function developingRoute(request:Request,env:ProductionEnv):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname;
 if(path==='/developing-news-theme.js')return new Response(`(()=>{const b=document.getElementById('developing-theme');const label=()=>b.setAttribute('aria-label','Switch to '+(document.documentElement.dataset.theme==='dark'?'light':'dark')+' mode');label();b.addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem(${JSON.stringify(THEME_KEY)},t)}catch{}label()})})()`,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=3600'}});
 const api=path.startsWith('/api/developing-news'),route=api?path.slice(4):path;
 if(route!=='/developing-news'&&!/^\/developing-news\/s-[a-f0-9]{20}$/.test(route))return null;
 const id=route.slice('/developing-news/'.length),isIndex=route==='/developing-news';
 const response=await developingRequest(env,(isIndex?'/list':'/story/'+id)+url.search);
 if(api)return response;
 if(!isIndex&&!response.ok)return new Response(response.status===404?'Story not found':'This story is temporarily unavailable. Please try again.',{status:response.status});
 const html=isIndex?renderDevelopingIndex(response.ok?await response.json() as PublicNews:null):renderDevelopingStory(await response.json() as PublicThread,url.searchParams.has('before'));
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

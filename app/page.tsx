import { env } from 'cloudflare:workers';
import FrontPage from './front-page';
import seed from '../data/edition.json';
import type { Edition } from '../lib/news';
export const dynamic = 'force-dynamic';
export default async function Home(){
 let edition=seed as Edition;
 try { const stored=await env.BUCKET?.get('edition.json');if(stored)edition={...await stored.json<Edition>(),persisted:true}; } catch {}
 return <FrontPage initialEdition={edition}/>;
}

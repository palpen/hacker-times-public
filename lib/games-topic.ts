import type {Candidate, Category} from './contracts';

export type GamesEvidence={text?:string;description?:string};
const gameSubjects=/\b(video[- ]?games?|computer games?|board games?|card games?|gaming|gameplay|gamedev|game development|game engines?|game design|game consoles?|arcade|roguelikes?|platformers?|first.person shooters?|multiplayer games?|speedruns?|speedrunning|esports|puzzles?|crosswords?|sudoku|chess|wordle|minesweeper|tetris|pac.man|playstation|xbox|nintendo|steam deck|game ?boy)\b/i;
// Reusable franchise vocabulary, not story IDs, full headline exceptions or
// source-host overrides. Ambiguous words such as Doom/Quake need play context.
const franchises=/\b(unreal tournament|grand theft auto|gta\s*[1-6]|simcity|minecraft|counter.strike|half.life|civilization\s*(?:[1-7]|vi?i?)|final fantasy|super mario|legend of zelda|baldur['’]?s gate)\b/i;
const playContext=/\b(play(?:able|ing|ed)?|players?|browser|review|remake|remaster|modding|mods?|levels?|controller|joystick|fps|demo|port(?:ed|ing)?|source code|engine|bootable|uefi)\b/i;
const nonPlay=/\b(game theory|game[- ]chang(?:er|ing)|blame game|end game|zero.sum game|numbers game|stock (?:ticker|market)|(?:ticker|stock symbol)\s*:?\s*(?:game|gme)|game of (?:politics|business|life)|(?:gaming|game) the (?:\w+\s+){0,2}(?:system|market|algorithm)|game plan|gameplay metaphors?|gaming metaphors?)\b/i;
const realGameContext=/\b(?:playable|video|computer|board|card|browser|cartoon|arcade|typing|puzzle|racing|driving|guessing|word|strategy)\s+(?:\w+\s+){0,2}games?\b|\bgame\b.{0,60}\b(?:play|players?|controls|levels|score points)\b/i;

/** Bounded local evidence only. URLs are clues, never fetched or trusted alone. */
export function isGamesStory(title:string,url:string,evidence:GamesEvidence={}):boolean {
 const headline=title.slice(0,4096).normalize('NFKC');
 // News hooks are not the subject of the submitted project. Classify the
 // actual thing built after a causal/contrast clause rather than its hook.
 const clauses=headline.split(/(?:,|[—–;])?\s+(?:so|but)\s+(?=(?:I|we)\s+(?:built|made|created|wrote|launched))/i);
 const t=clauses.at(-1)!;
 const context=[evidence.description?.slice(0,700),evidence.text?.slice(0,8500)].filter(Boolean).join(' ').replace(/<[^>]*>/g,' ').slice(0,1200);
 const unrelated=/\b(?:browser agents?|stock tickers?|databases?|spreadsheets?|productivity|business strategy|search algorithm)\b/i.test(t)&&!realGameContext.test(t);
 if(unrelated)return false;
 // Explicit playable material can coexist with an academic subject/metaphor.
 if(realGameContext.test(t)||realGameContext.test(context))return true;
 if(nonPlay.test(t))return false;
 if(franchises.test(t)||gameSubjects.test(t))return true;
 if(/\bgames?\b/i.test(t))return true;
 if(/\b(doom|quake|portal)\b/i.test(t)&&playContext.test(t))return true;
 // A bare franchise mention in a long self-post is not classification
 // evidence: require a concrete description of a game or its development.
 if(/\b(?:this|it|project)\s+(?:is|was)\b.{0,80}\b(?:game|puzzle|platformer|roguelike)\b|\b(?:built|made|created|developed)\b.{0,60}\b(?:game|puzzle|platformer|roguelike)\b/i.test(context))return true;
 let path='';try{path=decodeURIComponent(new URL(url).pathname).replace(/[-_\/]+/g,' ');}catch{/* malformed URL supplies no evidence */}
 return playContext.test(t)&&(gameSubjects.test(path)||franchises.test(path));
}

/** Keep original primary desk and selection inputs; Games is an overlapping view. */
export function withGamesTopic<T extends Candidate>(story:T,evidence:GamesEvidence={}):T & {gamesTopicVersion:1} {
 const topics:Category[]=(story.topics??[]).filter(topic=>topic!=='Games');
 if(isGamesStory(story.title,story.url,evidence))topics.push('Games');
 return {...story,topics,gamesTopicVersion:1};
}

/** Old editions retain their original category/topic behavior. */
export function inStorySection(story:{category:string;topics?:Category[];gamesTopicVersion?:1;gamesOnly?:true},section:string):boolean {
 if(story.gamesOnly&&section!=='Games')return false;
 if(section==='Games'&&story.gamesTopicVersion===1)return !!story.topics?.includes('Games');
 return section==='Today'||story.category===section||!!story.topics?.includes(section as Category);
}

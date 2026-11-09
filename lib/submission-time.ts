// HN item.time is Unix seconds. Never substitute the edition/source-batch time.
export function submissionTime(value:unknown){
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)return null;
 const date=new Date(value*1000);if(!Number.isFinite(date.getTime()))return null;
 const iso=date.toISOString();
 return {iso,label:iso.slice(0,10),title:'Submitted to Hacker News: '+iso.replace('T',' ').replace('.000Z',' UTC')};
}
export function submissionAge(value:unknown,now=Date.now()):string|null{
 if(!submissionTime(value)||!Number.isFinite(now))return null;
 const seconds=Math.floor((now-(value as number)*1000)/1000);if(seconds<0)return null;
 if(seconds<60)return 'just now';
 for(const [unit,size] of [['y',365*86400],['d',86400],['h',3600],['m',60]] as const)if(seconds>=size)return Math.floor(seconds/size)+unit+' ago';
 return null;
}

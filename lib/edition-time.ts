// This is the source-batch timestamp of the successfully published edition,
// never the visitor's clock or the time a template is rebuilt.
export function editionUpdateTime(value:string):{dateTime?:string;label:string}{
 const date=new Date(value);
 if(!value||!Number.isFinite(date.getTime()))return {label:'Unavailable'};
 const dateTime=date.toISOString();
 try{
  const label=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Toronto',timeZoneName:'short'}).format(date);
  return {dateTime,label};
 }catch{
  // A runtime without Toronto timezone data still gets an exact, labelled time.
  return {dateTime,label:date.toUTCString().replace('GMT','UTC')};
 }
}

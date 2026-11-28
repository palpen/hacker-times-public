import type {PublisherRecoveryStatus} from '../publisher-recovery';
import type {Check} from './core';

const recoveryWorkflow='https://github.com/palpen/hacker-times-public/actions/workflows/recover-expired-edition.yml';
const website='https://hackertimes.ca/';
export type PublisherMailState={expired?:string;safety?:string;replacement?:string};

export function publisherNotice(status:PublisherRecoveryStatus|null,checks:Check[],sent:PublisherMailState={}){
 if(!status)return null;
 const {candidate,safetyHoldAt,recovery}=status;
 if(safetyHoldAt&&sent.safety!==safetyHoldAt)return {
  kind:'safety' as const,id:safetyHoldAt,
  message:{subject:'[Hacker Times] Action needed: publisher safety hold',
   text:'The publisher stopped and needs a maintainer review. Expired edition recovery is blocked while the hold is active. The latest published edition stays online if the website is healthy.\n\n'+website},
 };
 if(candidate&&!safetyHoldAt&&sent.expired!==candidate.generatedAt)return {
  kind:'expired' as const,id:candidate.generatedAt,
  message:{subject:'[Hacker Times] Action needed: recover an expired edition',
   text:'The unfinished edition is more than 48 hours old. You can set it aside and start a fresh one.\n\nRecover expired edition: '+recoveryWorkflow+'\n\nSign in to GitHub, keep the main branch selected, and tap Run workflow. There are no fields to fill in. You’ll get an email when a fresh edition is live.',
   html:'<p>The unfinished edition is more than 48 hours old. You can set it aside and start a fresh one.</p>'+
    '<p><a href="'+recoveryWorkflow+'" style="display:inline-block;padding:12px 16px;background:#24292f;color:#fff;border-radius:6px;text-decoration:none">Recover expired edition</a></p>'+
    '<p>Sign in to GitHub, keep the main branch selected, and tap <strong>Run workflow</strong>. There are no fields to fill in. You’ll get an email when a fresh edition is live.</p>'},
 };
 const replacement=recovery?.replacement;
 const available=checks.find(check=>check.name==='availability'),fresh=checks.find(check=>check.name==='freshness');
 if(recovery&&replacement&&sent.replacement!==recovery.id&&available?.ok&&fresh?.ok&&fresh.version&&
    available.version===fresh.version&&(fresh.version===replacement.version||Date.parse(fresh.generatedAt??'')>Date.parse(replacement.generatedAt)))return {
  kind:'replacement' as const,id:recovery.id,
  message:{subject:'[Hacker Times] Recovered: a fresh edition is live',
   text:'The publisher recovered the expired edition. A fresh edition is now live and the homepage is serving it.\n\nRead Hacker Times: '+website},
 };
 return null;
}

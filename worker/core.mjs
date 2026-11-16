import {createHash} from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
export function isPublicIP(address){
 if(net.isIP(address)===4){let [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));}
 // IPv6 destinations are deliberately unsupported in this initial worker.
 return false;
}
export async function validateTarget(raw,hosts){let u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('HTTP(S) URL without credentials required');if(!hosts.includes(u.hostname))throw Error('대상 도메인이 TARGET_HOSTS에 등록되어 있지 않습니다.');if(u.port&&!['80','443'].includes(u.port))throw Error('비표준 대상 포트는 허용하지 않습니다.');let addresses=await dns.lookup(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!isPublicIP(a.address)))throw Error('내부 주소 또는 지원하지 않는 주소입니다.');u.hash='';return u}
export function normalizeUrl(raw){let u=new URL(raw);for(let key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href}
export function signature(url,snap){return createHash('sha256').update(JSON.stringify([normalizeUrl(url),snap.title,snap.headings,snap.dialog,snap.active,Math.floor((snap.scroll?.y||0)/100),snap.targets.map(t=>[t.key,t.disabled])])).digest('hex').slice(0,24)}
export function excludedAction(t){let text=`${t.name||''} ${t.href||''}`;return /삭제|결제|구매|주문|탈퇴|로그아웃|전송|제출|저장|등록|수정|장바구니|delete|remove|checkout|purchase|buy now|place order|sign out|logout|submit|send|save|subscribe|add to cart|upload/i.test(text)||t.type==='submit'||t.tag==='input';}
export function sameOrigin(url,origin){try{return new URL(url).origin===origin}catch{return false}}

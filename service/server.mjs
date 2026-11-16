import http from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {chromium} from '../worker/node_modules/playwright/index.mjs';
import {explore} from '../worker/explorer.mjs';
import {validateTarget} from '../worker/core.mjs';
import {Ledger} from './ledger.mjs';
import {verifyStripe,stripe,packFromStripe} from './payments.mjs';
const env=process.env,token=env.SERVICE_TOKEN;
if(!token||token.length<32)throw Error('SERVICE_TOKEN must contain 32+ random characters.');
if(!env.SITE_ORIGIN||new URL(env.SITE_ORIGIN).protocol!=='https:')throw Error('SITE_ORIGIN HTTPS required.');
const dbPath=env.DATABASE_PATH||'/data/traceqa.sqlite';mkdirSync(dirname(dbPath),{recursive:true});const ledger=new Ledger(dbPath);ledger.recover();const active=new Map();
let packCache=null,packExpires=0;
async function pack(){if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)return null;if(packExpires>Date.now())return packCache;packCache=await packFromStripe(env);packExpires=Date.now()+60000;return packCache}
function publicRun(r){const {internal,...rest}=r;return rest}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function authorized(req){let a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b)}
async function rawBody(req){let chunks=[],length=0;for await(let c of req){length+=c.length;if(length>262144)throw Error('BODY_TOO_LARGE');chunks.push(c)}return Buffer.concat(chunks)}
function ready(){return !!env.OPENAI_API_KEY&&existsSync(chromium.executablePath())}
const server=http.createServer(async(req,res)=>{let path=new URL(req.url,'http://service').pathname;try{
 if(req.method==='GET'&&path==='/health')return json(res,200,{service:'traceqa-cloud',version:'0.2.0'});
 if(req.method==='POST'&&path==='/billing/webhook'){if(!env.STRIPE_WEBHOOK_SECRET)return json(res,503,{error:'BILLING_NOT_CONFIGURED'});let raw=await rawBody(req),event;try{event=verifyStripe(raw,req.headers['stripe-signature'],env.STRIPE_WEBHOOK_SECRET)}catch{return json(res,400,{error:'INVALID_WEBHOOK'})}try{return json(res,200,ledger.fulfill(event))}catch(e){return json(res,e.message==='ORDER_NOT_FOUND'?503:400,{error:'PAYMENT_NOT_FULFILLED'})}}
 if(!authorized(req))return json(res,401,{error:'UNAUTHORIZED'});
 if(req.method==='GET'&&path==='/status'){let p=await pack().catch(()=>null);return json(res,200,{ready:ready(),ai:!!env.OPENAI_API_KEY,browser:existsSync(chromium.executablePath()),billing:!!p,billingMode:'test',pack:p?{credits:p.credits,amount:p.amount,currency:p.currency}:null})}
 const owner=req.headers['x-traceqa-user'];if(typeof owner!=='string'||!owner||owner.length>256)return json(res,401,{error:'USER_REQUIRED'});
 if(req.method==='GET'&&path==='/account')return json(res,200,{...ledger.account(owner),history:ledger.history(owner),runs:ledger.list(owner)});
 if(req.method==='POST'&&path==='/checkout'){let input=JSON.parse((await rawBody(req)).toString()),requestId=String(input.requestId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))return json(res,400,{error:'INVALID_REQUEST_ID'});let p=await pack();if(!p)return json(res,503,{error:'결제 연결 준비 중입니다.'});let order=ledger.order(owner,requestId,p);if(order.checkout_url)return json(res,200,{url:order.checkout_url,test:true});let s=await stripe('checkout/sessions',{'mode':'payment','payment_method_types[0]':'card','line_items[0][price]':p.priceId,'line_items[0][quantity]':'1',client_reference_id:order.id,'metadata[order_id]':order.id,success_url:env.SITE_ORIGIN+'/?checkout=success#billing',cancel_url:env.SITE_ORIGIN+'/?checkout=cancel#billing'},env.STRIPE_SECRET_KEY,order.id);if(s.livemode!==false||!s.url?.startsWith('https://checkout.stripe.com/'))throw Error('INVALID_CHECKOUT');ledger.checkout(order.id,s.id,s.url);return json(res,200,{url:s.url,test:true})}
 if(req.method==='POST'&&path==='/runs'){let input=JSON.parse((await rawBody(req)).toString());if(!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId||''))return json(res,400,{error:'INVALID_REQUEST_ID'});let old=ledger.findRequest(owner,input.requestId);if(old)return json(res,200,{...JSON.parse(old.snapshot),used:old.used,budget:old.budget});if(!ready())return json(res,503,{error:'운영자가 AI 실행 환경을 준비 중입니다.'});if(input.authorized!==true)return json(res,400,{error:'대상 사이트 테스트 권한 확인이 필요합니다.'});if(active.size)return json(res,409,{error:'실행 서버가 사용 중입니다. 잠시 후 다시 시도하세요.'});let budget=Number(input.budget);if(!Number.isSafeInteger(budget)||budget<1||budget>10000)return json(res,400,{error:'사용 한도는 1~10,000 크레딧입니다.'});let hostname=new URL(input.url).hostname,hosts=env.TARGET_HOSTS?env.TARGET_HOSTS.split(',').map(x=>x.trim()):[hostname],url=await validateTarget(input.url,hosts);if(active.size)return json(res,409,{error:'실행 서버가 사용 중입니다.'});let r={id:randomUUID(),name:url.hostname,url:url.href,status:'실행 중',createdAt:new Date().toISOString(),pages:[],cases:[],features:[],defects:[],logs:[],pending:1,current:'AI 탐색 준비',budget,used:0};ledger.reserve(owner,input.requestId,budget,r);r.internal={created:Date.now(),stop:false,paused:false,requireAI:true,hosts,deadline:Date.now()+(Number(env.RUN_TIMEOUT_MINUTES)||30)*60000,beforeScreen:()=>{if(r.used>=r.budget)throw Error('CREDIT_LIMIT')},onScreen:async(p,key)=>{r.used=ledger.consume(r.id,owner,key,publicRun(r))}};active.set(r.id,{owner,run:r});json(res,202,publicRun(r));execute(r,owner);return}
 let match=path.match(/^\/runs\/([\w-]+)(?:\/(pause|resume|stop))?$/);if(match){let row=ledger.job(match[1],owner);if(!row)return json(res,404,{error:'실행 기록이 없습니다.'});let r=active.get(row.id)?.run;if(req.method==='GET'&&!match[2])return json(res,200,r?publicRun(r):{...JSON.parse(row.snapshot),used:row.used,budget:row.budget});if(req.method==='POST'&&match[2]){if(!r)return json(res,409,{error:'종료된 실행입니다.'});if(match[2]==='stop'){r.internal.stop=true;r.internal.paused=false;r.status='중지 중';}else {r.internal.paused=match[2]==='pause';r.status=r.internal.paused?'일시정지':'실행 중'}return json(res,200,publicRun(r))}}
 json(res,404,{error:'NOT_FOUND'});
 }catch(e){let status=e.message==='INSUFFICIENT_CREDITS'?402:400;json(res,status,{error:e.message==='INSUFFICIENT_CREDITS'?'보유 크레딧이 사용 한도보다 적습니다.':e.message==='BODY_TOO_LARGE'?'요청이 너무 큽니다.':'요청 처리 실패. 입력 또는 운영 설정을 확인하세요.'})}});
async function execute(r,owner){let timer=setInterval(()=>ledger.snapshot(r.id,owner,publicRun(r)),3000);try{await explore(r)}catch{r.status='실패';}finally{clearInterval(timer);ledger.settle(r.id,owner,publicRun(r));active.delete(r.id)}}
server.listen(Number(env.PORT)||8787,env.HOST||'0.0.0.0',()=>console.log('TraceQA cloud service ready.'));
process.on('SIGTERM',()=>{for(let {run:r} of active.values())r.internal.stop=true;server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref()});

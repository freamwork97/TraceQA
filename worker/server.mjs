import http from 'node:http';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {explore} from './explorer.mjs';
import {validateTarget,signature,excludedAction,sameOrigin,normalizeUrl} from './core.mjs';
const token=process.env.TRACEQA_TOKEN,allowed=process.env.ALLOWED_ORIGIN,hosts=(process.env.TARGET_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(!token||token.length<24||!allowed||!hosts.length)throw Error('TRACEQA_TOKEN (24+ chars), ALLOWED_ORIGIN and TARGET_HOSTS are required.');
const runs=new Map(),ttl=(Number(process.env.RETENTION_HOURS)||24)*3600000;
const auth=req=>{let supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected)};
function publicRun(r){let {internal,...rest}=r;return rest}
function log(r,text,detail='',type='check'){r.logs.push({time:new Date().toLocaleTimeString('ko-KR'),text,detail,type});r.updatedAt=new Date().toISOString();}
function json(res,status,x){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(x));}
async function body(req){let text='';for await(let chunk of req){text+=chunk;if(text.length>16384)throw Error('요청이 너무 큽니다.')}return JSON.parse(text||'{}')}
http.createServer(async(req,res)=>{let origin=req.headers.origin;if(origin&&origin!==allowed){json(res,403,{error:'허용되지 않은 관리 화면 출처입니다.'});return}if(origin)res.setHeader('Access-Control-Allow-Origin',allowed);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}if(!auth(req)){json(res,401,{error:'접근 토큰을 확인하세요.'});return}let path=new URL(req.url,'http://worker').pathname;try{
 if(req.method==='GET'&&path==='/health')return json(res,200,{service:'traceqa-worker',version:'0.1.0',ai:!!process.env.OPENAI_API_KEY,mode:process.env.OPENAI_API_KEY?'AI + DOM':'DOM'});
 if(req.method==='POST'&&path==='/runs'){if([...runs.values()].some(r=>['실행 중','일시정지'].includes(r.status)))return json(res,409,{error:'동시에 하나의 테스트만 실행할 수 있습니다.'});let {url}=await body(req),u=await validateTarget(url,hosts);let r={id:randomUUID(),name:u.hostname,url:u.href,status:'실행 중',createdAt:new Date().toISOString(),pages:[],cases:[],features:[],defects:[],logs:[],pending:1,current:'브라우저 준비',internal:{stop:false,paused:false,created:Date.now()}};runs.set(r.id,r);json(res,202,publicRun(r));explore(r).catch(e=>{r.status='실패';log(r,'실행 실패',e.message,'bug')});return}
 let m=path.match(/^\/runs\/([\w-]+)(?:\/(pause|resume|stop))?$/);if(m){let r=runs.get(m[1]);if(!r)return json(res,404,{error:'실행 기록이 없거나 보관 시간이 지났습니다.'});if(req.method==='GET'&&!m[2])return json(res,200,publicRun(r));if(req.method==='POST'&&m[2]){if(!['실행 중','일시정지'].includes(r.status))return json(res,409,{error:'이미 종료된 실행입니다.'});if(m[2]==='stop'){r.internal.stop=true;r.internal.paused=false;r.status='중지 중';}else {r.internal.paused=m[2]==='pause';r.status=r.internal.paused?'일시정지':'실행 중'}return json(res,200,publicRun(r))}}
 json(res,404,{error:'존재하지 않는 API입니다.'});
 }catch(e){json(res,400,{error:e.message})}
}).listen(Number(process.env.PORT)||8787,process.env.HOST||'127.0.0.1',()=>console.log('TraceQA worker ready (authenticated API).'));
setInterval(()=>{for(let [id,r] of runs)if(!['실행 중','일시정지','중지 중'].includes(r.status)&&Date.now()-r.internal.created>ttl)runs.delete(id)},60000).unref();

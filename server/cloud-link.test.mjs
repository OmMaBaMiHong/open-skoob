import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApplication} from './app.mjs';
test('official account linking, template upload and disconnect enforce cloud ownership and credential isolation',async t=>{
  const calls=[],assets=[],codes=new Map();let expired=false,confirmAsset=true;
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const p of req)raw+=p;const b=raw?JSON.parse(raw):null;const path=req.url;const auth=req.headers.authorization;
    calls.push({path,auth,body:b,user:req.headers['x-skoob-user']});res.setHeader('Content-Type','application/json');
    const reply=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data))};
    if(path==='/api/v1/account/self-hosted/exchange'){if(codes.get(b.code)!==createHash('sha256').update(b.verifier).digest('hex'))return reply({error:'HANDOFF_EXPIRED'},401);codes.delete(b.code);return reply({token:'official-token',userId:'42'})}
    if(path==='/api/v1/account/verify-key')return b.apiKey==='official-token'?reply({ok:true,user:{id:42,username:'作者'}}):reply({error:'INVALID_KEY'},401);
    if(expired||auth!=='Bearer official-token'||req.headers['x-skoob-user']!=='42')return reply({error:'LOGIN_REQUIRED'},401);
    if(path==='/api/v1/account/status')return reply({loggedIn:true,user:{id:'42',username:'作者'},sub2apiUrl:'https://gaotk.com'});
    if(path==='/api/v1/account/membership')return reply({loggedIn:true,isMember:true,plan:'test-plan',entitlements:['world.simulate'],stale:false});
    if(path==='/api/v1/agent-templates'){if(confirmAsset)assets.push({assetId:'asset-'+(assets.length+1),id:b.id,title:b.name,creatorUserId:'42',visibility:'private'});return reply({template:b})}
    if(path==='/api/v1/capabilities/agent')return reply({capabilities:assets});
    if(path==='/api/v1/capabilities/asset-1/publish')return reply({ok:true,message:'待审核'});
    if(path==='/api/v1/tianyan/pipeline/initial')return reply({id:'cloud-task'});
    return reply({error:'NOT_FOUND'},404);
  });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  const baseUrl=`http://127.0.0.1:${upstream.address().port}`;const dir=mkdtempSync(join(tmpdir(),'skoob-link-'));
  const instance=createApplication({dataDir:dir,cloudEnv:{SKOOB_CLOUD_API_KEY:'env-token',SKOOB_CLOUD_URL:baseUrl}});t.after(async()=>{await instance.close();rmSync(dir,{recursive:true,force:true})});
  const login=async()=> (await instance.app.request('/api/v1/local/session',{method:'POST',headers:{'Content-Type':'application/json','X-Skoob-Local':'1'},body:JSON.stringify({})})).json();const auth=await login();
  const request=(path,method='GET',body,token=auth.token)=>instance.app.request('http://localhost/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Skoob-Local':'1',Authorization:`Bearer ${token}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=async(path,method,body)=>{const r=await request(path,method,body);const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b};
  assert.equal((await request('/local/cloud','PUT',{baseUrl,apiKey:'model-only-key'})).status,401);
  const flow=await json('/local/cloud/authorize','POST',{baseUrl});const url=new URL(flow.authorizeUrl);assert.equal(url.pathname,'/site/connect');assert.equal(url.searchParams.get('origin'),'http://localhost');assert.ok(!JSON.stringify(flow).includes('verifier'));
  const code=randomBytes(32).toString('base64url');codes.set(code,url.searchParams.get('challenge'));
  assert.equal((await request('/local/cloud/exchange','POST',{state:'wrong',code})).status,401);
  assert.equal((await request('/local/cloud/exchange','POST',{state:flow.state,code},(await login()).token)).status,401);
  await json('/local/cloud/exchange','POST',{state:flow.state,code});assert.equal((await json('/local/cloud')).method,'authorization');assert.equal((await request('/local/cloud/exchange','POST',{state:flow.state,code})).status,401);
  assert.equal((await json('/local/cloud/status')).membership.plan,'test-plan');
  await json('/agent-templates','POST',{id:'local-template',name:'侦探模板',content:'自己的角色设定'});
  const uploaded=await json('/local/cloud/templates/agent/local-template/upload','POST',{});assert.equal(uploaded.assetId,'asset-1');assert.equal(uploaded.visibility,'private');
  const received=calls.find(c=>c.path==='/api/v1/agent-templates');assert.equal(received.body.content,'自己的角色设定');assert.equal(received.auth,'Bearer official-token');assert.equal(received.user,'42');assert.ok(!calls.some(c=>c.auth===`Bearer ${auth.token}`));
  assert.equal((await request('/local/cloud/assets/agent')).status,403);assert.equal((await request('/local/cloud/assets/other/publish','POST',{})).status,403);await json('/local/cloud/assets/asset-1/publish','POST',{});
  assert.equal((await json('/tianyan/pipeline/initial','POST',{})).id,'cloud-task');
  confirmAsset=false;await json('/agent-templates','POST',{id:'not-saved',name:'未入库',content:'正文'});assert.equal((await request('/local/cloud/templates/agent/not-saved/upload','POST',{})).status,502);
  expired=true;assert.equal((await request('/local/cloud/status')).status,401);assert.equal((await request('/local/cloud/templates/agent/local-template/upload','POST',{})).status,401);expired=false;
  const pending=await json('/local/cloud/authorize','POST',{baseUrl});await json('/local/cloud','PUT',{baseUrl,apiKey:''});assert.equal((await json('/local/cloud')).configured,false);assert.equal((await request('/tianyan/pipeline/initial','POST',{})).status,503);assert.equal((await request('/local/cloud/exchange','POST',{state:pending.state,code})).status,401);
  assert.equal((await request('/local/cloud','PUT',{baseUrl:'https://another.example'})).status,400);assert.equal(instance.store.get('agentTemplates','local-template').content,'自己的角色设定');
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/, '');
const uuid='10000000-0000-4000-8000-000000000001';
function app(storage=new Map()){
  const nodes={};
  for(const id of [...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]))nodes[id]={value:'',textContent:'',disabled:false,classList:{toggle(){},add(){},remove(){}},addEventListener(){}};
  let resets=0,refreshes=0,call;
  nodes.company.value='Synthetic Company';nodes.contact.value='Test Contact';nodes.phone.value='5550000000';nodes.sector.value='Marina';nodes.saleType.value='Akaryakıt';nodes.city.value='İstanbul';nodes.district.value='Pendik';
  nodes.customerForm.reportValidity=()=>true;
  nodes.customerForm.reset=()=>{resets++;for(const id of ['company','contact','phone'])nodes[id].value=''};
  const ctx=vm.createContext({...nodes,document:{getElementById:id=>nodes[id]},window:{addEventListener(){}},crypto:{randomUUID:()=>uuid},AbortController,setTimeout,clearTimeout,console:{info(){}},localStorage:{getItem:()=>JSON.stringify({token:'secret'})},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  vm.runInContext(script,ctx);
  vm.runInContext("currentUser={id:'user1',role:'user'};renderDashboard=renderCustomers=renderUsers=()=>{};toggleOtherSector=loadDistricts=()=>{}",ctx);
  ctx.testRpc=(...args)=>call(...args);ctx.testRefresh=()=>{refreshes++};
  vm.runInContext('rpc=(...args)=>testRpc(...args);refreshData=()=>testRefresh()',ctx);
  return {ctx,nodes,storage,setRpc:f=>call=f,save:()=>ctx.saveCustomer({preventDefault(){}}),resets:()=>resets,refreshes:()=>refreshes,op:()=>vm.runInContext('customerOperation',ctx)};
}
test('confirmed save clears once, does not navigate, tolerates absent submitter',async()=>{
  const a=app();a.setRpc(async()=>uuid);await a.save();assert.equal(a.resets(),1);assert.equal(a.op(),null);assert.match(a.nodes.customerSaveStatus.textContent,/başarıyla/);assert.equal(a.nodes.customerSaveButton.disabled,false);
});
test('refresh failure cannot report a failed save or restore a resubmittable payload',async()=>{
  const a=app();a.setRpc(async()=>uuid);a.ctx.testRefresh=()=>{throw Error('refresh')};await a.save();assert.equal(a.resets(),1);assert.equal(a.op(),null);assert.match(a.nodes.customerSaveStatus.textContent,/başarıyla kaydedildi.*Liste yenilenemedi/);assert.equal(JSON.parse(a.storage.get('md_crm_save_events')).at(-1).operationId,uuid);
});
test('concurrent submissions dispatch one request and lock clear/edit/navigation',async()=>{
  const a=app();let resolve,count=0;a.setRpc(()=>{count++;return new Promise(r=>resolve=r)});const first=a.save();await a.save();assert.equal(count,1);assert.equal(a.nodes.customerFields.disabled,true);a.ctx.clearCustomerDraft();assert.equal(a.resets(),0);await a.ctx.go('dashboard');resolve(uuid);await first;assert.equal(a.resets(),1);
});
test('lost response preserves fields and operation; retry reuses exact ID/payload',async()=>{
  const a=app();const sent=[];a.setRpc(async(n,p)=>{sent.push(JSON.stringify(p));throw Error('lost response')});await a.save();assert.equal(a.resets(),0);assert.equal(a.nodes.company.value,'Synthetic Company');assert.equal(a.nodes.customerFields.disabled,true);assert.equal(a.nodes.customerSaveButton.disabled,false);a.setRpc(async(n,p)=>{sent.push(JSON.stringify(p));return uuid});await a.save();assert.equal(sent[0],sent[1]);assert.equal(a.resets(),1);
});
test('reload restores pending operation and draft before a safe replay',async()=>{
  const a=app();a.setRpc(async()=>{throw Error('timeout')});await a.save();const b=app(a.storage);b.ctx.restoreCustomerDraft();assert.equal(b.op().id,uuid);assert.equal(b.nodes.company.value,'Synthetic Company');assert.equal(b.nodes.customerClearButton.disabled,true);b.setRpc(async(n,p)=>{assert.equal(p.p_request_id,uuid);return uuid});await b.save();assert.equal(b.resets(),1);
});
test('invalid server acknowledgement does not clear or allow a fresh write',async()=>{
  for(const result of [null,{},[],true,'not-an-id']){const a=app();a.setRpc(async()=>result);await a.save();assert.equal(a.resets(),0);assert.ok(a.op());assert.match(a.nodes.customerSaveStatus.textContent,/doğrulanamadı/)}
});
test('storage failure prevents dispatch',async()=>{
  const a=app();let calls=0;a.ctx.sessionStorage.setItem=()=>{throw Error('quota')};a.setRpc(async()=>{calls++;return uuid});await a.save();assert.equal(calls,0);assert.equal(a.resets(),0);
});
test('failed local cleanup after confirmed commit retains retry identity',async()=>{
  const a=app();a.ctx.sessionStorage.removeItem=()=>{throw Error('blocked')};a.setRpc(async()=>uuid);await a.save();assert.equal(a.resets(),0);assert.equal(a.op().id,uuid);assert.match(a.nodes.customerSaveStatus.textContent,/kaydedildi/);
});
test('logs exclude customer payloads, raw errors and tokens; bounded to 100',async()=>{
  const a=app();a.setRpc(async()=>{throw Object.assign(Error('secret Synthetic Company'),{status:503})});for(let i=0;i<110;i++)await a.save();const events=a.storage.get('md_crm_save_events');assert.equal(JSON.parse(events).length,100);assert.doesNotMatch(events,/secret|Synthetic|5550000000|Test Contact/);
});
test('draft input storage is scoped to the current user and never stores tokens',()=>{
  const a=app();a.ctx.persistCustomerDraft();assert.match(a.storage.get('md_crm_customer_draft_user1'),/Synthetic Company/);assert.doesNotMatch(a.storage.get('md_crm_customer_draft_user1'),/secret/);
});
test('RPC transport handles HTTP failure, JSON errors and aborts without discarding the timeout',async()=>{
  const a=app();vm.runInContext(script.slice(script.indexOf('async function rpc('),script.indexOf('\nasync function boot')),a.ctx);
  a.ctx.fetch=async()=>({ok:false,status:503,text:async()=>'{"message":"gateway"}'});
  await assert.rejects(a.ctx.rpc('test',{}),e=>e.status===503);
  a.ctx.fetch=async()=>({ok:true,text:async()=>'{broken'});await assert.rejects(a.ctx.rpc('test',{}));
  a.ctx.fetch=async(url,options)=>{assert.ok(options.signal);throw Object.assign(Error('timeout'),{name:'AbortError'})};await assert.rejects(a.ctx.rpc('test',{}),e=>e.name==='AbortError');
});
test('whitespace-only mandatory fields do not allocate or dispatch an operation',async()=>{
  const a=app();a.nodes.company.value='   ';let calls=0;a.setRpc(async()=>{calls++;return uuid});await a.save();assert.equal(calls,0);assert.equal(a.op(),null);assert.equal(a.resets(),0);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const request='10000000-0000-4000-8000-000000000001';
const token='20000000-0000-4000-8000-000000000001';
const token2='20000000-0000-4000-8000-000000000002';
const data={company:'Synthetic Company',contact:'Test',phone:'555',sector:'Marina',sale_type:'Akaryakıt',city:'İstanbul',district:'Pendik'};
test('database receipt is atomic, authenticated, private and idempotent',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated;
      create table public.crm_customers(id uuid primary key default gen_random_uuid(),company text,created_by uuid);
      create function public.crm_valid_user(p_token uuid) returns table(user_id uuid) language sql as $$
        select p_token where p_token in ('${token}'::uuid,'${token2}'::uuid)
      $$;
      create function public.crm_add_customer(p_token uuid,p_company text,p_contact text,p_phone text,p_email text,p_taxno text,p_sector text,p_sale_type text,p_city text,p_district text,p_address text,p_note text)
      returns uuid language plpgsql as $$ declare v_id uuid; begin
        insert into public.crm_customers(company,created_by) values(p_company,p_token) returning id into v_id;return v_id;
      end $$;
    `);
    await db.exec(fs.readFileSync('db/customer-save.sql','utf8'));
    const save=(id=request,payload=data,who=token)=>db.query('select public.crm_save_customer($1::uuid,$2::uuid,$3::jsonb) id',[who,id,JSON.stringify(payload)]);
    let id;
    await t.test('anon transport role uses CRM token; no direct table access',async()=>{
      await db.exec('set role anon');id=(await save()).rows[0].id;assert.ok(id);
      await assert.rejects(db.query('select * from crm_private.customer_save_requests'),/permission denied/);
      await db.exec('reset role');
    });
    await t.test('same operation replays the same customer',async()=>{
      assert.equal((await save()).rows[0].id,id);
      assert.equal((await db.query('select count(*)::int n from public.crm_customers')).rows[0].n,1);
    });
    await t.test('same ID with changed payload or different user is rejected',async()=>{
      await assert.rejects(save(request,{...data,company:'Changed'}),/kimliği/);
      await assert.rejects(save(request,data,token2),/kimliği/);
    });
    await t.test('invalid or expired session cannot insert or retrieve receipt',async()=>{
      await assert.rejects(save(request,data,null),/Yetkisiz/);
      await assert.rejects(save(request,data,'90000000-0000-4000-8000-000000000001'),/Yetkisiz/);
    });
    await t.test('validation failures create neither receipt nor customer',async()=>{
      await assert.rejects(save('10000000-0000-4000-8000-000000000002',{...data,company:''}),/eksik/);
      assert.equal((await db.query('select count(*)::int n from crm_private.customer_save_requests')).rows[0].n,1);
    });
    await t.test('receipt failure rolls back customer insert in same transaction',async()=>{
      await db.exec("create function crm_private.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure'; end$$; create trigger fail_receipt before insert on crm_private.customer_save_requests for each row execute function crm_private.fail_receipt()");
      await assert.rejects(save('10000000-0000-4000-8000-000000000003'),/synthetic receipt failure/);
      assert.equal((await db.query('select count(*)::int n from public.crm_customers')).rows[0].n,1);
      await db.exec('drop trigger fail_receipt on crm_private.customer_save_requests');
    });
    await t.test('receipt stores correlation metadata, not customer payload or token',async()=>{
      const row=(await db.query('select * from crm_private.customer_save_requests')).rows[0];
      assert.equal(row.customer_id,id);assert.equal(row.payload_hash.length,64);
      assert.doesNotMatch(JSON.stringify(row),/Synthetic|555|p_token|Test/);
    });
    await t.test('script reapplies without modifying customers',async()=>{
      await db.exec(fs.readFileSync('db/customer-save.sql','utf8'));
      assert.equal((await save()).rows[0].id,id);
      assert.equal((await db.query('select count(*)::int n from public.crm_customers')).rows[0].n,1);
    });
  }finally{await db.close()}
});

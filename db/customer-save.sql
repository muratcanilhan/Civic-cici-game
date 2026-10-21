-- Apply once before deploying the updated index.html, using the database owner.
-- Adds objects only. Does not modify or delete existing customers or the legacy RPC.
begin;
create schema if not exists crm_private;
revoke all on schema crm_private from public;
create table if not exists crm_private.customer_save_requests (
  request_id uuid primary key,
  user_id uuid not null,
  payload_hash text not null,
  customer_id uuid not null,
  created_at timestamptz not null default now()
);
alter table crm_private.customer_save_requests enable row level security;
revoke all on crm_private.customer_save_requests from public, anon, authenticated;

-- Custom CRM sessions (not Supabase Auth) require the existing crm_valid_user check.
-- The privileged implementation stays outside the Data API's public schema.
create or replace function crm_private.save_customer(p_token uuid, p_request_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_hash text;
  v_previous crm_private.customer_save_requests%rowtype;
  v_id uuid;
begin
  select user_id into v_uid from public.crm_valid_user(p_token) limit 1;
  if v_uid is null then raise exception 'Yetkisiz' using errcode='28000'; end if;
  if p_request_id is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Geçersiz kayıt isteği' using errcode='22023';
  end if;
  v_hash := encode(sha256(convert_to(p_data::text, 'UTF8')), 'hex');
  -- Concurrent retries serialize, including a retry arriving before the first commit.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_previous from crm_private.customer_save_requests where request_id=p_request_id;
  if found then
    if v_previous.user_id <> v_uid or v_previous.payload_hash <> v_hash then
      raise exception 'İşlem kimliği farklı bir kayıt için kullanılmış' using errcode='22023';
    end if;
    return v_previous.customer_id;
  end if;
  if exists (select 1 from unnest(array['company','contact','phone','sector','sale_type','city','district']) k
             where nullif(btrim(p_data->>k), '') is null) then
    raise exception 'Zorunlu müşteri bilgileri eksik' using errcode='22023';
  end if;
  v_id := public.crm_add_customer(p_token,p_data->>'company',p_data->>'contact',p_data->>'phone',
    p_data->>'email',p_data->>'taxno',p_data->>'sector',p_data->>'sale_type',p_data->>'city',
    p_data->>'district',p_data->>'address',p_data->>'note');
  if v_id is null or not exists (select 1 from public.crm_customers where id=v_id and created_by=v_uid) then
    raise exception 'Müşteri kaydı doğrulanamadı';
  end if;
  -- Receipt and customer commit in the SAME transaction. Contains no customer payload/token.
  insert into crm_private.customer_save_requests(request_id,user_id,payload_hash,customer_id)
  values(p_request_id,v_uid,v_hash,v_id);
  return v_id;
end;
$$;
revoke all on function crm_private.save_customer(uuid,uuid,jsonb) from public;
grant usage on schema crm_private to anon, authenticated;
grant execute on function crm_private.save_customer(uuid,uuid,jsonb) to anon, authenticated;

create or replace function public.crm_save_customer(p_token uuid,p_request_id uuid,p_data jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select crm_private.save_customer(p_token,p_request_id,p_data);
$$;
revoke all on function public.crm_save_customer(uuid,uuid,jsonb) from public;
grant execute on function public.crm_save_customer(uuid,uuid,jsonb) to anon, authenticated;
commit;

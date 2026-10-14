-- Mercado Pago marketplace, no mesmo modelo do Wagoo:
-- a loja conecta a conta dela (OAuth) e é a vendedora.
-- application_fee de 1% fica com a conta dona da aplicação Shopwag.
-- Tokens ficam cifrados e sem policy para anon/authenticated.

alter table public.lojas
  add column mp_status text,
  add constraint lojas_mp_status_check
    check (mp_status is null or mp_status in ('connected', 'needs_reconnect', 'revoked'));

alter table public.pedidos
  add column mp_payment_id text,
  add column taxa_plataforma_centavos integer not null default 0,
  add column email_pagador text,
  add column pix_copia_cola text,
  add column pix_qr_base64 text,
  add column pix_expira_em timestamptz,
  add constraint pedidos_taxa_plataforma_check check (taxa_plataforma_centavos >= 0);

create unique index pedidos_mp_payment_idx
  on public.pedidos (mp_payment_id)
  where mp_payment_id is not null;

create table public.loja_mp_contas (
  loja_id uuid primary key references public.lojas (id) on delete cascade,
  mp_user_id text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  public_key text not null,
  live_mode boolean not null default true,
  token_expires_at timestamptz not null,
  status text not null default 'connected',
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint loja_mp_contas_status_check check (status in ('connected', 'needs_reconnect', 'revoked'))
);

create index loja_mp_contas_user_idx on public.loja_mp_contas (mp_user_id);

create table public.mp_oauth_states (
  state text primary key,
  loja_id uuid not null references public.lojas (id) on delete cascade,
  expira_em timestamptz not null
);

alter table public.loja_mp_contas enable row level security;
alter table public.mp_oauth_states enable row level security;

revoke all on public.loja_mp_contas from anon, authenticated;
revoke all on public.mp_oauth_states from anon, authenticated;

create or replace function private.keep_mp_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    new.mp_status := old.mp_status;
  end if;
  return new;
end;
$$;

create trigger lojas_keep_mp_status
  before update on public.lojas
  for each row
  execute function private.keep_mp_status();

revoke all on function private.keep_mp_status() from public, anon, authenticated;

create or replace function private.get_order_receipt(
  p_pedido_id uuid,
  p_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_loja public.lojas%rowtype;
  v_itens jsonb;
begin
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
    and token_publico = p_token;

  if not found then
    return null;
  end if;

  select * into v_loja
  from public.lojas
  where id = v_pedido.loja_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nome_produto', nome_produto,
        'variacao_label', variacao_label,
        'quantidade', quantidade,
        'preco_unitario_centavos', preco_unitario_centavos,
        'total_item_centavos', total_item_centavos
      )
      order by id
    ),
    '[]'::jsonb
  )
  into v_itens
  from public.itens_pedido
  where pedido_id = v_pedido.id;

  return jsonb_build_object(
    'id', v_pedido.id,
    'status_pagamento', v_pedido.status_pagamento,
    'status_pedido', v_pedido.status_pedido,
    'metodo_pagamento', v_pedido.metodo_pagamento,
    'subtotal_centavos', v_pedido.subtotal_centavos,
    'frete_centavos', v_pedido.frete_centavos,
    'total_centavos', v_pedido.total_centavos,
    'taxa_plataforma_centavos', v_pedido.taxa_plataforma_centavos,
    'nome_completo', v_pedido.nome_completo,
    'whatsapp', v_pedido.whatsapp,
    'observacoes', v_pedido.observacoes,
    'criado_em', v_pedido.criado_em,
    'pix_copia_cola', v_pedido.pix_copia_cola,
    'pix_qr_base64', v_pedido.pix_qr_base64,
    'endereco', jsonb_build_object(
      'cep', v_pedido.cep,
      'rua', v_pedido.rua,
      'numero', v_pedido.numero,
      'complemento', v_pedido.complemento,
      'bairro', v_pedido.bairro,
      'cidade', v_pedido.cidade,
      'estado', v_pedido.estado
    ),
    'loja', jsonb_build_object(
      'nome', v_loja.nome,
      'slug', v_loja.slug,
      'whatsapp', v_loja.whatsapp,
      'mp_status', v_loja.mp_status
    ),
    'itens', v_itens
  );
end;
$$;

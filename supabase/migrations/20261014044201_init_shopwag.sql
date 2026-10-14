-- Shopwag: catálogo, checkout e painel do lojista.
-- Preço, estoque e total do pedido são calculados aqui. O cliente não envia valor.

create schema if not exists private;

create or replace function public.touch_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create table public.lojas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  slug text not null,
  descricao text not null default '',
  whatsapp text,
  chave_pix text,
  logo_url text,
  capa_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint lojas_owner_id_key unique (owner_id),
  constraint lojas_slug_key unique (slug),
  constraint lojas_slug_formato check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint lojas_nome_tamanho check (char_length(trim(nome)) between 2 and 80)
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  nome text not null,
  slug text not null,
  descricao text not null default '',
  preco_centavos integer not null,
  preco_de_centavos integer,
  categoria text not null default 'Geral',
  ativo boolean not null default true,
  destaque boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint produtos_loja_slug_key unique (loja_id, slug),
  constraint produtos_slug_formato check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint produtos_preco_positivo check (preco_centavos >= 0),
  constraint produtos_preco_de_positivo check (preco_de_centavos is null or preco_de_centavos >= 0),
  constraint produtos_nome_tamanho check (char_length(trim(nome)) between 2 and 120)
);

create table public.produto_imagens (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  url text not null,
  alt text not null default '',
  ordem integer not null default 0,
  constraint produto_imagens_url check (char_length(url) between 8 and 2000),
  constraint produto_imagens_ordem check (ordem >= 0)
);

create table public.produto_variacoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  cor text,
  cor_hex text,
  tamanho text,
  sku text,
  estoque integer not null default 0,
  preco_centavos integer,
  ativo boolean not null default true,
  constraint produto_variacoes_estoque check (estoque >= 0),
  constraint produto_variacoes_preco check (preco_centavos is null or preco_centavos >= 0),
  constraint produto_variacoes_hex check (cor_hex is null or cor_hex ~ '^#[0-9A-Fa-f]{6}$')
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  nome_completo text not null,
  whatsapp text not null,
  criado_em timestamptz not null default now(),
  constraint clientes_loja_whatsapp_key unique (loja_id, whatsapp),
  constraint clientes_whatsapp_digitos check (whatsapp ~ '^\d{10,13}$')
);

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  status_pagamento text not null default 'pending',
  status_pedido text not null default 'new',
  metodo_pagamento text not null default 'pix',
  subtotal_centavos integer not null default 0,
  frete_centavos integer not null default 0,
  total_centavos integer not null default 0,
  nome_completo text not null,
  whatsapp text not null,
  cep text not null,
  rua text not null,
  numero text not null,
  complemento text not null default '',
  bairro text not null,
  cidade text not null,
  estado text not null,
  observacoes text not null default '',
  token_publico uuid not null default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pedidos_token_key unique (token_publico),
  constraint pedidos_status_pagamento check (status_pagamento in ('pending', 'paid', 'failed', 'refunded')),
  constraint pedidos_status_pedido check (status_pedido in ('new', 'preparing', 'shipped', 'delivered', 'cancelled')),
  constraint pedidos_metodo check (metodo_pagamento in ('pix')),
  constraint pedidos_valores check (
    subtotal_centavos >= 0
    and frete_centavos >= 0
    and total_centavos = subtotal_centavos + frete_centavos
  ),
  constraint pedidos_estado check (estado ~ '^[A-Z]{2}$'),
  constraint pedidos_cep check (cep ~ '^\d{8}$')
);

create table public.itens_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  produto_id uuid references public.produtos (id) on delete set null,
  variacao_id uuid references public.produto_variacoes (id) on delete set null,
  nome_produto text not null,
  variacao_label text,
  quantidade integer not null,
  preco_unitario_centavos integer not null,
  total_item_centavos integer not null,
  constraint itens_quantidade check (quantidade between 1 and 20),
  constraint itens_preco check (preco_unitario_centavos >= 0),
  constraint itens_total check (total_item_centavos = preco_unitario_centavos * quantidade)
);

create index produtos_loja_idx on public.produtos (loja_id);
create index produto_imagens_produto_idx on public.produto_imagens (produto_id, ordem);
create index produto_variacoes_produto_idx on public.produto_variacoes (produto_id);
create index clientes_loja_idx on public.clientes (loja_id);
create index pedidos_loja_criado_idx on public.pedidos (loja_id, criado_em desc);
create index pedidos_cliente_idx on public.pedidos (cliente_id);
create index itens_pedido_pedido_idx on public.itens_pedido (pedido_id);

create trigger lojas_touch
before update on public.lojas
for each row execute function public.touch_atualizado_em();

create trigger produtos_touch
before update on public.produtos
for each row execute function public.touch_atualizado_em();

create trigger pedidos_touch
before update on public.pedidos
for each row execute function public.touch_atualizado_em();

alter table public.lojas enable row level security;
alter table public.produtos enable row level security;
alter table public.produto_imagens enable row level security;
alter table public.produto_variacoes enable row level security;
alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.itens_pedido enable row level security;

create or replace function private.loja_do_usuario(p_loja_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lojas
    where id = p_loja_id
      and owner_id = auth.uid()
  );
$$;

create policy "lojas visiveis no catalogo"
on public.lojas
for select
to anon, authenticated
using (true);

create policy "lojista cria a propria loja"
on public.lojas
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "lojista atualiza a propria loja"
on public.lojas
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "catalogo publico de produtos ativos"
on public.produtos
for select
to anon, authenticated
using (ativo = true);

create policy "lojista le os proprios produtos"
on public.produtos
for select
to authenticated
using (private.loja_do_usuario(loja_id));

create policy "lojista cria produtos"
on public.produtos
for insert
to authenticated
with check (private.loja_do_usuario(loja_id));

create policy "lojista atualiza produtos"
on public.produtos
for update
to authenticated
using (private.loja_do_usuario(loja_id))
with check (private.loja_do_usuario(loja_id));

create policy "lojista remove produtos"
on public.produtos
for delete
to authenticated
using (private.loja_do_usuario(loja_id));

create policy "imagens de produtos ativos"
on public.produto_imagens
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.produtos
    where id = produto_id
      and ativo = true
  )
);

create policy "lojista le imagens"
on public.produto_imagens
for select
to authenticated
using (
  exists (
    select 1
    from public.produtos
    where id = produto_id
      and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista cria imagens"
on public.produto_imagens
for insert
to authenticated
with check (
  exists (
    select 1
    from public.produtos
    where id = produto_id
      and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista atualiza imagens"
on public.produto_imagens
for update
to authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
)
with check (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista remove imagens"
on public.produto_imagens
for delete
to authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "variacoes de produtos ativos"
on public.produto_variacoes
for select
to anon, authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and ativo = true
  )
);

create policy "lojista le variacoes"
on public.produto_variacoes
for select
to authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista cria variacoes"
on public.produto_variacoes
for insert
to authenticated
with check (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista atualiza variacoes"
on public.produto_variacoes
for update
to authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
)
with check (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista remove variacoes"
on public.produto_variacoes
for delete
to authenticated
using (
  exists (
    select 1 from public.produtos
    where id = produto_id and private.loja_do_usuario(loja_id)
  )
);

create policy "lojista le clientes"
on public.clientes
for select
to authenticated
using (private.loja_do_usuario(loja_id));

create policy "lojista le pedidos"
on public.pedidos
for select
to authenticated
using (private.loja_do_usuario(loja_id));

create policy "lojista le itens"
on public.itens_pedido
for select
to authenticated
using (
  exists (
    select 1
    from public.pedidos
    where id = pedido_id
      and private.loja_do_usuario(loja_id)
  )
);

-- Checkout e mudança de status passam por funções. Não há policy de insert/update
-- em pedidos, itens ou clientes para o papel anon.

create or replace function private.place_order(
  p_loja_slug text,
  p_nome text,
  p_whatsapp text,
  p_cep text,
  p_rua text,
  p_numero text,
  p_complemento text,
  p_bairro text,
  p_cidade text,
  p_estado text,
  p_observacoes text,
  p_itens jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja_id uuid;
  v_nome text;
  v_whatsapp text;
  v_cep text;
  v_rua text;
  v_numero text;
  v_complemento text;
  v_bairro text;
  v_cidade text;
  v_estado text;
  v_obs text;
  v_cliente_id uuid;
  v_pedido_id uuid;
  v_token uuid;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_unit integer;
  v_line integer;
  v_subtotal integer := 0;
  v_label text;
  v_has_variants boolean;
  v_product public.produtos%rowtype;
  v_variant public.produto_variacoes%rowtype;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  if jsonb_array_length(p_itens) > 30 then
    raise exception 'Limite de itens excedido';
  end if;

  select id into v_loja_id
  from public.lojas
  where slug = trim(p_loja_slug);

  if v_loja_id is null then
    raise exception 'Loja não encontrada';
  end if;

  v_nome := trim(p_nome);
  v_whatsapp := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_cep := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  v_rua := trim(coalesce(p_rua, ''));
  v_numero := trim(coalesce(p_numero, ''));
  v_complemento := trim(coalesce(p_complemento, ''));
  v_bairro := trim(coalesce(p_bairro, ''));
  v_cidade := trim(coalesce(p_cidade, ''));
  v_estado := upper(trim(coalesce(p_estado, '')));
  v_obs := trim(coalesce(p_observacoes, ''));

  if char_length(v_nome) < 3 or char_length(v_nome) > 120 then
    raise exception 'Nome inválido';
  end if;
  if v_whatsapp !~ '^\d{10,13}$' then
    raise exception 'WhatsApp inválido';
  end if;
  if v_cep !~ '^\d{8}$' then
    raise exception 'CEP inválido';
  end if;
  if char_length(v_rua) < 2 or char_length(v_rua) > 140 then
    raise exception 'Rua inválida';
  end if;
  if char_length(v_numero) < 1 or char_length(v_numero) > 20 then
    raise exception 'Número inválido';
  end if;
  if char_length(v_complemento) > 80 then
    raise exception 'Complemento muito longo';
  end if;
  if char_length(v_bairro) < 2 or char_length(v_bairro) > 80 then
    raise exception 'Bairro inválido';
  end if;
  if char_length(v_cidade) < 2 or char_length(v_cidade) > 80 then
    raise exception 'Cidade inválida';
  end if;
  if v_estado !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida';
  end if;
  if char_length(v_obs) > 400 then
    raise exception 'Observação muito longa';
  end if;

  insert into public.clientes (loja_id, nome_completo, whatsapp)
  values (v_loja_id, v_nome, v_whatsapp)
  on conflict (loja_id, whatsapp)
  do update set nome_completo = excluded.nome_completo
  returning id into v_cliente_id;

  insert into public.pedidos (
    loja_id,
    cliente_id,
    nome_completo,
    whatsapp,
    cep,
    rua,
    numero,
    complemento,
    bairro,
    cidade,
    estado,
    observacoes
  )
  values (
    v_loja_id,
    v_cliente_id,
    v_nome,
    v_whatsapp,
    v_cep,
    v_rua,
    v_numero,
    v_complemento,
    v_bairro,
    v_cidade,
    v_estado,
    v_obs
  )
  returning id, token_publico into v_pedido_id, v_token;

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido';
    end if;
    if coalesce(v_item->>'quantity', '') !~ '^\d+$' then
      raise exception 'Quantidade inválida';
    end if;

    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_variant_id := null;

    if nullif(v_item->>'variant_id', '') is not null then
      if (v_item->>'variant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Variação inválida';
      end if;
      v_variant_id := (v_item->>'variant_id')::uuid;
    end if;

    if v_qty < 1 or v_qty > 20 then
      raise exception 'Quantidade inválida';
    end if;

    select * into v_product
    from public.produtos
    where id = v_product_id
      and loja_id = v_loja_id
      and ativo = true
    for update;

    if not found then
      raise exception 'Produto indisponível';
    end if;

    select exists (
      select 1
      from public.produto_variacoes
      where produto_id = v_product.id
        and ativo = true
    ) into v_has_variants;

    v_unit := v_product.preco_centavos;
    v_label := null;

    if v_has_variants then
      if v_variant_id is null then
        raise exception 'Selecione uma variação de %', v_product.nome;
      end if;

      select * into v_variant
      from public.produto_variacoes
      where id = v_variant_id
        and produto_id = v_product.id
        and ativo = true
      for update;

      if not found then
        raise exception 'Variação indisponível';
      end if;

      update public.produto_variacoes
      set estoque = estoque - v_qty
      where id = v_variant.id
        and estoque >= v_qty;

      if not found then
        raise exception 'Estoque insuficiente para %', v_product.nome;
      end if;

      v_unit := coalesce(v_variant.preco_centavos, v_product.preco_centavos);
      v_label := nullif(concat_ws(' / ', nullif(v_variant.cor, ''), nullif(v_variant.tamanho, '')), '');
    end if;

    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    insert into public.itens_pedido (
      pedido_id,
      produto_id,
      variacao_id,
      nome_produto,
      variacao_label,
      quantidade,
      preco_unitario_centavos,
      total_item_centavos
    )
    values (
      v_pedido_id,
      v_product.id,
      case when v_has_variants then v_variant_id else null end,
      v_product.nome,
      v_label,
      v_qty,
      v_unit,
      v_line
    );
  end loop;

  update public.pedidos
  set subtotal_centavos = v_subtotal,
      frete_centavos = 0,
      total_centavos = v_subtotal
  where id = v_pedido_id;

  return jsonb_build_object(
    'pedido_id', v_pedido_id,
    'token', v_token,
    'total_centavos', v_subtotal,
    'status_pagamento', 'pending'
  );
end;
$$;

create or replace function public.place_order(
  p_loja_slug text,
  p_nome text,
  p_whatsapp text,
  p_cep text,
  p_rua text,
  p_numero text,
  p_complemento text,
  p_bairro text,
  p_cidade text,
  p_estado text,
  p_observacoes text,
  p_itens jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.place_order(
    p_loja_slug,
    p_nome,
    p_whatsapp,
    p_cep,
    p_rua,
    p_numero,
    p_complemento,
    p_bairro,
    p_cidade,
    p_estado,
    p_observacoes,
    p_itens
  );
$$;

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
    'nome_completo', v_pedido.nome_completo,
    'whatsapp', v_pedido.whatsapp,
    'observacoes', v_pedido.observacoes,
    'criado_em', v_pedido.criado_em,
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
      'chave_pix', v_loja.chave_pix
    ),
    'itens', v_itens
  );
end;
$$;

create or replace function public.get_order_receipt(
  p_pedido_id uuid,
  p_token uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_order_receipt(p_pedido_id, p_token);
$$;

create or replace function private.update_order_status(
  p_pedido_id uuid,
  p_status_pagamento text,
  p_status_pedido text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja_id uuid;
  v_status_atual text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if p_status_pagamento not in ('pending', 'paid', 'failed', 'refunded') then
    raise exception 'Status de pagamento inválido';
  end if;

  if p_status_pedido not in ('new', 'preparing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Status do pedido inválido';
  end if;

  select loja_id, status_pedido
  into v_loja_id, v_status_atual
  from public.pedidos
  where id = p_pedido_id;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if not private.loja_do_usuario(v_loja_id) then
    raise exception 'Sem permissão';
  end if;

  if p_status_pedido = 'cancelled' and v_status_atual is distinct from 'cancelled' then
    update public.produto_variacoes as variacao
    set estoque = variacao.estoque + item.quantidade
    from public.itens_pedido as item
    where item.pedido_id = p_pedido_id
      and item.variacao_id = variacao.id;
  end if;

  update public.pedidos
  set status_pagamento = p_status_pagamento,
      status_pedido = p_status_pedido
  where id = p_pedido_id;
end;
$$;

create or replace function public.update_order_status(
  p_pedido_id uuid,
  p_status_pagamento text,
  p_status_pedido text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.update_order_status(p_pedido_id, p_status_pagamento, p_status_pedido);
end;
$$;

grant execute on function public.touch_atualizado_em() to anon, authenticated;
revoke all on function private.loja_do_usuario(uuid) from public;
revoke all on function private.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function private.get_order_receipt(uuid, uuid) from public;
revoke all on function private.update_order_status(uuid, text, text) from public;
revoke all on function public.update_order_status(uuid, text, text) from public;

grant usage on schema private to anon, authenticated;
grant execute on function private.loja_do_usuario(uuid) to authenticated;
grant execute on function private.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function private.get_order_receipt(uuid, uuid) to anon, authenticated;
grant execute on function private.update_order_status(uuid, text, text) to authenticated;
grant execute on function public.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_order_receipt(uuid, uuid) to anon, authenticated;
grant execute on function public.update_order_status(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('produto-imagens', 'produto-imagens', true)
on conflict (id) do nothing;

create policy "leitura publica das imagens"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'produto-imagens');

create policy "lojista envia imagens"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'produto-imagens'
  and (storage.foldername(name))[1] in (
    select id::text from public.lojas where owner_id = auth.uid()
  )
);

create policy "lojista substitui imagens"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'produto-imagens'
  and (storage.foldername(name))[1] in (
    select id::text from public.lojas where owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'produto-imagens'
  and (storage.foldername(name))[1] in (
    select id::text from public.lojas where owner_id = auth.uid()
  )
);

grant select on public.lojas, public.produtos, public.produto_imagens, public.produto_variacoes to anon, authenticated;
grant insert, update, delete on public.lojas, public.produtos, public.produto_imagens, public.produto_variacoes to authenticated;
grant select on public.clientes, public.pedidos, public.itens_pedido to authenticated;

create policy "lojista remove imagens do storage"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'produto-imagens'
  and (storage.foldername(name))[1] in (
    select id::text from public.lojas where owner_id = auth.uid()
  )
);

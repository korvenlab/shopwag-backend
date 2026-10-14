-- Recursos de vitrine e checkout: banners, rodapé, horário, frete, atacado,
-- "avise-me quando chegar", mais vendidos, SEO e domínio próprio.

alter table public.lojas
  add column aviso_topo text,
  add column favicon_url text,
  add column banners jsonb not null default '[]'::jsonb,
  add column email_contato text,
  add column site_url text,
  add column instagram text,
  add column facebook text,
  add column tiktok text,
  add column youtube text,
  add column endereco_loja text,
  add column documento text,
  add column politica_troca text,
  add column politica_privacidade text,
  add column termos_uso text,
  add column horario_ativo boolean not null default false,
  add column horarios jsonb not null default '{}'::jsonb,
  add column pedidos_fora_horario boolean not null default true,
  add column fechada boolean not null default false,
  add column mensagem_fechada text,
  add column esconder_esgotados boolean not null default true,
  add column entrega_ativa boolean not null default true,
  add column frete_padrao_centavos integer default 0,
  add column frete_gratis_acima_centavos integer,
  add column prazo_padrao text,
  add column retirada_ativa boolean not null default false,
  add column retirada_endereco text,
  add column seo_titulo text,
  add column seo_descricao text,
  add column seo_indexar boolean not null default true,
  add column dominio text,
  add constraint lojas_aviso_topo_tamanho check (aviso_topo is null or char_length(aviso_topo) <= 160),
  add constraint lojas_banners_lista check (jsonb_typeof(banners) = 'array' and jsonb_array_length(banners) <= 7),
  add constraint lojas_horarios_objeto check (jsonb_typeof(horarios) = 'object'),
  add constraint lojas_frete_padrao check (frete_padrao_centavos is null or frete_padrao_centavos >= 0),
  add constraint lojas_frete_gratis check (frete_gratis_acima_centavos is null or frete_gratis_acima_centavos >= 0),
  add constraint lojas_entrega_ou_retirada check (entrega_ativa or retirada_ativa),
  add constraint lojas_seo_titulo_tamanho check (seo_titulo is null or char_length(seo_titulo) <= 70),
  add constraint lojas_seo_descricao_tamanho check (seo_descricao is null or char_length(seo_descricao) <= 160),
  add constraint lojas_politicas_tamanho check (
    coalesce(char_length(politica_troca), 0) <= 5000
    and coalesce(char_length(politica_privacidade), 0) <= 5000
    and coalesce(char_length(termos_uso), 0) <= 5000
  ),
  add constraint lojas_dominio_formato check (
    dominio is null or dominio ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
  );

create unique index lojas_dominio_key on public.lojas (dominio) where dominio is not null;

-- Faixas de CEP com preço próprio. A faixa mais estreita que contém o CEP vence.
create table public.loja_fretes (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  nome text not null,
  cep_inicio text not null,
  cep_fim text not null,
  valor_centavos integer not null,
  prazo text,
  constraint loja_fretes_nome check (char_length(trim(nome)) between 2 and 60),
  constraint loja_fretes_ceps check (cep_inicio ~ '^\d{8}$' and cep_fim ~ '^\d{8}$' and cep_inicio <= cep_fim),
  constraint loja_fretes_valor check (valor_centavos >= 0)
);

create index loja_fretes_loja_idx on public.loja_fretes (loja_id);
alter table public.loja_fretes enable row level security;

create policy "fretes publicos" on public.loja_fretes for select to anon, authenticated using (true);
create policy "lojista cria fretes" on public.loja_fretes for insert to authenticated
  with check (private.loja_do_usuario(loja_id));
create policy "lojista atualiza fretes" on public.loja_fretes for update to authenticated
  using (private.loja_do_usuario(loja_id)) with check (private.loja_do_usuario(loja_id));
create policy "lojista remove fretes" on public.loja_fretes for delete to authenticated
  using (private.loja_do_usuario(loja_id));

grant select on public.loja_fretes to anon, authenticated;
grant insert, update, delete on public.loja_fretes to authenticated;

-- Atacado: lista de {"min": quantidade, "preco": centavos}, aplicada pela quantidade total do produto.
alter table public.produtos
  add column atacado jsonb not null default '[]'::jsonb,
  add constraint produtos_atacado_lista check (jsonb_typeof(atacado) = 'array' and jsonb_array_length(atacado) <= 5);

alter table public.itens_pedido drop constraint itens_quantidade;
alter table public.itens_pedido add constraint itens_quantidade check (quantidade between 1 and 999);

alter table public.pedidos
  add column tipo_entrega text not null default 'entrega',
  add constraint pedidos_tipo_entrega check (tipo_entrega in ('entrega', 'retirada'));

alter table public.pedidos drop constraint pedidos_cep;
alter table public.pedidos drop constraint pedidos_estado;
alter table public.pedidos
  add constraint pedidos_cep check (cep ~ '^\d{8}$' or (tipo_entrega = 'retirada' and cep = '')),
  add constraint pedidos_estado check (estado ~ '^[A-Z]{2}$' or (tipo_entrega = 'retirada' and estado = ''));

-- Interessados em produtos esgotados.
create table public.interessados (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  produto_id uuid not null references public.produtos (id) on delete cascade,
  nome text not null,
  whatsapp text not null,
  criado_em timestamptz not null default now(),
  avisado_em timestamptz,
  constraint interessados_nome check (char_length(trim(nome)) between 2 and 80),
  constraint interessados_whatsapp check (whatsapp ~ '^\d{10,13}$'),
  constraint interessados_unico unique (produto_id, whatsapp)
);

create index interessados_loja_idx on public.interessados (loja_id, criado_em desc);
alter table public.interessados enable row level security;

create policy "lojista le interessados" on public.interessados for select to authenticated
  using (private.loja_do_usuario(loja_id));
create policy "lojista atualiza interessados" on public.interessados for update to authenticated
  using (private.loja_do_usuario(loja_id)) with check (private.loja_do_usuario(loja_id));
create policy "lojista remove interessados" on public.interessados for delete to authenticated
  using (private.loja_do_usuario(loja_id));

grant select, update, delete on public.interessados to authenticated;

create or replace function private.avise_me(p_produto_id uuid, p_nome text, p_whatsapp text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja_id uuid;
  v_nome text := trim(coalesce(p_nome, ''));
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  select loja_id into v_loja_id from public.produtos where id = p_produto_id and ativo = true;
  if v_loja_id is null then
    raise exception 'Produto indisponível';
  end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    raise exception 'Informe seu nome';
  end if;
  if v_whatsapp !~ '^\d{10,13}$' then
    raise exception 'WhatsApp inválido';
  end if;
  insert into public.interessados (loja_id, produto_id, nome, whatsapp)
  values (v_loja_id, p_produto_id, v_nome, v_whatsapp)
  on conflict (produto_id, whatsapp) do update set nome = excluded.nome, avisado_em = null;
end;
$$;

create or replace function public.avise_me(p_produto_id uuid, p_nome text, p_whatsapp text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.avise_me(p_produto_id, p_nome, p_whatsapp);
$$;

-- Mais vendidos dos últimos 90 dias, sem expor pedidos.
create or replace function private.mais_vendidos(p_loja_id uuid, p_limite integer default 8)
returns table (produto_id uuid, vendidos bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select item.produto_id, sum(item.quantidade)::bigint as vendidos
  from public.itens_pedido as item
  join public.pedidos as pedido on pedido.id = item.pedido_id
  join public.produtos as produto on produto.id = item.produto_id and produto.ativo = true
  where pedido.loja_id = p_loja_id
    and pedido.status_pedido <> 'cancelled'
    and pedido.criado_em > now() - interval '90 days'
  group by item.produto_id
  order by vendidos desc
  limit least(greatest(coalesce(p_limite, 8), 1), 20);
$$;

create or replace function public.mais_vendidos(p_loja_id uuid, p_limite integer default 8)
returns table (produto_id uuid, vendidos bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.mais_vendidos(p_loja_id, p_limite);
$$;

-- Frete calculado no servidor: o cliente nunca envia o valor.
create or replace function private.calcular_frete(p_loja_id uuid, p_cep text, p_subtotal integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loja public.lojas%rowtype;
  v_cep text := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  v_faixa public.loja_fretes%rowtype;
  v_valor integer;
  v_prazo text;
  v_nome text;
begin
  select * into v_loja from public.lojas where id = p_loja_id;
  if not found or not v_loja.entrega_ativa then
    return jsonb_build_object('disponivel', false, 'motivo', 'Esta loja não faz entregas. Escolha retirar na loja.');
  end if;
  if v_cep !~ '^\d{8}$' then
    return jsonb_build_object('disponivel', false, 'motivo', 'Informe um CEP válido.');
  end if;

  select * into v_faixa
  from public.loja_fretes
  where loja_id = p_loja_id and v_cep between cep_inicio and cep_fim
  order by (cep_fim::bigint - cep_inicio::bigint), valor_centavos
  limit 1;

  if found then
    v_valor := v_faixa.valor_centavos;
    v_prazo := v_faixa.prazo;
    v_nome := v_faixa.nome;
  elsif v_loja.frete_padrao_centavos is not null then
    v_valor := v_loja.frete_padrao_centavos;
    v_prazo := v_loja.prazo_padrao;
    v_nome := 'Entrega';
  else
    return jsonb_build_object('disponivel', false, 'motivo', 'A loja ainda não entrega neste CEP.');
  end if;

  if v_loja.frete_gratis_acima_centavos is not null and coalesce(p_subtotal, 0) >= v_loja.frete_gratis_acima_centavos then
    v_valor := 0;
  end if;

  return jsonb_build_object('disponivel', true, 'valor_centavos', v_valor, 'prazo', v_prazo, 'nome', v_nome);
end;
$$;

create or replace function public.calcular_frete(p_loja_slug text, p_cep text, p_subtotal integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.calcular_frete((select id from public.lojas where slug = trim(p_loja_slug)), p_cep, p_subtotal);
$$;

-- Horário: {"0": {"abre": "09:00", "fecha": "18:00"}, ...} com 0 = domingo, no fuso de Brasília.
create or replace function private.loja_aberta(p_loja public.lojas)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_dia jsonb := p_loja.horarios -> extract(dow from v_agora)::int::text;
  v_hora time := v_agora::time;
begin
  if p_loja.fechada then
    return false;
  end if;
  if not p_loja.horario_ativo then
    return true;
  end if;
  if v_dia is null or v_dia->>'abre' is null or v_dia->>'fecha' is null then
    return false;
  end if;
  if (v_dia->>'fecha')::time > (v_dia->>'abre')::time then
    return v_hora >= (v_dia->>'abre')::time and v_hora < (v_dia->>'fecha')::time;
  end if;
  return v_hora >= (v_dia->>'abre')::time or v_hora < (v_dia->>'fecha')::time;
end;
$$;

drop function public.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb);
drop function private.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb);

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
  p_itens jsonb,
  p_tipo_entrega text default 'entrega'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja public.lojas%rowtype;
  v_tipo text := coalesce(nullif(trim(p_tipo_entrega), ''), 'entrega');
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
  v_frete integer := 0;
  v_cotacao jsonb;
  v_label text;
  v_has_variants boolean;
  v_product public.produtos%rowtype;
  v_variant public.produto_variacoes%rowtype;
  v_qtd_produto jsonb := '{}'::jsonb;
  v_tier jsonb;
  v_tier_price integer;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if jsonb_array_length(p_itens) > 30 then
    raise exception 'Limite de itens excedido';
  end if;
  if v_tipo not in ('entrega', 'retirada') then
    raise exception 'Escolha entrega ou retirada';
  end if;

  select * into v_loja from public.lojas where slug = trim(p_loja_slug);
  if not found then
    raise exception 'Loja não encontrada';
  end if;
  if v_loja.fechada then
    raise exception '%', coalesce(nullif(trim(v_loja.mensagem_fechada), ''), 'A loja está fechada no momento. Volte mais tarde.');
  end if;
  if not v_loja.pedidos_fora_horario and not private.loja_aberta(v_loja) then
    raise exception 'A loja está fora do horário de atendimento. Volte mais tarde.';
  end if;
  if v_tipo = 'retirada' and not v_loja.retirada_ativa then
    raise exception 'Esta loja não tem retirada. Escolha entrega.';
  end if;
  if v_tipo = 'entrega' and not v_loja.entrega_ativa then
    raise exception 'Esta loja não faz entregas. Escolha retirar na loja.';
  end if;

  v_nome := trim(p_nome);
  v_whatsapp := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_obs := trim(coalesce(p_observacoes, ''));

  if char_length(v_nome) < 3 or char_length(v_nome) > 120 then
    raise exception 'Nome inválido';
  end if;
  if v_whatsapp !~ '^\d{10,13}$' then
    raise exception 'WhatsApp inválido';
  end if;
  if char_length(v_obs) > 400 then
    raise exception 'Observação muito longa';
  end if;

  if v_tipo = 'entrega' then
    v_cep := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
    v_rua := trim(coalesce(p_rua, ''));
    v_numero := trim(coalesce(p_numero, ''));
    v_complemento := trim(coalesce(p_complemento, ''));
    v_bairro := trim(coalesce(p_bairro, ''));
    v_cidade := trim(coalesce(p_cidade, ''));
    v_estado := upper(trim(coalesce(p_estado, '')));
    if v_cep !~ '^\d{8}$' then raise exception 'CEP inválido'; end if;
    if char_length(v_rua) < 2 or char_length(v_rua) > 140 then raise exception 'Rua inválida'; end if;
    if char_length(v_numero) < 1 or char_length(v_numero) > 20 then raise exception 'Número inválido'; end if;
    if char_length(v_complemento) > 80 then raise exception 'Complemento muito longo'; end if;
    if char_length(v_bairro) < 2 or char_length(v_bairro) > 80 then raise exception 'Bairro inválido'; end if;
    if char_length(v_cidade) < 2 or char_length(v_cidade) > 80 then raise exception 'Cidade inválida'; end if;
    if v_estado !~ '^[A-Z]{2}$' then raise exception 'UF inválida'; end if;
  else
    v_cep := ''; v_rua := ''; v_numero := ''; v_complemento := ''; v_bairro := ''; v_cidade := ''; v_estado := '';
  end if;

  -- Quantidade total por produto, para o preço de atacado.
  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    if coalesce(v_item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido';
    end if;
    if coalesce(v_item->>'quantity', '') !~ '^\d+$' or (v_item->>'quantity')::integer not between 1 and 999 then
      raise exception 'Quantidade inválida';
    end if;
    v_qtd_produto := jsonb_set(
      v_qtd_produto,
      array[v_item->>'product_id'],
      to_jsonb(coalesce((v_qtd_produto->>(v_item->>'product_id'))::integer, 0) + (v_item->>'quantity')::integer)
    );
  end loop;

  insert into public.clientes (loja_id, nome_completo, whatsapp)
  values (v_loja.id, v_nome, v_whatsapp)
  on conflict (loja_id, whatsapp)
  do update set nome_completo = excluded.nome_completo
  returning id into v_cliente_id;

  insert into public.pedidos (
    loja_id, cliente_id, nome_completo, whatsapp, cep, rua, numero, complemento,
    bairro, cidade, estado, observacoes, tipo_entrega
  )
  values (
    v_loja.id, v_cliente_id, v_nome, v_whatsapp, v_cep, v_rua, v_numero, v_complemento,
    v_bairro, v_cidade, v_estado, v_obs, v_tipo
  )
  returning id, token_publico into v_pedido_id, v_token;

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_variant_id := null;

    if nullif(v_item->>'variant_id', '') is not null then
      if (v_item->>'variant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Variação inválida';
      end if;
      v_variant_id := (v_item->>'variant_id')::uuid;
    end if;

    select * into v_product
    from public.produtos
    where id = v_product_id and loja_id = v_loja.id and ativo = true
    for update;
    if not found then
      raise exception 'Produto indisponível';
    end if;

    select exists (
      select 1 from public.produto_variacoes where produto_id = v_product.id and ativo = true
    ) into v_has_variants;

    v_unit := v_product.preco_centavos;
    v_label := null;

    if v_has_variants then
      if v_variant_id is null then
        raise exception 'Selecione uma variação de %', v_product.nome;
      end if;

      select * into v_variant
      from public.produto_variacoes
      where id = v_variant_id and produto_id = v_product.id and ativo = true
      for update;
      if not found then
        raise exception 'Variação indisponível';
      end if;

      update public.produto_variacoes
      set estoque = estoque - v_qty
      where id = v_variant.id and estoque >= v_qty;
      if not found then
        raise exception 'Estoque insuficiente para %', v_product.nome;
      end if;

      v_unit := coalesce(v_variant.preco_centavos, v_product.preco_centavos);
      v_label := nullif(concat_ws(' / ', nullif(v_variant.cor, ''), nullif(v_variant.tamanho, '')), '');
    end if;

    v_tier_price := null;
    for v_tier in select value from jsonb_array_elements(v_product.atacado)
    loop
      if (v_tier->>'min') ~ '^\d+$' and (v_tier->>'preco') ~ '^\d+$'
        and (v_qtd_produto->>v_product.id::text)::integer >= (v_tier->>'min')::integer
        and (v_tier_price is null or (v_tier->>'preco')::integer < v_tier_price) then
        v_tier_price := (v_tier->>'preco')::integer;
      end if;
    end loop;
    if v_tier_price is not null and v_tier_price < v_unit then
      v_unit := v_tier_price;
    end if;

    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    insert into public.itens_pedido (
      pedido_id, produto_id, variacao_id, nome_produto, variacao_label,
      quantidade, preco_unitario_centavos, total_item_centavos
    )
    values (
      v_pedido_id, v_product.id, case when v_has_variants then v_variant_id else null end,
      v_product.nome, v_label, v_qty, v_unit, v_line
    );
  end loop;

  if v_tipo = 'entrega' then
    v_cotacao := private.calcular_frete(v_loja.id, v_cep, v_subtotal);
    if not (v_cotacao->>'disponivel')::boolean then
      raise exception '%', v_cotacao->>'motivo';
    end if;
    v_frete := (v_cotacao->>'valor_centavos')::integer;
  end if;

  update public.pedidos
  set subtotal_centavos = v_subtotal,
      frete_centavos = v_frete,
      total_centavos = v_subtotal + v_frete
  where id = v_pedido_id;

  return jsonb_build_object(
    'pedido_id', v_pedido_id,
    'token', v_token,
    'total_centavos', v_subtotal + v_frete,
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
  p_itens jsonb,
  p_tipo_entrega text default 'entrega'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.place_order(
    p_loja_slug, p_nome, p_whatsapp, p_cep, p_rua, p_numero, p_complemento,
    p_bairro, p_cidade, p_estado, p_observacoes, p_itens, p_tipo_entrega
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
  select * into v_pedido from public.pedidos where id = p_pedido_id and token_publico = p_token;
  if not found then
    return null;
  end if;

  select * into v_loja from public.lojas where id = v_pedido.loja_id;

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
    'tipo_entrega', v_pedido.tipo_entrega,
    'subtotal_centavos', v_pedido.subtotal_centavos,
    'frete_centavos', v_pedido.frete_centavos,
    'total_centavos', v_pedido.total_centavos,
    'taxa_cliente_centavos', v_pedido.taxa_cliente_centavos,
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
      'mp_status', v_loja.mp_status,
      'repassar_taxas', v_loja.repassar_taxas,
      'retirada_endereco', v_loja.retirada_endereco
    ),
    'itens', v_itens
  );
end;
$$;

revoke all on function private.avise_me(uuid, text, text) from public;
revoke all on function private.mais_vendidos(uuid, integer) from public;
revoke all on function private.calcular_frete(uuid, text, integer) from public;
revoke all on function private.loja_aberta(public.lojas) from public;
revoke all on function private.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb, text) from public;

grant execute on function private.avise_me(uuid, text, text) to anon, authenticated;
grant execute on function private.mais_vendidos(uuid, integer) to anon, authenticated;
grant execute on function private.calcular_frete(uuid, text, integer) to anon, authenticated;
grant execute on function private.loja_aberta(public.lojas) to anon, authenticated;
grant execute on function private.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.avise_me(uuid, text, text) to anon, authenticated;
grant execute on function public.mais_vendidos(uuid, integer) to anon, authenticated;
grant execute on function public.calcular_frete(text, text, integer) to anon, authenticated;
grant execute on function public.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;

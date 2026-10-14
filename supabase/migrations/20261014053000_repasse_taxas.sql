-- Repasse de taxas, no mesmo modelo do Wagoo:
-- com repassar_taxas ligado, o Pix é cobrado por cima do valor do catálogo para
-- cobrir a taxa Pix do Mercado Pago e o 1% da Shopwag, e a loja recebe o valor cheio.
-- taxa_pix_percent começa em 0,99 e é recalibrada pelo backend com a taxa real cobrada.

alter table public.lojas
  add column repassar_taxas boolean not null default false,
  add column taxa_pix_percent numeric(6, 4) not null default 0.99,
  add column taxa_pix_observada_em timestamptz,
  add constraint lojas_taxa_pix_percent_check check (taxa_pix_percent >= 0 and taxa_pix_percent < 20);

alter table public.pedidos
  add column taxa_cliente_centavos integer not null default 0,
  add constraint pedidos_taxa_cliente_check check (taxa_cliente_centavos >= 0);

-- Só o backend (service role) muda estes campos; o painel passa pela API.
create or replace function private.keep_mp_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    new.mp_status := old.mp_status;
    new.repassar_taxas := old.repassar_taxas;
    new.taxa_pix_percent := old.taxa_pix_percent;
    new.taxa_pix_observada_em := old.taxa_pix_observada_em;
  end if;
  return new;
end;
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
      'repassar_taxas', v_loja.repassar_taxas
    ),
    'itens', v_itens
  );
end;
$$;

-- Cartão de crédito e débito pelo Checkout Transparente (Card Payment Brick).
-- As taxas começam na tabela pública do Mercado Pago (recebimento na hora) e são
-- recalibradas pelo backend com a taxa real da primeira venda aprovada em cada meio.

alter table public.lojas
  add column taxa_credito_percent numeric(6, 4) not null default 4.98,
  add column taxa_debito_percent numeric(6, 4) not null default 3.99,
  add constraint lojas_taxa_credito_percent_check check (taxa_credito_percent >= 0 and taxa_credito_percent < 20),
  add constraint lojas_taxa_debito_percent_check check (taxa_debito_percent >= 0 and taxa_debito_percent < 20);

alter table public.pedidos
  drop constraint pedidos_metodo,
  add constraint pedidos_metodo check (metodo_pagamento in ('pix', 'credito', 'debito'));

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
    new.taxa_credito_percent := old.taxa_credito_percent;
    new.taxa_debito_percent := old.taxa_debito_percent;
  end if;
  return new;
end;
$$;

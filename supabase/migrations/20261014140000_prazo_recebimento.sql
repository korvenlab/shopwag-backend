-- Prazo de recebimento do crédito que o lojista escolheu no Mercado Pago.
-- Define a taxa inicial do crédito; o backend continua recalibrando com a taxa real das vendas.

alter table public.lojas
  add column mp_prazo_recebimento text not null default 'na_hora',
  add constraint lojas_mp_prazo_recebimento_check check (mp_prazo_recebimento in ('na_hora', '14_dias', '30_dias'));

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
    new.mp_prazo_recebimento := old.mp_prazo_recebimento;
  end if;
  return new;
end;
$$;

-- Personalização da landing da vitrine: headline, seções, faixa promo e nicho.

alter table public.lojas
  add column if not exists headline text,
  add column if not exists subtitulo text,
  add column if not exists promo_texto text,
  add column if not exists promo_ate timestamptz,
  add column if not exists secoes jsonb not null default '[]'::jsonb,
  add column if not exists nicho text;

alter table public.lojas drop constraint if exists lojas_headline_tamanho;
alter table public.lojas
  add constraint lojas_headline_tamanho check (headline is null or char_length(trim(headline)) between 2 and 80);

alter table public.lojas drop constraint if exists lojas_subtitulo_tamanho;
alter table public.lojas
  add constraint lojas_subtitulo_tamanho check (subtitulo is null or char_length(trim(subtitulo)) between 2 and 180);

alter table public.lojas drop constraint if exists lojas_promo_texto_tamanho;
alter table public.lojas
  add constraint lojas_promo_texto_tamanho check (promo_texto is null or char_length(trim(promo_texto)) between 2 and 120);

alter table public.lojas drop constraint if exists lojas_nicho_tamanho;
alter table public.lojas
  add constraint lojas_nicho_tamanho check (nicho is null or char_length(trim(nicho)) between 2 and 40);

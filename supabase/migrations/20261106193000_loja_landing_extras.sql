-- CTA, layout, prova social, coleção em destaque e variante de tema.

alter table public.lojas
  add column if not exists cta_texto text,
  add column if not exists cta_link text,
  add column if not exists layout_modo text not null default 'padrao',
  add column if not exists prova_ativa boolean not null default false,
  add column if not exists prova_tipo text not null default 'selo',
  add column if not exists prova_texto text,
  add column if not exists prova_autor text,
  add column if not exists colecao_destaque text,
  add column if not exists tema_variante text not null default 'escuro';

alter table public.lojas drop constraint if exists lojas_cta_texto_tamanho;
alter table public.lojas
  add constraint lojas_cta_texto_tamanho check (cta_texto is null or char_length(trim(cta_texto)) between 2 and 40);

alter table public.lojas drop constraint if exists lojas_cta_link_tamanho;
alter table public.lojas
  add constraint lojas_cta_link_tamanho check (cta_link is null or char_length(trim(cta_link)) between 1 and 200);

alter table public.lojas drop constraint if exists lojas_layout_modo;
alter table public.lojas
  add constraint lojas_layout_modo check (layout_modo in ('padrao', 'compacto', 'editorial'));

alter table public.lojas drop constraint if exists lojas_prova_tipo;
alter table public.lojas
  add constraint lojas_prova_tipo check (prova_tipo in ('selo', 'depoimento'));

alter table public.lojas drop constraint if exists lojas_prova_texto_tamanho;
alter table public.lojas
  add constraint lojas_prova_texto_tamanho check (prova_texto is null or char_length(trim(prova_texto)) between 2 and 160);

alter table public.lojas drop constraint if exists lojas_prova_autor_tamanho;
alter table public.lojas
  add constraint lojas_prova_autor_tamanho check (prova_autor is null or char_length(trim(prova_autor)) between 2 and 60);

alter table public.lojas drop constraint if exists lojas_colecao_destaque_tamanho;
alter table public.lojas
  add constraint lojas_colecao_destaque_tamanho check (colecao_destaque is null or char_length(trim(colecao_destaque)) between 1 and 60);

alter table public.lojas drop constraint if exists lojas_tema_variante;
alter table public.lojas
  add constraint lojas_tema_variante check (tema_variante in ('claro', 'escuro'));

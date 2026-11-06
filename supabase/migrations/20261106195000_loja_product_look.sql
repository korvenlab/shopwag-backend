alter table public.lojas
  add column if not exists card_layout text not null default 'padrao',
  add column if not exists card_hover boolean not null default true,
  add column if not exists badge_modo text not null default 'auto',
  add column if not exists produto_blocos jsonb not null default '[]'::jsonb,
  add column if not exists fonte_corpo text not null default 'limpa',
  add column if not exists fundo_textura text not null default 'nenhuma';

alter table public.lojas drop constraint if exists lojas_card_layout;
alter table public.lojas
  add constraint lojas_card_layout check (card_layout in ('padrao', 'compacto', 'editorial'));

alter table public.lojas drop constraint if exists lojas_badge_modo;
alter table public.lojas
  add constraint lojas_badge_modo check (badge_modo in ('auto', 'novo', 'ultimas', 'off'));

alter table public.lojas drop constraint if exists lojas_fonte_corpo;
alter table public.lojas
  add constraint lojas_fonte_corpo check (fonte_corpo in ('limpa', 'leitura', 'neutra'));

alter table public.lojas drop constraint if exists lojas_fundo_textura;
alter table public.lojas
  add constraint lojas_fundo_textura check (fundo_textura in ('nenhuma', 'papel', 'linho', 'grao', 'grade'));

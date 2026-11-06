alter table public.lojas
  add column if not exists categorias_nav jsonb not null default '[]'::jsonb,
  add column if not exists categoria_estilo text not null default 'bolhas';

alter table public.lojas drop constraint if exists lojas_categoria_estilo;
alter table public.lojas
  add constraint lojas_categoria_estilo check (categoria_estilo in ('bolhas', 'chips', 'cards'));

alter table public.lojas
  add column cor_fundo text not null default '#050505',
  add column cor_texto text not null default '#f4f1ea',
  add column cor_destaque text not null default '#f4f1ea',
  add column fonte_titulo text not null default 'elegante',
  add column logo_formato text not null default 'arredondado',
  add column logo_texto text,
  add column mostrar_nome boolean not null default true,
  add constraint lojas_cor_fundo_hex check (cor_fundo ~ '^#[0-9a-fA-F]{6}$'),
  add constraint lojas_cor_texto_hex check (cor_texto ~ '^#[0-9a-fA-F]{6}$'),
  add constraint lojas_cor_destaque_hex check (cor_destaque ~ '^#[0-9a-fA-F]{6}$'),
  add constraint lojas_fonte_titulo_valida check (fonte_titulo in ('elegante', 'moderna', 'classica', 'marcante')),
  add constraint lojas_logo_formato_valido check (logo_formato in ('circulo', 'arredondado', 'quadrado')),
  add constraint lojas_logo_texto_tamanho check (logo_texto is null or char_length(logo_texto) between 1 and 3);

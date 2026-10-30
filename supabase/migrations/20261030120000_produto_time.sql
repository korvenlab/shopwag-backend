alter table public.produtos
  add column time text,
  add constraint produtos_time_tamanho check (time is null or char_length(trim(time)) between 2 and 40);

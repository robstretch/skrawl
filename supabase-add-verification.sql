alter table users add column if not exists verified boolean not null default false;
alter table users add column if not exists verification_token text;

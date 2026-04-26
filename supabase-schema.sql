-- Run this in your Supabase SQL editor

create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  rating integer not null default 1000,
  games_played integer not null default 0,
  wins integer not null default 0,
  created_at timestamptz default now()
);

create table game_results (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  winner_id uuid references users(id),
  players jsonb not null,  -- array of {userId, username, score}
  played_at timestamptz default now()
);

-- Helper functions for atomic increments
create or replace function increment(row_id uuid, col text)
returns integer language plpgsql as $$
declare result integer;
begin
  execute format('update users set %I = %I + 1 where id = $1 returning %I', col, col, col)
  into result using row_id;
  return result;
end;
$$;

-- Clamp rating (never below 100)
create or replace function clamp_rating(uid uuid, delta integer)
returns integer language plpgsql as $$
declare result integer;
begin
  update users
    set rating = greatest(100, rating + delta)
    where id = uid
    returning rating into result;
  return result;
end;
$$;

-- Indexes
create index on users (rating desc);
create index on users (email);
create index on users (username);

-- Add drawing and guessing rating columns
alter table users add column if not exists drawing_rating integer not null default 1000;
alter table users add column if not exists guessing_rating integer not null default 1000;

-- K-factor based on games played
create or replace function k_factor(gp integer)
returns integer language plpgsql as $$
begin
  if gp < 30 then return 40;
  elsif gp < 100 then return 20;
  else return 10;
  end if;
end;
$$;

-- Update drawing rating after a turn
-- guessed_ratio: fraction of players who guessed (0.0 - 1.0)
create or replace function update_drawing_rating(uid uuid, guessed_ratio float)
returns void language plpgsql as $$
declare kf integer; new_draw integer;
begin
  select k_factor(games_played) into kf from users where id = uid;
  new_draw := greatest(100, (select drawing_rating from users where id = uid) + round(kf * (guessed_ratio - 0.5))::integer);
  update users set
    drawing_rating = new_draw,
    rating = greatest(100, round(0.4 * new_draw + 0.6 * guessing_rating)::integer)
  where id = uid;
end;
$$;

-- Update guessing rating after a turn
-- guessed: did they get it right
-- speed_bonus: 0-10 based on how fast (first guesser gets 10, last gets 0)
create or replace function update_guessing_rating(uid uuid, guessed boolean, speed_bonus integer)
returns void language plpgsql as $$
declare kf integer; new_guess integer;
begin
  select k_factor(games_played) into kf from users where id = uid;
  new_guess := greatest(100, (select guessing_rating from users where id = uid) +
    (case when guessed then kf/2 + speed_bonus else -(kf/4) end));
  update users set
    guessing_rating = new_guess,
    rating = greatest(100, round(0.4 * drawing_rating + 0.6 * new_guess)::integer)
  where id = uid;
end;
$$;

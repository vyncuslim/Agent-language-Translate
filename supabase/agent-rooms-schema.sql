-- Agent Language Translate: persistent AI Agent Rooms
-- Apply this to the Supabase project that owns the human Auth users.
-- This file is intentionally an install/schema script, not a Supabase migration-history entry.

create table if not exists public.agent_rooms (
  id uuid primary key,
  public_id text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  topic text not null check (char_length(topic) between 1 and 240),
  rules text not null default '' check (char_length(rules) <= 4000),
  join_code_hash text not null check (char_length(join_code_hash) = 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.agent_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  can_invite_agents boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_agents (
  id uuid primary key,
  room_id uuid not null references public.agent_rooms(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1200),
  api_token_hash text not null unique check (char_length(api_token_hash) = 64),
  token_prefix text not null check (char_length(token_prefix) <= 32),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.room_messages (
  id uuid primary key,
  room_id uuid not null references public.agent_rooms(id) on delete cascade,
  sender_type text not null check (sender_type in ('human', 'agent', 'system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_agent_id uuid references public.room_agents(id) on delete set null,
  sender_name text not null check (char_length(sender_name) between 1 and 120),
  content text not null check (char_length(content) between 1 and 16384),
  created_at timestamptz not null default now(),
  constraint room_messages_sender_shape check (
    (sender_type = 'human' and sender_user_id is not null and sender_agent_id is null)
    or (sender_type = 'agent' and sender_agent_id is not null and sender_user_id is null)
    or (sender_type = 'system' and sender_user_id is null and sender_agent_id is null)
  )
);

create index if not exists room_members_user_idx on public.room_members(user_id, joined_at desc);
create index if not exists room_agents_room_idx on public.room_agents(room_id, created_at asc);
create index if not exists room_agents_token_idx on public.room_agents(api_token_hash) where status = 'active';
create index if not exists room_messages_room_time_idx on public.room_messages(room_id, created_at asc);

-- Browser clients do not query these tables directly. All room operations pass through
-- authenticated Vercel API routes, while server-side Supabase secret keys map to service_role.
alter table public.agent_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_agents enable row level security;
alter table public.room_messages enable row level security;

revoke all on table public.agent_rooms from anon, authenticated;
revoke all on table public.room_members from anon, authenticated;
revoke all on table public.room_agents from anon, authenticated;
revoke all on table public.room_messages from anon, authenticated;

grant select, insert, update, delete on table public.agent_rooms to service_role;
grant select, insert, update, delete on table public.room_members to service_role;
grant select, insert, update, delete on table public.room_agents to service_role;
grant select, insert, update, delete on table public.room_messages to service_role;

-- SaaS schema for teams, subscriptions, and usage tracking.

create extension if not exists "pgcrypto";

-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  owner_user_id uuid not null references auth.users(id)
);

comment on table public.teams is 'Teams in the multi-tenant SaaS.';
comment on column public.teams.id is 'Primary key for teams.';
comment on column public.teams.name is 'Display name for the team.';
comment on column public.teams.created_at is 'Team creation timestamp.';
comment on column public.teams.owner_user_id is 'Owner of the team (auth.users.id).';

-- Team members
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  joined_at timestamptz not null default now(),
  seat_active boolean not null default true
);

comment on table public.team_members is 'Memberships that link users to teams.';
comment on column public.team_members.id is 'Primary key for team membership.';
comment on column public.team_members.team_id is 'Team that the user belongs to.';
comment on column public.team_members.user_id is 'User who belongs to the team.';
comment on column public.team_members.role is 'Role within the team (admin, operator, viewer).';
comment on column public.team_members.joined_at is 'Membership creation timestamp.';
comment on column public.team_members.seat_active is 'Whether the seat is currently active.';

-- Subscriptions
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  stripe_subscription_id text,
  plan_name text not null,
  status text not null,
  seats_allowed integer not null default 1,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is 'Subscription data per team.';
comment on column public.subscriptions.id is 'Primary key for subscriptions.';
comment on column public.subscriptions.team_id is 'Team that owns the subscription.';
comment on column public.subscriptions.stripe_subscription_id is 'External Stripe subscription identifier.';
comment on column public.subscriptions.plan_name is 'Name of the subscription plan.';
comment on column public.subscriptions.status is 'Current subscription status.';
comment on column public.subscriptions.seats_allowed is 'Number of seats allowed for the team.';
comment on column public.subscriptions.current_period_end is 'End of the current billing period.';
comment on column public.subscriptions.created_at is 'Subscription creation timestamp.';
comment on column public.subscriptions.updated_at is 'Subscription last update timestamp.';

-- Usage aggregates
create table if not exists public.usage_aggregates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  usage_date date not null,
  tokens_used integer not null default 0,
  requests_count integer not null default 0
);

comment on table public.usage_aggregates is 'Daily usage aggregates for AI requests.';
comment on column public.usage_aggregates.id is 'Primary key for usage aggregate.';
comment on column public.usage_aggregates.team_id is 'Team that generated the usage.';
comment on column public.usage_aggregates.usage_date is 'Date of usage aggregation.';
comment on column public.usage_aggregates.tokens_used is 'Total tokens used on the date.';
comment on column public.usage_aggregates.requests_count is 'Total requests on the date.';

-- Indexes
create unique index if not exists team_members_user_id_key on public.team_members(user_id);
create unique index if not exists team_members_team_user_key on public.team_members(team_id, user_id);
create index if not exists team_members_team_id_idx on public.team_members(team_id);
create index if not exists subscriptions_team_id_idx on public.subscriptions(team_id);
create index if not exists usage_aggregates_team_id_idx on public.usage_aggregates(team_id);
create unique index if not exists usage_aggregates_team_date_key on public.usage_aggregates(team_id, usage_date);

-- Update timestamp trigger for subscriptions
create or replace function public.set_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_timestamp_updated_at();

-- Optional: auto-create team and membership on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  new_team_id uuid;
  team_name text;
begin
  team_name := coalesce(new.raw_user_meta_data->>'full_name', new.email, 'New Team');

  insert into public.teams (name, owner_user_id)
  values (team_name, new.id)
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, role, seat_active)
  values (new_team_id, new.id, 'admin', true);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_aggregates enable row level security;

-- RLS policies
-- Teams: owners/admins/operators can select, owners/admins can update
create policy teams_select_owner_admin_operator
on public.teams
for select
using (
  auth.uid() = owner_user_id
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role in ('admin', 'operator')
  )
);

create policy teams_update_owner_admin
on public.teams
for update
using (
  auth.uid() = owner_user_id
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  )
)
with check (
  auth.uid() = owner_user_id
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  )
);

-- Team members: owners/admins select/update; operators select; operators update own membership
create policy team_members_select_owner_admin_operator
on public.team_members
for select
using (
  exists (
    select 1 from public.teams t
    where t.id = team_members.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role in ('admin', 'operator')
        )
      )
  )
);

create policy team_members_update_owner_admin
on public.team_members
for update
using (
  exists (
    select 1 from public.teams t
    where t.id = team_members.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.teams t
    where t.id = team_members.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
);

create policy team_members_update_self_operator
on public.team_members
for update
using (
  team_members.user_id = auth.uid()
  and team_members.role = 'operator'
)
with check (
  team_members.user_id = auth.uid()
  and team_members.role = 'operator'
);

-- Subscriptions: owners/admins select/update
create policy subscriptions_select_owner_admin_operator
on public.subscriptions
for select
using (
  exists (
    select 1 from public.teams t
    where t.id = subscriptions.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role in ('admin', 'operator')
        )
      )
  )
);

create policy subscriptions_update_owner_admin
on public.subscriptions
for update
using (
  exists (
    select 1 from public.teams t
    where t.id = subscriptions.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.teams t
    where t.id = subscriptions.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
);

-- Usage aggregates: owners/admins select/update, service_role can write
create policy usage_aggregates_select_owner_admin_operator
on public.usage_aggregates
for select
using (
  exists (
    select 1 from public.teams t
    where t.id = usage_aggregates.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role in ('admin', 'operator')
        )
      )
  )
);

create policy usage_aggregates_update_owner_admin
on public.usage_aggregates
for update
using (
  exists (
    select 1 from public.teams t
    where t.id = usage_aggregates.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.teams t
    where t.id = usage_aggregates.team_id
      and (
        t.owner_user_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = t.id
            and tm.user_id = auth.uid()
            and tm.role = 'admin'
        )
      )
  )
);

create policy usage_aggregates_write_service_role
on public.usage_aggregates
for insert
with check (auth.role() = 'service_role');

create policy usage_aggregates_update_service_role
on public.usage_aggregates
for update
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

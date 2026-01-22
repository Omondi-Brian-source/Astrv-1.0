import type { SupabaseClient } from "@supabase/supabase-js";

import type { Subscription, Team, TeamMember } from "./types";

export type SubscriptionCheckResult = {
  team: Team;
  teamMember: TeamMember;
  subscription: Subscription;
  seatsUsed: number;
};

const TEAM_MEMBER_SELECT =
  "id, team_id, user_id, role, joined_at, seat_active, teams(id, name, created_at, owner_user_id)";

const SUBSCRIPTION_SELECT =
  "id, team_id, stripe_subscription_id, plan_name, status, seats_allowed, current_period_end, created_at, updated_at";

/**
 * Ensures the user belongs to a team with an active subscription and available seats.
 * Throws an Error when any check fails so API routes can respond consistently.
 */
export async function ensureSubscriptionAndSeat(
  supabaseClient: SupabaseClient,
  userId: string
): Promise<SubscriptionCheckResult> {
  const { data: teamMemberData, error: teamMemberError } = await supabaseClient
    .from("team_members")
    .select(TEAM_MEMBER_SELECT)
    .eq("user_id", userId)
    .eq("seat_active", true)
    .maybeSingle();

  if (teamMemberError) {
    throw new Error("team_lookup_failed");
  }

  if (!teamMemberData) {
    throw new Error("team_membership_missing");
  }

  const teamMember = teamMemberData as TeamMember & {
    teams?: Team | Team[] | null;
  };

  const linkedTeam = Array.isArray(teamMember.teams)
    ? teamMember.teams[0]
    : teamMember.teams ?? null;

  let team = linkedTeam;

  if (!team) {
    const { data: teamData, error: teamError } = await supabaseClient
      .from("teams")
      .select("id, name, created_at, owner_user_id")
      .eq("id", teamMember.team_id)
      .maybeSingle();

    if (teamError || !teamData) {
      throw new Error("team_missing");
    }

    team = teamData as Team;
  }

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseClient
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("team_id", team.id)
      .eq("status", "active")
      .maybeSingle();

  if (subscriptionError || !subscriptionData) {
    throw new Error("subscription_inactive");
  }

  const subscription = subscriptionData as Subscription;

  const { count: seatsUsed, error: seatsError } = await supabaseClient
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("team_id", team.id)
    .eq("seat_active", true);

  if (seatsError) {
    throw new Error("seat_count_failed");
  }

  const activeSeats = seatsUsed ?? 0;

  if (activeSeats >= subscription.seats_allowed) {
    throw new Error("seat_limit_reached");
  }

  return {
    team,
    teamMember,
    subscription,
    seatsUsed: activeSeats,
  };
}

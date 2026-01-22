import type { User } from "@supabase/supabase-js";

import { ensureSubscriptionAndSeat } from "../lib/subscriptionChecker";
import { getSupabaseAdminClient } from "../lib/supabaseClient";
import type { Subscription, Team, TeamMember } from "../lib/types";

export type AuthContext = {
  user: User;
  team: Team;
  teamMember: TeamMember;
  subscription: Subscription;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
};

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/**
 * Middleware helper for Next.js route handlers.
 * - Verifies the Supabase JWT with the admin client.
 * - Ensures the team has an active subscription and seat availability.
 * - Attaches { user, team, teamMember, subscription } onto the Request.
 */
export async function authAndSubscription(
  request: Request
): Promise<AuthenticatedRequest> {
  const token = parseBearerToken(request.headers.get("Authorization"));
  if (!token) {
    throw new Error("missing_token");
  }

  const adminClient = getSupabaseAdminClient();
  const { data, error } = await adminClient.auth.getUser(token);

  if (error || !data?.user) {
    throw new Error("unauthorized");
  }

  const { team, teamMember, subscription } = await ensureSubscriptionAndSeat(
    adminClient,
    data.user.id
  );

  const authenticatedRequest = request as AuthenticatedRequest;
  authenticatedRequest.auth = {
    user: data.user as User,
    team,
    teamMember,
    subscription,
  };

  return authenticatedRequest;
}

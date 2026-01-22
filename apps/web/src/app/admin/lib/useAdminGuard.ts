"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "../../../lib/supabaseBrowserClient";
import type { Team, TeamMember } from "../../../lib/types";

export type AdminGuardState = {
  isLoading: boolean;
  error: string | null;
  isAuthorized: boolean;
  user: { id: string; email?: string | null } | null;
  teamMember: TeamMember | null;
  team: Team | null;
};

const SIGN_IN_PATH = "/sign-in";

/**
 * Client-side guard for admin pages.
 * - Redirects anonymous users to the sign-in page.
 * - Verifies the user is a team admin or the team owner.
 */
export function useAdminGuard(): AdminGuardState {
  const router = useRouter();
  const [state, setState] = useState<AdminGuardState>({
    isLoading: true,
    error: null,
    isAuthorized: false,
    user: null,
    teamMember: null,
    team: null,
  });

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseBrowserClient();

    async function load() {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        router.replace(SIGN_IN_PATH);
        return;
      }

      const { data: teamMemberData, error: teamMemberError } = await supabase
        .from("team_members")
        .select(
          "id, team_id, user_id, role, joined_at, seat_active, teams(id, name, created_at, owner_user_id)"
        )
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (teamMemberError) {
        setState({
          isLoading: false,
          error: "Unable to load team membership.",
          isAuthorized: false,
          user: { id: userData.user.id, email: userData.user.email },
          teamMember: null,
          team: null,
        });
        return;
      }

      const teamMember = teamMemberData as TeamMember & {
        teams?: Team | Team[] | null;
      } | null;
      const team = Array.isArray(teamMember?.teams)
        ? teamMember?.teams[0] ?? null
        : teamMember?.teams ?? null;

      const isOwner = team?.owner_user_id === userData.user.id;
      const isAdmin = teamMember?.role === "admin";

      setState({
        isLoading: false,
        error: null,
        isAuthorized: Boolean(isOwner || isAdmin),
        user: { id: userData.user.id, email: userData.user.email },
        teamMember: teamMember ?? null,
        team,
      });
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return state;
}

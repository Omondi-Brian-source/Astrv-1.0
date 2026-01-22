"use client";

import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "../../../lib/supabaseBrowserClient";
import type { Team } from "../../../lib/types";
import { useAdminGuard } from "../lib/useAdminGuard";

type TeamRow = Team & {
  owner_email?: string | null;
};

export default function TeamsPage() {
  const { user, isAuthorized } = useAdminGuard();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!isAuthorized) return;

    async function loadTeams() {
      setIsLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("teams")
        .select("id, name, created_at, owner_user_id")
        .order("created_at", { ascending: false });

      if (loadError) {
        setError("Unable to load teams.");
        setIsLoading(false);
        return;
      }

      const mappedTeams: TeamRow[] = (data ?? []).map((team) => ({
        ...team,
        owner_email: team.owner_user_id === user?.id ? user?.email : null,
      }));

      setTeams(mappedTeams);
      setIsLoading(false);
    }

    loadTeams();
  }, [isAuthorized, supabase, user?.email, user?.id]);

  async function handleCreateTeam() {
    setError(null);
    setSuccess(null);

    if (!newTeamName.trim()) {
      setError("Team name is required.");
      return;
    }

    if (!user?.id) {
      setError("Unable to determine current user.");
      return;
    }

    const { data, error: createError } = await supabase
      .from("teams")
      .insert({ name: newTeamName.trim(), owner_user_id: user.id })
      .select("id, name, created_at, owner_user_id")
      .single();

    if (createError || !data) {
      setError("Failed to create team.");
      return;
    }

    setTeams((prev) => [
      {
        ...data,
        owner_email: user.email ?? null,
      },
      ...prev,
    ]);
    setNewTeamName("");
    setSuccess("Team created successfully.");
  }

  async function handleUpdateTeam(teamId: string) {
    setError(null);
    setSuccess(null);

    const newName = editingNames[teamId]?.trim();
    if (!newName) {
      setError("Team name cannot be empty.");
      return;
    }

    const { error: updateError } = await supabase
      .from("teams")
      .update({ name: newName })
      .eq("id", teamId);

    if (updateError) {
      setError("Failed to update team.");
      return;
    }

    setTeams((prev) =>
      prev.map((team) =>
        team.id === teamId ? { ...team, name: newName } : team
      )
    );
    setSuccess("Team updated successfully.");
  }

  async function handleDeleteTeam(teamId: string) {
    setError(null);
    setSuccess(null);

    const { error: deleteError } = await supabase
      .from("teams")
      .delete()
      .eq("id", teamId);

    if (deleteError) {
      setError("Failed to delete team.");
      return;
    }

    setTeams((prev) => prev.filter((team) => team.id !== teamId));
    setSuccess("Team deleted.");
  }

  if (isLoading) {
    return <div className="text-slate-600">Loading teams...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Create team</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Team name"
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
          />
          <button
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={handleCreateTeam}
          >
            Create
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Team
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Owner email
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Created
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {teams.map((team) => (
              <tr key={team.id}>
                <td className="px-4 py-3">
                  <input
                    className="w-full rounded-md border border-slate-200 px-2 py-1"
                    value={
                      editingNames[team.id] !== undefined
                        ? editingNames[team.id]
                        : team.name
                    }
                    onChange={(event) =>
                      setEditingNames((prev) => ({
                        ...prev,
                        [team.id]: event.target.value,
                      }))
                    }
                  />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {team.owner_email ?? "Unavailable"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(team.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs"
                      onClick={() => handleUpdateTeam(team.id)}
                    >
                      Save
                    </button>
                    <button
                      className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600"
                      onClick={() => handleDeleteTeam(team.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No teams found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

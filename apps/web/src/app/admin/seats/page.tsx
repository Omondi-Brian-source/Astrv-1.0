"use client";

import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "../../../lib/supabaseBrowserClient";
import type { Team, TeamMember } from "../../../lib/types";
import { useAdminGuard } from "../lib/useAdminGuard";

type SeatRow = TeamMember & {
  teams?: Team | Team[] | null;
  team_name?: string | null;
  owner_email?: string | null;
};

type SeatEdit = {
  role: TeamMember["role"];
  seat_active: boolean;
};

export default function SeatsPage() {
  const { user, isAuthorized, team } = useAdminGuard();
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingRows, setEditingRows] = useState<Record<string, SeatEdit>>({});
  const [newSeatTeamId, setNewSeatTeamId] = useState("");
  const [newSeatUserId, setNewSeatUserId] = useState("");
  const [newSeatRole, setNewSeatRole] = useState<TeamMember["role"]>(
    "operator"
  );

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!isAuthorized) return;

    async function loadSeats() {
      setIsLoading(true);
      setError(null);

      const [{ data: seatData, error: seatError }, { data: teamData }] =
        await Promise.all([
          supabase
            .from("team_members")
            .select(
              "id, team_id, user_id, role, joined_at, seat_active, teams(id, name, created_at, owner_user_id)"
            )
            .order("joined_at", { ascending: false }),
          supabase
            .from("teams")
            .select("id, name, created_at, owner_user_id")
            .order("created_at", { ascending: false }),
        ]);

      if (seatError) {
        setError("Unable to load seats.");
        setIsLoading(false);
        return;
      }

      const mappedSeats: SeatRow[] = (seatData ?? []).map((seat) => {
        const seatTeam = Array.isArray(seat.teams) ? seat.teams[0] : seat.teams;
        return {
          ...seat,
          team_name: seatTeam?.name ?? null,
          owner_email:
            seatTeam?.owner_user_id === user?.id ? user?.email ?? null : null,
        };
      });

      setSeats(mappedSeats);
      setTeams(teamData ?? []);
      setNewSeatTeamId(team?.id ?? teamData?.[0]?.id ?? "");
      setIsLoading(false);
    }

    loadSeats();
  }, [isAuthorized, supabase, team?.id, user?.email, user?.id]);

  function getEditable(seat: SeatRow): SeatEdit {
    return (
      editingRows[seat.id] ?? {
        role: seat.role,
        seat_active: seat.seat_active,
      }
    );
  }

  function updateEditing(id: string, updates: Partial<SeatEdit>) {
    setEditingRows((prev) => ({
      ...prev,
      [id]: {
        ...getEditable(seats.find((item) => item.id === id)!),
        ...updates,
      },
    }));
  }

  async function handleSave(seat: SeatRow) {
    setError(null);
    setSuccess(null);

    const editable = getEditable(seat);

    const { error: updateError } = await supabase
      .from("team_members")
      .update({
        role: editable.role,
        seat_active: editable.seat_active,
      })
      .eq("id", seat.id);

    if (updateError) {
      setError("Failed to update seat.");
      return;
    }

    setSeats((prev) =>
      prev.map((item) =>
        item.id === seat.id ? { ...item, ...editable } : item
      )
    );
    setSuccess("Seat updated.");
  }

  async function handleRemove(seatId: string) {
    setError(null);
    setSuccess(null);

    const { error: deleteError } = await supabase
      .from("team_members")
      .delete()
      .eq("id", seatId);

    if (deleteError) {
      setError("Failed to remove seat.");
      return;
    }

    setSeats((prev) => prev.filter((seat) => seat.id !== seatId));
    setSuccess("Seat removed.");
  }

  async function handleAddSeat() {
    setError(null);
    setSuccess(null);

    if (!newSeatTeamId) {
      setError("Select a team.");
      return;
    }

    if (!newSeatUserId.trim()) {
      setError("Provide a user ID to add a seat.");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("team_members")
      .insert({
        team_id: newSeatTeamId,
        user_id: newSeatUserId.trim(),
        role: newSeatRole,
        seat_active: true,
      })
      .select(
        "id, team_id, user_id, role, joined_at, seat_active, teams(id, name, created_at, owner_user_id)"
      )
      .single();

    if (insertError || !data) {
      setError("Failed to add seat.");
      return;
    }

    const seatTeam = Array.isArray(data.teams) ? data.teams[0] : data.teams;
    setSeats((prev) => [
      {
        ...data,
        team_name: seatTeam?.name ?? null,
        owner_email:
          seatTeam?.owner_user_id === user?.id ? user?.email ?? null : null,
      },
      ...prev,
    ]);
    setNewSeatUserId("");
    setSuccess("Seat added.");
  }

  if (isLoading) {
    return <div className="text-slate-600">Loading seats...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Add seat</h2>
        <p className="mt-2 text-sm text-slate-600">
          Add a seat directly by user ID. Swap this form with an invite flow if
          you prefer email invitations.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Team</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={newSeatTeamId}
              onChange={(event) => setNewSeatTeamId(event.target.value)}
            >
              <option value="">Select team</option>
              {teams.map((teamItem) => (
                <option key={teamItem.id} value={teamItem.id}>
                  {teamItem.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">
              User ID
            </label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="UUID from auth.users"
              value={newSeatUserId}
              onChange={(event) => setNewSeatUserId(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Role</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={newSeatRole}
              onChange={(event) =>
                setNewSeatRole(event.target.value as TeamMember["role"])
              }
            >
              <option value="admin">admin</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
        </div>
        <button
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          onClick={handleAddSeat}
        >
          Add seat
        </button>
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
                User ID
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Role
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Seat active
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {seats.map((seat) => {
              const editable = getEditable(seat);

              return (
                <tr key={seat.id}>
                  <td className="px-4 py-3">{seat.team_name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {seat.owner_email ?? "Unavailable"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{seat.user_id}</td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-md border border-slate-200 px-2 py-1"
                      value={editable.role}
                      onChange={(event) =>
                        updateEditing(seat.id, {
                          role: event.target.value as TeamMember["role"],
                        })
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="operator">operator</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={editable.seat_active}
                      onChange={(event) =>
                        updateEditing(seat.id, {
                          seat_active: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs"
                        onClick={() => handleSave(seat)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600"
                        onClick={() => handleRemove(seat.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {seats.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No seats found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

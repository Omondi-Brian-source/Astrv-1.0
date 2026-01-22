"use client";

import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "../../../lib/supabaseBrowserClient";
import type { Subscription, Team } from "../../../lib/types";
import { useAdminGuard } from "../lib/useAdminGuard";

type SubscriptionRow = Subscription & {
  teams?: Team | Team[] | null;
  team_name?: string | null;
  owner_email?: string | null;
};

type EditableSubscription = {
  plan_name: string;
  seats_allowed: number;
  status: string;
  current_period_end: string;
};

export default function SubscriptionsPage() {
  const { user, isAuthorized } = useAdminGuard();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingRows, setEditingRows] = useState<
    Record<string, EditableSubscription>
  >({});

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!isAuthorized) return;

    async function loadSubscriptions() {
      setIsLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("subscriptions")
        .select(
          "id, team_id, stripe_subscription_id, plan_name, status, seats_allowed, current_period_end, created_at, updated_at, teams(id, name, created_at, owner_user_id)"
        )
        .order("created_at", { ascending: false });

      if (loadError) {
        setError("Unable to load subscriptions.");
        setIsLoading(false);
        return;
      }

      const mapped = (data ?? []).map((subscription) => {
        const team = Array.isArray(subscription.teams)
          ? subscription.teams[0]
          : subscription.teams;

        return {
          ...subscription,
          team_name: team?.name ?? null,
          owner_email:
            team?.owner_user_id === user?.id ? user?.email ?? null : null,
        };
      });

      setSubscriptions(mapped);
      setIsLoading(false);
    }

    loadSubscriptions();
  }, [isAuthorized, supabase, user?.email, user?.id]);

  function getEditable(subscription: SubscriptionRow): EditableSubscription {
    return (
      editingRows[subscription.id] ?? {
        plan_name: subscription.plan_name,
        seats_allowed: subscription.seats_allowed,
        status: subscription.status,
        current_period_end: subscription.current_period_end
          ? subscription.current_period_end.slice(0, 10)
          : "",
      }
    );
  }

  function updateEditing(id: string, updates: Partial<EditableSubscription>) {
    setEditingRows((prev) => ({
      ...prev,
      [id]: {
        ...getEditable(subscriptions.find((item) => item.id === id)!),
        ...updates,
      },
    }));
  }

  async function handleSave(subscription: SubscriptionRow) {
    setError(null);
    setSuccess(null);

    const editable = getEditable(subscription);

    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        plan_name: editable.plan_name,
        seats_allowed: editable.seats_allowed,
        status: editable.status,
        current_period_end: editable.current_period_end || null,
      })
      .eq("id", subscription.id);

    if (updateError) {
      setError("Failed to update subscription.");
      return;
    }

    setSubscriptions((prev) =>
      prev.map((item) =>
        item.id === subscription.id
          ? {
              ...item,
              ...editable,
              current_period_end: editable.current_period_end || null,
            }
          : item
      )
    );
    setSuccess("Subscription updated.");
  }

  async function handleStatusChange(subscription: SubscriptionRow, status: string) {
    updateEditing(subscription.id, { status });
    await handleSave({ ...subscription, status });
  }

  if (isLoading) {
    return <div className="text-slate-600">Loading subscriptions...</div>;
  }

  return (
    <div className="space-y-6">
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
                Plan name
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Seats allowed
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Status
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Period end
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {subscriptions.map((subscription) => {
              const editable = getEditable(subscription);

              return (
                <tr key={subscription.id}>
                  <td className="px-4 py-3">{subscription.team_name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {subscription.owner_email ?? "Unavailable"}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-full rounded-md border border-slate-200 px-2 py-1"
                      value={editable.plan_name}
                      onChange={(event) =>
                        updateEditing(subscription.id, {
                          plan_name: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      className="w-24 rounded-md border border-slate-200 px-2 py-1"
                      value={editable.seats_allowed}
                      min={0}
                      onChange={(event) =>
                        updateEditing(subscription.id, {
                          seats_allowed: Number(event.target.value || 0),
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-md border border-slate-200 px-2 py-1"
                      value={editable.status}
                      onChange={(event) =>
                        updateEditing(subscription.id, {
                          status: event.target.value,
                        })
                      }
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="canceled">canceled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="date"
                      className="rounded-md border border-slate-200 px-2 py-1"
                      value={editable.current_period_end}
                      onChange={(event) =>
                        updateEditing(subscription.id, {
                          current_period_end: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs"
                        onClick={() => handleSave(subscription)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-md border border-green-200 px-3 py-1 text-xs text-green-700"
                        onClick={() =>
                          handleStatusChange(subscription, "active")
                        }
                      >
                        Activate
                      </button>
                      <button
                        className="rounded-md border border-amber-200 px-3 py-1 text-xs text-amber-700"
                        onClick={() =>
                          handleStatusChange(subscription, "inactive")
                        }
                      >
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {subscriptions.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No subscriptions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

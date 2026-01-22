"use client";

export type AdminNavbarProps = {
  userEmail?: string | null;
};

export function AdminNavbar({ userEmail }: AdminNavbarProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Admin Console
        </h1>
        <p className="text-sm text-slate-500">
          Manage teams, subscriptions, and seats.
        </p>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {userEmail ?? "Unknown user"}
      </div>
    </header>
  );
}

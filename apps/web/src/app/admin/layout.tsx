"use client";

import { usePathname } from "next/navigation";

import { AdminNavbar } from "./components/AdminNavbar";
import { AdminSidebar } from "./components/AdminSidebar";
import { useAdminGuard } from "./lib/useAdminGuard";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { isLoading, isAuthorized, user, error } = useAdminGuard();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading admin console...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-red-600">
        {error}
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-md border border-slate-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-900">
            Access denied
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            You must be an admin or team owner to access these tools.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar activePath={pathname} />
      <div className="flex min-h-screen flex-1 flex-col">
        <AdminNavbar userEmail={user?.email} />
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

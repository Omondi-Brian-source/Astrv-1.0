"use client";

import Link from "next/link";

export type AdminSidebarProps = {
  activePath?: string;
};

export function AdminSidebar({ activePath }: AdminSidebarProps) {
  const navItems = [
    { label: "Teams", href: "/admin/teams" },
    { label: "Subscriptions", href: "/admin/subscriptions" },
    { label: "Seats", href: "/admin/seats" },
  ];

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <div className="text-lg font-semibold text-slate-900">Admin</div>
      <nav className="mt-6 flex flex-1 flex-col gap-2">
        {navItems.map((item) => {
          const isActive = activePath === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

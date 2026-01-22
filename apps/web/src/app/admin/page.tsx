import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  // Redirect /admin to the default admin landing page.
  redirect("/admin/teams");
}

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { demoStore } from "@/lib/demo-store";

export default function UsersPage() {
  const users = demoStore.getUsers();

  return (
    <AppShell title="Users" subtitle="Role-based access for Admin, Manager, Sales, Quality, Viewer">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {["Name", "Email", "Role", "Locale"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge variant="info">{u.role}</Badge>
                </td>
                <td className="px-4 py-3">{u.locale.toUpperCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

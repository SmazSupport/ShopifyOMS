"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface User { id: string; email: string; full_name: string | null; is_active: boolean; is_superuser: boolean; }

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", password: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const getToken = () => localStorage.getItem("oms_token");

  const fetchUsers = async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    const res = await fetch(`${API_URL}/auth/users`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { router.push("/login"); return; }
    if (res.status === 403) { router.push("/"); return; }
    setUsers(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleActive = async (user: User) => {
    const token = getToken();
    const action = user.is_active ? "deactivate" : "activate";
    await fetch(`${API_URL}/auth/users/${user.id}/${action}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` },
    });
    fetchUsers();
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setFormError("");
    const token = getToken();
    const res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const d = await res.json();
      setFormError(d.detail ?? "Error creating user");
    } else {
      setShowAdd(false);
      setForm({ email: "", full_name: "", password: "" });
      fetchUsers();
    }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Users</h1>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700">
            + Add User
          </button>
        </div>

        {showAdd && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md">
            <h2 className="font-semibold text-gray-900 mb-4">New User</h2>
            <form onSubmit={addUser} className="space-y-3">
              <input required type="email" placeholder="Email" value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="text" placeholder="Full name (optional)" value={form.full_name}
                onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input required type="password" placeholder="Password (min 8 chars)" value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={saving}
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Creating..." : "Create"}
                </button>
                <button type="button" onClick={() => setShowAdd(false)}
                  className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Name", "Email", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 ${!u.is_active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.is_superuser
                      ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Admin</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">User</span>}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active
                      ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(u)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      {u.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}

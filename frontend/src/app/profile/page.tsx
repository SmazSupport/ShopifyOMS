"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface User { email: string; full_name: string | null; is_superuser: boolean; }

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const getToken = () => localStorage.getItem("oms_token");

  useEffect(() => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { router.push("/login"); } return r.json(); })
      .then(setUser);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setMessage("");
    if (form.new_password !== form.confirm) { setError("New passwords do not match"); return; }
    if (form.new_password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setSaving(true);
    const token = getToken();
    const res = await fetch(`${API_URL}/auth/change-password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.detail ?? "Error updating password");
    else { setMessage("Password updated successfully"); setForm({ current_password: "", new_password: "", confirm: "" }); }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="max-w-lg space-y-6">
        <h1 className="text-xl font-bold text-gray-900">My Profile</h1>

        {user && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Account Info</h2>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Name</span>
              <span className="text-gray-900 font-medium">{user.full_name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-900">{user.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Role</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${user.is_superuser ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-700"}`}>
                {user.is_superuser ? "Admin" : "User"}
              </span>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide mb-4">Change Password</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input type="password" required value={form.current_password}
                onChange={(e) => setForm(f => ({ ...f, current_password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" required value={form.new_password}
                onChange={(e) => setForm(f => ({ ...f, new_password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" required value={form.confirm}
                onChange={(e) => setForm(f => ({ ...f, confirm: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            {message && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{message}</p>}
            <button type="submit" disabled={saving}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}

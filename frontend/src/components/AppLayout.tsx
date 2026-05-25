"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
}

const NAV = [
  { href: "/", label: "Status" },
  { href: "/orders", label: "Orders" },
  { href: "/products", label: "Products" },
  { href: "/data-studio", label: "Data Studio" },
  { href: "/users", label: "Users", superuser: true },
  { href: "/profile", label: "My Profile" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  const getToken = () => (typeof window !== "undefined" ? localStorage.getItem("oms_token") : null);

  const logout = () => {
    localStorage.removeItem("oms_token");
    router.push("/login");
  };

  useEffect(() => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { logout(); } return r.json(); })
      .then(setUser)
      .catch(() => router.push("/login"));
  }, []);

  const visibleNav = NAV.filter((n) => !n.superuser || user?.is_superuser);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <span className="font-bold text-gray-900 text-lg">OMS</span>
            <nav className="flex gap-1">
              {visibleNav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pathname === n.href
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user?.full_name ?? user?.email}</span>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-800 font-medium border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {children}
      </main>
    </div>
  );
}

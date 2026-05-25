"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface StatusData {
  api: string;
  database: string;
  db_error?: string;
  table_counts: Record<string, number>;
}

function StatusBadge({ value }: { value: string }) {
  const ok = value === "ok";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
        ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      {ok ? "Online" : "Error"}
    </span>
  );
}

export default function SystemStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string>("");

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setFetchError(null);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "Unknown error");
      setStatus(null);
    } finally {
      setLoading(false);
      setLastChecked(new Date().toLocaleTimeString());
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">OMS – System Status</h1>
          <p className="text-sm text-gray-500 mt-1">
            Auto-refreshes every 15s
            {lastChecked && ` · Last checked: ${lastChecked}`}
          </p>
        </div>

        {loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-500">
            Checking services...
          </div>
        )}

        {fetchError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
            <p className="font-semibold text-red-800">Cannot reach backend</p>
            <p className="text-sm text-red-600 mt-1">{API_URL}/status — {fetchError}</p>
          </div>
        )}

        {status && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Services</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Frontend</p>
                    <p className="text-sm text-gray-500">Next.js 15 · Port 3000</p>
                  </div>
                  <StatusBadge value="ok" />
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Backend API</p>
                    <p className="text-sm text-gray-500">FastAPI · Port 8000</p>
                  </div>
                  <StatusBadge value={status.api} />
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Database</p>
                    <p className="text-sm text-gray-500">PostgreSQL 16</p>
                    {status.db_error && (
                      <p className="text-xs text-red-500 mt-1">{status.db_error}</p>
                    )}
                  </div>
                  <StatusBadge value={status.database} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Database Tables</h2>
              <div className="grid grid-cols-3 gap-4">
                {Object.entries(status.table_counts).map(([table, count]) => (
                  <div key={table} className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-gray-900">{count}</p>
                    <p className="text-sm text-gray-500 mt-1 capitalize">{table.replace("_", " ")}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 font-mono">
                API endpoint: <span className="text-gray-600">{API_URL}/status</span>
              </p>
            </div>
          </div>
        )}

        <button
          onClick={fetchStatus}
          className="mt-6 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Refresh now
        </button>
      </div>
    </main>
  );
}

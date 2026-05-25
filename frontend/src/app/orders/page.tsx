"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Customer { first_name: string | null; last_name: string | null; email: string | null; }
interface Order {
  id: string; order_number: string | null; status: string;
  fulfillment_status: string | null; financial_status: string | null;
  total_price: number | null; currency: string | null; item_count: number;
  tags: string[] | null; created_at: string; customer: Customer | null;
}
interface Page { items: Order[]; total: number; page: number; page_size: number; total_pages: number; }

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800",
  fulfilled: "bg-green-100 text-green-800",
  on_hold: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800",
};
const FULFIL_COLORS: Record<string, string> = {
  unfulfilled: "bg-orange-100 text-orange-800",
  partial: "bg-yellow-100 text-yellow-800",
  fulfilled: "bg-green-100 text-green-800",
};

function Badge({ value, colors }: { value: string | null; colors: Record<string, string> }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>;
  const cls = colors[value] ?? "bg-gray-100 text-gray-700";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{value}</span>;
}

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const getToken = () => localStorage.getItem("oms_token");

  const fetchOrders = useCallback(async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: "50" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`${API_URL}/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { router.push("/login"); return; }
    setData(await res.json());
    setLoading(false);
  }, [page, search, statusFilter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Orders {data && <span className="text-gray-400 font-normal text-base">({data.total} total)</span>}</h1>
        </div>

        <div className="flex gap-3">
          <input
            type="text" placeholder="Search order #..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Order", "Customer", "Status", "Fulfillment", "Payment", "Items", "Total", "Date"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : data?.items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No orders found</td></tr>
              ) : data?.items.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{o.order_number ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {o.customer ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim() || o.customer.email : "—"}
                  </td>
                  <td className="px-4 py-3"><Badge value={o.status} colors={STATUS_COLORS} /></td>
                  <td className="px-4 py-3"><Badge value={o.fulfillment_status} colors={FULFIL_COLORS} /></td>
                  <td className="px-4 py-3 text-gray-600">{o.financial_status ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{o.item_count}</td>
                  <td className="px-4 py-3 text-gray-900 font-medium">
                    {o.total_price != null ? `$${o.total_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Page {data.page} of {data.total_pages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
              <button disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

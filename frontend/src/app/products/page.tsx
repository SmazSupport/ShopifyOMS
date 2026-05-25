"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Variant { id: string; sku: string | null; title: string | null; price: string | null; inventory_quantity: string | null; }
interface Product { id: string; title: string; handle: string | null; product_type: string | null; vendor: string | null; is_active: boolean; variant_count: number; variants: Variant[]; }
interface Page { items: Product[]; total: number; page: number; total_pages: number; }

export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const getToken = () => localStorage.getItem("oms_token");

  const fetchProducts = useCallback(async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: "50" });
    if (search) params.set("search", search);
    const res = await fetch(`${API_URL}/products?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { router.push("/login"); return; }
    setData(await res.json());
    setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            Products {data && <span className="text-gray-400 font-normal text-base">({data.total} total)</span>}
          </h1>
        </div>

        <div className="flex gap-3">
          <input
            type="text" placeholder="Search title or handle..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-8 px-4 py-3"></th>
                {["Title", "Handle", "Type", "Vendor", "Variants", "Status"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : data?.items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No products found</td></tr>
              ) : data?.items.map(p => (
                <>
                  <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(p.id)}>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {p.variants.length > 0 ? (expanded.has(p.id) ? "▼" : "▶") : ""}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{p.title}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.handle ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{p.product_type ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{p.vendor ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{p.variant_count}</td>
                    <td className="px-4 py-3">
                      {p.is_active
                        ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                        : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Inactive</span>}
                    </td>
                  </tr>
                  {expanded.has(p.id) && p.variants.map(v => (
                    <tr key={v.id} className="bg-blue-50 border-l-4 border-blue-200">
                      <td className="px-4 py-2"></td>
                      <td className="px-4 py-2 text-gray-500 text-xs pl-8" colSpan={2}>
                        ↳ {v.title ?? "Default Title"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        <span className="font-mono">{v.sku ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-600 text-xs">{v.price ? `$${parseFloat(v.price).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {v.inventory_quantity != null ? `${v.inventory_quantity} in stock` : "—"}
                      </td>
                      <td></td>
                    </tr>
                  ))}
                </>
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

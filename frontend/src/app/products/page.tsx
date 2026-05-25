"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────
interface Variant {
  id: string;
  shopify_variant_id: string | null;
  sku: string | null;
  title: string | null;
  price: number | null;
  inventory_quantity: number | null;
  metafields: { custom?: { bin_number?: string; bin_section?: string; bin_column?: number; bin_row?: string } } | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shipping_unit: number | null;
  weight: number | null;
  weight_unit: string | null;
}

interface Product {
  id: string;
  shopify_product_id: string | null;
  title: string;
  handle: string | null;
  product_type: string | null;
  vendor: string | null;
  status: string | null;
  is_active: boolean;
  variants: Variant[];
}

interface PageData { items: Product[]; total: number; page: number; page_size: number; total_pages: number; }

type Density = "compact" | "default" | "comfortable";

// ── Format helpers ───────────────────────────────────────────────
const fmt = (val: number | null) => val == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
const fmtNum = (val: number | null, decimals = 2) => val == null ? "—" : new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);

// ── Badge helpers ────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  draft: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  archived: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
};

const BIN_SECTION_COLORS: Record<string, string> = {
  A: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  B: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  C: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  D: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  E: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
  F: "bg-pink-50 text-pink-700 ring-1 ring-pink-200",
  G: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  H: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  I: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  J: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  S: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
};

function Badge({ value, colors }: { value: string; colors: Record<string, string> }) {
  const cls = colors[value] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${cls}`}>{value}</span>;
}

function BinBadge({ bin }: { bin: string | null }) {
  if (!bin) return <span className="text-gray-300 text-xs">—</span>;
  const section = bin[0];
  const colors = BIN_SECTION_COLORS[section] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${colors}`}>{bin}</span>;
}

// ── Main Component ─────────────────────────────────────────────
export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<Density>("default");

  const getToken = () => localStorage.getItem("oms_token");

  // Load preferences
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedDensity = localStorage.getItem("oms_products_density") as Density;
      if (savedDensity) setDensity(savedDensity);
    }
  }, []);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: "50" });
    if (search) params.set("search", search);
    try {
      const res = await fetch(`${API_URL}/products?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { router.push("/login"); return; }
      const json = await res.json();
      console.log("API Response:", json);
      if (json.items && json.items[0]?.variants) {
        console.log("First variant:", json.items[0].variants[0]);
      }
      setData(json);
    } catch (e) {
      console.error("Failed to fetch products:", e);
    }
    setLoading(false);
  }, [page, search, router]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Flatten products and variants into rows
  const rows = useMemo(() => {
    if (!data?.items) return [];
    const result: Array<{type: "product" | "variant", product: Product, variant?: Variant}> = [];
    data.items.forEach(product => {
      result.push({ type: "product", product });
      product.variants.forEach(variant => {
        result.push({ type: "variant", product, variant });
      });
    });
    return result;
  }, [data]);

  const py = density === "compact" ? "py-2" : density === "comfortable" ? "py-4" : "py-3";

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            Products & Variants
            {data && <span className="text-gray-400 font-normal text-base ml-2">({rows.length} rows)</span>}
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(["compact", "default", "comfortable"] as Density[]).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDensity(d); localStorage.setItem("oms_products_density", d); }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${density === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  title={d}
                >
                  {d === "compact" ? "≡" : d === "default" ? "≡≡" : "≡≡≡"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Variant</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Stock</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Bin</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Dimensions</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ship Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className={`px-4 ${py}`}><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    <p>No products found</p>
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const { type, product, variant } = row;
                  if (type === "product") {
                    // Product row
                    return (
                      <tr key={`p-${product.id}`} className="bg-gray-50/80 font-medium">
                        <td className={`px-4 ${py}`}>
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-[10px]">P</div>
                            <span className="text-gray-900">{product.title}</span>
                          </div>
                        </td>
                        <td className={`px-4 ${py}`}><span className="text-gray-500 text-xs">{product.product_type || "—"}</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}><span className="text-gray-400 text-xs">—</span></td>
                      </tr>
                    );
                  } else {
                    // Variant row
                    const v = variant!;
                    const qty = v.inventory_quantity ?? 0;
                    const stockColor = qty === 0 ? "text-red-600 bg-red-50" : qty < 10 ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
                    return (
                      <tr key={`v-${v.id}`} className="hover:bg-blue-50/30">
                        <td className={`px-4 ${py}`}>
                          <span className="text-gray-300 text-xs pl-4">• {product.title}</span>
                        </td>
                        <td className={`px-4 ${py}`}><span className="text-gray-300 text-xs">—</span></td>
                        <td className={`px-4 ${py}`}>
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[8px]">V</div>
                            <span className="text-gray-600 text-sm">{v.title || "Default"}</span>
                          </div>
                        </td>
                        <td className={`px-4 ${py}`}>
                          <span className="text-gray-700 text-xs font-mono bg-gray-50 px-1.5 py-0.5 rounded">{v.sku || "—"}</span>
                        </td>
                        <td className={`px-4 ${py}`}>
                          <span className="font-medium text-gray-900 tabular-nums">{fmt(v.price)}</span>
                        </td>
                        <td className={`px-4 ${py}`}>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums ${stockColor}`}>
                            {qty}
                          </span>
                        </td>
                        <td className={`px-4 ${py}`}>
                          <BinBadge bin={v.metafields?.custom?.bin_number || null} />
                        </td>
                        <td className={`px-4 ${py}`}>
                          <span className="text-gray-600 text-xs tabular-nums">
                            {fmtNum(v.length, 1)} × {fmtNum(v.width, 1)} × {fmtNum(v.height, 1)}
                          </span>
                        </td>
                        <td className={`px-4 ${py}`}>
                          {v.shipping_unit ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                              {v.shipping_unit}x
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  }
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Page {data.page} of {data.total_pages}</span>
            <div className="flex gap-2">
              <button 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button 
                disabled={page >= data.total_pages} 
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

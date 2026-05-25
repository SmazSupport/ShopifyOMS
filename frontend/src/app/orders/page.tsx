"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────
interface Customer { id: string; first_name: string | null; last_name: string | null; email: string | null; }
interface LineItem {
  id: string; sku: string | null; product_title: string | null; variant_title: string | null;
  name: string | null; quantity: number; price: number | null; fulfillment_status: string | null;
  requires_shipping: boolean; gift_card: boolean; properties: {name: string; value: string}[] | null;
}
interface Order {
  id: string; order_number: string | null; status: string;
  fulfillment_status: string | null; financial_status: string | null;
  total_price: number | null; subtotal_price: number | null; total_tax: number | null;
  total_discounts: number | null; currency: string | null; item_count: number;
  email: string | null; phone: string | null;
  tags: string[] | null; created_at: string; processed_at: string | null;
  customer: Customer | null; line_items: LineItem[];
  shipping_address: Record<string, string> | null;
  payment_gateway: string | null; source_name: string | null;
  discount_codes: {code: string; amount: string}[] | null;
  note: string | null;
  computed_fields?: Record<string, string | null>;
}
interface Page { items: Order[]; total: number; page: number; page_size: number; total_pages: number; }

interface ComputedFieldDef {
  key: string;
  output_field_key: string;
  output_field_label: string;
  source_field: string;
  transform_type: string;
}

// ── All available columns (static) ───────────────────────────────
const STATIC_COLUMNS = [
  { key: "order_number",       label: "Order #",        computed: false },
  { key: "customer",           label: "Customer",       computed: false },
  { key: "email",              label: "Email",          computed: false },
  { key: "status",             label: "Status",         computed: false },
  { key: "fulfillment_status", label: "Fulfillment",    computed: false },
  { key: "financial_status",   label: "Payment",        computed: false },
  { key: "total_price",        label: "Total",          computed: false },
  { key: "subtotal_price",     label: "Subtotal",       computed: false },
  { key: "total_tax",          label: "Tax",            computed: false },
  { key: "total_discounts",    label: "Discounts",      computed: false },
  { key: "item_count",         label: "Items",          computed: false },
  { key: "tags",               label: "Tags",           computed: false },
  { key: "payment_gateway",    label: "Gateway",        computed: false },
  { key: "source_name",        label: "Source",         computed: false },
  { key: "discount_codes",     label: "Discount Codes", computed: false },
  { key: "shipping_address",   label: "Ship To",        computed: false },
  { key: "note",               label: "Note",           computed: false },
  { key: "processed_at",       label: "Processed",      computed: false },
  { key: "created_at",         label: "Created",        computed: false },
];

const DEFAULT_COLS = ["order_number", "customer", "status", "fulfillment_status", "financial_status", "total_price", "item_count", "created_at"];

const LS_KEY = "oms_orders_columns";

// ── Badge helpers ────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800", fulfilled: "bg-green-100 text-green-800",
  on_hold: "bg-yellow-100 text-yellow-800", cancelled: "bg-red-100 text-red-800",
};
const FULFIL_COLORS: Record<string, string> = {
  unfulfilled: "bg-orange-100 text-orange-800", partial: "bg-yellow-100 text-yellow-800",
  fulfilled: "bg-green-100 text-green-800", null: "bg-gray-100 text-gray-500",
};
const FIN_COLORS: Record<string, string> = {
  paid: "bg-green-100 text-green-800", pending: "bg-yellow-100 text-yellow-800",
  refunded: "bg-red-100 text-red-700", voided: "bg-gray-100 text-gray-600",
};

function Badge({ value, colors }: { value: string | null; colors: Record<string, string> }) {
  if (!value) return <span className="text-gray-300 text-xs">—</span>;
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[value] ?? "bg-gray-100 text-gray-700"}`}>{value}</span>;
}

function fmt(val: number | null, currency = "USD") {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(val);
}

// ── Cell renderer ────────────────────────────────────────────────
function Cell({ col, order, computedDefs }: { col: string; order: Order; computedDefs: ComputedFieldDef[] }) {
  const compDef = computedDefs.find(d => `cf_${d.output_field_key}` === col);
  if (compDef) {
    const val = order.computed_fields?.[compDef.output_field_key] ?? null;
    return val
      ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800">{val}</span>
      : <span className="text-gray-300 text-xs">—</span>;
  }
  switch (col) {
    case "order_number": return <span className="font-semibold text-gray-900">{order.order_number ?? "—"}</span>;
    case "customer": return (
      <span className="text-gray-700">
        {order.customer
          ? (`${order.customer.first_name ?? ""} ${order.customer.last_name ?? ""}`.trim() || order.customer.email || "—")
          : (order.email ?? "—")}
      </span>
    );
    case "email": return <span className="text-gray-500 text-xs">{order.email ?? "—"}</span>;
    case "status": return <Badge value={order.status} colors={STATUS_COLORS} />;
    case "fulfillment_status": return <Badge value={order.fulfillment_status} colors={FULFIL_COLORS} />;
    case "financial_status": return <Badge value={order.financial_status} colors={FIN_COLORS} />;
    case "total_price": return <span className="font-medium text-gray-900">{fmt(order.total_price, order.currency ?? "USD")}</span>;
    case "subtotal_price": return <span className="text-gray-600">{fmt(order.subtotal_price, order.currency ?? "USD")}</span>;
    case "total_tax": return <span className="text-gray-600">{fmt(order.total_tax, order.currency ?? "USD")}</span>;
    case "total_discounts": return <span className="text-gray-600">{order.total_discounts ? `-${fmt(order.total_discounts, order.currency ?? "USD")}` : "—"}</span>;
    case "item_count": return <span className="text-gray-600">{order.item_count}</span>;
    case "tags": return order.tags?.length ? (
      <div className="flex flex-wrap gap-1">
        {order.tags.map((t: string) => <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{t}</span>)}
      </div>
    ) : <span className="text-gray-300 text-xs">—</span>;
    case "payment_gateway": return <span className="text-gray-500 text-xs">{order.payment_gateway ?? "—"}</span>;
    case "source_name": return <span className="text-gray-500 text-xs">{order.source_name ?? "—"}</span>;
    case "discount_codes": return order.discount_codes?.length ? (
      <div className="flex gap-1 flex-wrap">
        {order.discount_codes.map((d: {code: string; amount: string}) => (
          <span key={d.code} className="px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded text-xs font-mono">{d.code}</span>
        ))}
      </div>
    ) : <span className="text-gray-300 text-xs">—</span>;
    case "shipping_address": return order.shipping_address ? (
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {[order.shipping_address.city, order.shipping_address.province_code, order.shipping_address.country_code].filter(Boolean).join(", ")}
      </span>
    ) : <span className="text-gray-300 text-xs">—</span>;
    case "note": return order.note ? <span className="text-xs text-gray-500 max-w-[120px] truncate block">{order.note}</span> : <span className="text-gray-300 text-xs">—</span>;
    case "processed_at": return <span className="text-gray-500 text-xs whitespace-nowrap">{order.processed_at ? new Date(order.processed_at).toLocaleDateString() : "—"}</span>;
    case "created_at": return <span className="text-gray-500 text-xs whitespace-nowrap">{new Date(order.created_at).toLocaleDateString()}</span>;
    default: return <span className="text-gray-300 text-xs">—</span>;
  }
}

function buildAllColumns(computedDefs: ComputedFieldDef[]) {
  return [
    ...STATIC_COLUMNS,
    ...computedDefs.map(d => ({ key: `cf_${d.output_field_key}`, label: `⚡ ${d.output_field_label}`, computed: true })),
  ];
}

// ── Line items panel ─────────────────────────────────────────────
function LineItemsPanel({ items, currency }: { items: LineItem[]; currency: string | null }) {
  if (!items.length) return <div className="px-4 py-3 text-sm text-gray-400">No line items</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-gray-50">
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Item</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Variant</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Price</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Fulfillment</th>
          <th className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide">Flags</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {items.map(li => (
          <tr key={li.id} className="hover:bg-blue-50/30">
            <td className="px-4 py-2 font-mono text-gray-600">{li.sku ?? "—"}</td>
            <td className="px-4 py-2 text-gray-800 font-medium">{li.product_title ?? li.name ?? "—"}</td>
            <td className="px-4 py-2 text-gray-500">{li.variant_title && li.variant_title !== "Default Title" ? li.variant_title : "—"}</td>
            <td className="px-4 py-2 text-gray-700 font-medium">{li.quantity}</td>
            <td className="px-4 py-2 text-gray-700">{fmt(li.price, currency ?? "USD")}</td>
            <td className="px-4 py-2">
              {li.fulfillment_status
                ? <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${FULFIL_COLORS[li.fulfillment_status] ?? "bg-gray-100 text-gray-600"}`}>{li.fulfillment_status}</span>
                : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-4 py-2">
              <div className="flex gap-1">
                {li.gift_card && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">gift</span>}
                {!li.requires_shipping && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">no ship</span>}
                {li.properties?.map(p => (
                  <span key={p.name} className="px-1.5 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded text-xs" title={p.name}>{p.name}: {p.value}</span>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Column chooser panel ─────────────────────────────────────────
function ColumnChooser({
  visibleCols, onChange, onClose, allColumns,
}: {
  visibleCols: string[];
  onChange: (cols: string[]) => void;
  onClose: () => void;
  allColumns: { key: string; label: string; computed: boolean }[];
}) {
  const [local, setLocal] = useState(visibleCols);
  const dragIdx = useRef<number | null>(null);

  const toggle = (key: string) => {
    setLocal(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const onDragStart = (i: number) => { dragIdx.current = i; };
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    const next = [...local];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(i, 0, moved);
    dragIdx.current = i;
    setLocal(next);
  };

  const staticCols = allColumns.filter(c => !c.computed);
  const computedCols = allColumns.filter(c => c.computed);

  return (
    <div className="absolute right-0 top-10 z-30 bg-white border border-gray-200 rounded-xl shadow-xl w-72 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Columns</span>
        <div className="flex gap-2">
          <button onClick={() => { onChange(local); onClose(); }}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-medium">Apply</button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">✕</button>
        </div>
      </div>
      <p className="px-4 py-2 text-xs text-gray-400">Check to show · drag to reorder</p>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
        {staticCols.map((col, i) => (
          <div key={col.key} draggable={local.includes(col.key)}
            onDragStart={() => onDragStart(i)} onDragOver={(e) => onDragOver(e, i)}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none hover:bg-gray-50 ${local.includes(col.key) ? "" : "opacity-50"}`}
            onClick={() => toggle(col.key)}>
            <span className="text-gray-300 cursor-grab text-xs">⠿</span>
            <input type="checkbox" readOnly checked={local.includes(col.key)} className="w-4 h-4 rounded border-gray-300 text-blue-600 pointer-events-none" />
            <span className="text-sm text-gray-700">{col.label}</span>
          </div>
        ))}
        {computedCols.length > 0 && (
          <div className="px-4 py-2 bg-violet-50 border-t border-violet-100">
            <span className="text-xs font-semibold text-violet-600 uppercase tracking-wide">⚡ Computed Fields</span>
          </div>
        )}
        {computedCols.map((col, i) => (
          <div key={col.key} draggable={local.includes(col.key)}
            onDragStart={() => onDragStart(staticCols.length + i)} onDragOver={(e) => onDragOver(e, staticCols.length + i)}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none hover:bg-violet-50 ${local.includes(col.key) ? "" : "opacity-50"}`}
            onClick={() => toggle(col.key)}>
            <span className="text-gray-300 cursor-grab text-xs">⠿</span>
            <input type="checkbox" readOnly checked={local.includes(col.key)} className="w-4 h-4 rounded border-gray-300 text-violet-600 pointer-events-none" />
            <span className="text-sm text-violet-700">{col.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────
export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showColChooser, setShowColChooser] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const [computedDefs, setComputedDefs] = useState<ComputedFieldDef[]>([]);

  const getToken = () => localStorage.getItem("oms_token");
  const allColumns = buildAllColumns(computedDefs);

  // Load saved column prefs + computed field defs
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      try { setVisibleCols(JSON.parse(saved)); } catch {}
    }
    const token = getToken();
    if (!token) return;
    // Load column prefs
    fetch(`${API_URL}/settings/columns/order`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.column_order?.length) { setVisibleCols(d.column_order); localStorage.setItem(LS_KEY, JSON.stringify(d.column_order)); } })
      .catch(() => {});
    // Load active order-entity field transforms as computed columns
    fetch(`${API_URL}/rules/transforms?source_entity=order`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((transforms: ComputedFieldDef[]) => {
        setComputedDefs(transforms.filter((t: ComputedFieldDef) => t.output_field_key));
      })
      .catch(() => {});
  }, []);

  const saveColumns = useCallback((cols: string[]) => {
    setVisibleCols(cols);
    localStorage.setItem(LS_KEY, JSON.stringify(cols));
    const token = getToken();
    if (!token) return;
    fetch(`${API_URL}/settings/columns`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "order", column_order: cols }),
    }).catch(() => {});
  }, []);

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
  }, [page, search, statusFilter, router]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const colDefs = allColumns.filter(c => visibleCols.includes(c.key))
    .sort((a, b) => visibleCols.indexOf(a.key) - visibleCols.indexOf(b.key));

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            Orders {data && <span className="text-gray-400 font-normal text-base ml-1">({data.total.toLocaleString()})</span>}
          </h1>
          <div className="flex gap-2">
              <a href="/data-studio" className="text-xs text-gray-400 hover:text-blue-600 px-3 py-2">Data Studio</a>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text" placeholder="Search order #..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <div className="ml-auto relative">
            <button onClick={() => setShowColChooser(v => !v)}
              className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Columns ({visibleCols.length})
            </button>
            {showColChooser && (
              <ColumnChooser
                visibleCols={visibleCols}
                onChange={saveColumns}
                onClose={() => setShowColChooser(false)}
                allColumns={allColumns}
              />
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-8 px-2" />
                {colDefs.map(col => (
                  <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={colDefs.length + 1} className="text-center py-14 text-gray-400">Loading...</td></tr>
              ) : !data?.items.length ? (
                <tr><td colSpan={colDefs.length + 1} className="text-center py-14 text-gray-400">No orders found</td></tr>
              ) : data.items.map(order => (
                <>
                  <tr
                    key={order.id}
                    className={`hover:bg-gray-50 cursor-pointer ${expanded.has(order.id) ? "bg-blue-50/40" : ""}`}
                    onClick={() => toggleExpand(order.id)}
                  >
                    {/* Expand toggle */}
                    <td className="px-2 py-3 text-center">
                      <span className={`text-gray-400 text-xs transition-transform inline-block ${expanded.has(order.id) ? "rotate-90" : ""}`}>▶</span>
                    </td>
                    {colDefs.map(col => (
                      <td key={col.key} className="px-4 py-3">
                        <Cell col={col.key} order={order} computedDefs={computedDefs} />
                      </td>
                    ))}
                  </tr>
                  {expanded.has(order.id) && (
                    <tr key={`${order.id}-items`} className="bg-blue-50/20">
                      <td colSpan={colDefs.length + 1} className="p-0 border-t border-blue-100">
                        <div className="border-l-4 border-blue-400">
                          <LineItemsPanel items={order.line_items} currency={order.currency} />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Page {data.page} of {data.total_pages} · {data.total.toLocaleString()} orders</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

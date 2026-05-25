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
  requires_shipping: boolean; gift_card: boolean; properties: { name: string; value: string }[] | null;
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
  discount_codes: { code: string; amount: string }[] | null;
  note: string | null;
  computed_fields?: Record<string, string | null>;
}
interface Page { items: Order[]; total: number; page: number; page_size: number; total_pages: number; }
interface ComputedFieldDef {
  key: string; output_field_key: string; output_field_label: string;
  source_field: string; transform_type: string;
}

type SortDir = "asc" | "desc" | null;
type Density = "compact" | "default" | "comfortable";

// ── Column definitions ───────────────────────────────────────────
const STATIC_COLUMNS = [
  { key: "order_number",       label: "Order #",        group: "Identity",  sortable: true,  computed: false },
  { key: "customer",           label: "Customer",       group: "Identity",  sortable: false, computed: false },
  { key: "email",              label: "Email",          group: "Identity",  sortable: false, computed: false },
  { key: "status",             label: "Status",         group: "Status",    sortable: true,  computed: false },
  { key: "fulfillment_status", label: "Fulfillment",    group: "Status",    sortable: true,  computed: false },
  { key: "financial_status",   label: "Payment",        group: "Status",    sortable: true,  computed: false },
  { key: "total_price",        label: "Total",          group: "Financials", sortable: true, computed: false },
  { key: "subtotal_price",     label: "Subtotal",       group: "Financials", sortable: true, computed: false },
  { key: "total_tax",          label: "Tax",            group: "Financials", sortable: false, computed: false },
  { key: "total_discounts",    label: "Discounts",      group: "Financials", sortable: false, computed: false },
  { key: "item_count",         label: "Items",          group: "Details",   sortable: true,  computed: false },
  { key: "tags",               label: "Tags",           group: "Details",   sortable: false, computed: false },
  { key: "payment_gateway",    label: "Gateway",        group: "Details",   sortable: false, computed: false },
  { key: "source_name",        label: "Source",         group: "Details",   sortable: false, computed: false },
  { key: "discount_codes",     label: "Discount Codes", group: "Details",   sortable: false, computed: false },
  { key: "shipping_address",   label: "Ship To",        group: "Shipping",  sortable: false, computed: false },
  { key: "note",               label: "Note",           group: "Details",   sortable: false, computed: false },
  { key: "processed_at",       label: "Processed",      group: "Dates",     sortable: true,  computed: false },
  { key: "created_at",         label: "Created",        group: "Dates",     sortable: true,  computed: false },
];

const DEFAULT_COLS = ["order_number", "customer", "status", "fulfillment_status", "financial_status", "total_price", "item_count", "created_at"];
const LS_KEY = "oms_orders_columns_v2";
const LS_DENSITY = "oms_orders_density";

// ── Badge helpers ────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  open: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  cancelled: "bg-red-50 text-red-600 ring-1 ring-red-200",
};
const FULFIL_COLORS: Record<string, string> = {
  unfulfilled: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  partial: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};
const FIN_COLORS: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  refunded: "bg-red-50 text-red-600 ring-1 ring-red-200",
  voided: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
};

function Badge({ value, colors }: { value: string | null; colors: Record<string, string> }) {
  if (!value) return <span className="text-gray-300 text-xs select-none">—</span>;
  const cls = colors[value] ?? "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${cls}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

function fmt(val: number | null, currency = "USD") {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(val);
}

function fmtDate(val: string | null, relative = false) {
  if (!val) return "—";
  const d = new Date(val);
  if (relative) {
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Cell renderer ────────────────────────────────────────────────
function Cell({ col, order, computedDefs }: { col: string; order: Order; computedDefs: ComputedFieldDef[] }) {
  const compDef = computedDefs.find(d => `cf_${d.output_field_key}` === col);
  if (compDef) {
    const val = order.computed_fields?.[compDef.output_field_key] ?? null;
    return val
      ? <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200">{val}</span>
      : <span className="text-gray-300 text-xs select-none">—</span>;
  }
  switch (col) {
    case "order_number":
      return (
        <span className="font-semibold text-gray-900 tabular-nums">
          {order.order_number ? `#${order.order_number}` : "—"}
        </span>
      );
    case "customer":
      return (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(order.customer?.first_name?.[0] ?? order.email?.[0] ?? "?").toUpperCase()}
          </div>
          <span className="text-gray-800 text-sm truncate">
            {order.customer
              ? (`${order.customer.first_name ?? ""} ${order.customer.last_name ?? ""}`.trim() || order.customer.email || "—")
              : (order.email ?? "—")}
          </span>
        </div>
      );
    case "email": return <span className="text-gray-500 text-xs">{order.email ?? "—"}</span>;
    case "status": return <Badge value={order.status} colors={STATUS_COLORS} />;
    case "fulfillment_status": return <Badge value={order.fulfillment_status} colors={FULFIL_COLORS} />;
    case "financial_status": return <Badge value={order.financial_status} colors={FIN_COLORS} />;
    case "total_price":
      return <span className="font-semibold text-gray-900 tabular-nums">{fmt(order.total_price, order.currency ?? "USD")}</span>;
    case "subtotal_price":
      return <span className="text-gray-600 tabular-nums text-sm">{fmt(order.subtotal_price, order.currency ?? "USD")}</span>;
    case "total_tax":
      return <span className="text-gray-500 tabular-nums text-sm">{fmt(order.total_tax, order.currency ?? "USD")}</span>;
    case "total_discounts":
      return <span className="text-emerald-600 tabular-nums text-sm">{order.total_discounts ? `-${fmt(order.total_discounts, order.currency ?? "USD")}` : "—"}</span>;
    case "item_count":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold tabular-nums">
          {order.item_count}
        </span>
      );
    case "tags":
      return order.tags?.length ? (
        <div className="flex flex-wrap gap-1 max-w-[180px]">
          {order.tags.slice(0, 3).map((t: string) => (
            <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{t}</span>
          ))}
          {order.tags.length > 3 && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">+{order.tags.length - 3}</span>
          )}
        </div>
      ) : <span className="text-gray-300 text-xs select-none">—</span>;
    case "payment_gateway":
      return <span className="text-gray-500 text-xs capitalize">{order.payment_gateway?.replace(/_/g, " ") ?? "—"}</span>;
    case "source_name":
      return <span className="text-gray-500 text-xs">{order.source_name ?? "—"}</span>;
    case "discount_codes":
      return order.discount_codes?.length ? (
        <div className="flex gap-1 flex-wrap">
          {order.discount_codes.map((d: { code: string; amount: string }) => (
            <span key={d.code} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-mono">{d.code}</span>
          ))}
        </div>
      ) : <span className="text-gray-300 text-xs select-none">—</span>;
    case "shipping_address":
      return order.shipping_address ? (
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {[order.shipping_address.city, order.shipping_address.province_code, order.shipping_address.country_code].filter(Boolean).join(", ")}
        </span>
      ) : <span className="text-gray-300 text-xs select-none">—</span>;
    case "note":
      return order.note
        ? <span className="text-xs text-gray-500 max-w-[140px] truncate block" title={order.note}>{order.note}</span>
        : <span className="text-gray-300 text-xs select-none">—</span>;
    case "processed_at":
      return <span className="text-gray-500 text-xs whitespace-nowrap tabular-nums" title={order.processed_at ?? ""}>{fmtDate(order.processed_at, true)}</span>;
    case "created_at":
      return <span className="text-gray-500 text-xs whitespace-nowrap tabular-nums" title={order.created_at}>{fmtDate(order.created_at, true)}</span>;
    default: return <span className="text-gray-300 text-xs select-none">—</span>;
  }
}

function buildAllColumns(computedDefs: ComputedFieldDef[]) {
  return [
    ...STATIC_COLUMNS,
    ...computedDefs.map(d => ({ key: `cf_${d.output_field_key}`, label: `⚡ ${d.output_field_label}`, group: "Computed", sortable: false, computed: true })),
  ];
}

// ── Skeleton loader ──────────────────────────────────────────────
function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="w-10 px-3 py-3"><div className="w-4 h-4 bg-gray-100 rounded animate-pulse" /></td>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-3.5 bg-gray-100 rounded animate-pulse ${i === 0 ? "w-16" : i === 1 ? "w-28" : i % 3 === 0 ? "w-20" : "w-14"}`} />
        </td>
      ))}
    </tr>
  );
}

// ── Line items drawer ────────────────────────────────────────────
function LineItemsPanel({ items, currency }: { items: LineItem[]; currency: string | null }) {
  if (!items.length) return <div className="px-6 py-4 text-sm text-gray-400 italic">No line items</div>;
  return (
    <div className="px-2 pb-2 pt-1">
      <div className="rounded-lg border border-blue-100 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">SKU</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Item</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Variant</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Qty</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Unit Price</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Line Total</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Fulfillment</th>
              <th className="text-left px-4 py-2.5 font-semibold text-blue-700 uppercase tracking-wider text-[10px]">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-50 bg-white">
            {items.map((li, idx) => (
              <tr key={li.id} className={`hover:bg-blue-50/40 transition-colors ${idx % 2 === 1 ? "bg-slate-50/50" : ""}`}>
                <td className="px-4 py-2.5 font-mono text-gray-600 text-[11px] whitespace-nowrap">{li.sku ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-gray-800 font-medium max-w-[200px]">
                  <span className="truncate block" title={li.product_title ?? li.name ?? ""}>{li.product_title ?? li.name ?? "—"}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-500">{li.variant_title && li.variant_title !== "Default Title" ? li.variant_title : <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-800 tabular-nums">{li.quantity}</td>
                <td className="px-4 py-2.5 text-gray-600 tabular-nums">{fmt(li.price, currency ?? "USD")}</td>
                <td className="px-4 py-2.5 text-gray-800 font-medium tabular-nums">{li.price != null ? fmt(li.price * li.quantity, currency ?? "USD") : "—"}</td>
                <td className="px-4 py-2.5">
                  {li.fulfillment_status
                    ? <Badge value={li.fulfillment_status} colors={FULFIL_COLORS} />
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {li.gift_card && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-medium">Gift</span>}
                    {!li.requires_shipping && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">No Ship</span>}
                    {li.properties?.map(p => (
                      <span key={p.name} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px]" title={`${p.name}: ${p.value}`}>{p.name}: {p.value}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sort indicator ───────────────────────────────────────────────
function SortIcon({ dir }: { dir: SortDir }) {
  if (!dir) return (
    <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
  return dir === "asc" ? (
    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ── Column chooser panel ─────────────────────────────────────────
function ColumnChooser({
  visibleCols, onChange, onClose, allColumns,
}: {
  visibleCols: string[];
  onChange: (cols: string[]) => void;
  onClose: () => void;
  allColumns: { key: string; label: string; group: string; computed: boolean }[];
}) {
  const [local, setLocal] = useState(visibleCols);
  const [search, setSearch] = useState("");
  const dragKey = useRef<string | null>(null);
  const dragOverKey = useRef<string | null>(null);

  const toggle = (key: string) =>
    setLocal(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const onDragStart = (key: string) => { dragKey.current = key; };
  const onDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    dragOverKey.current = key;
  };
  const onDrop = () => {
    if (!dragKey.current || dragKey.current === dragOverKey.current) return;
    const from = dragKey.current;
    const to = dragOverKey.current;
    if (!to) return;
    setLocal(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
    dragKey.current = null;
    dragOverKey.current = null;
  };

  const groups = [...new Set(allColumns.map(c => c.group))];
  const filtered = allColumns.filter(c =>
    !search || c.label.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = local.length;

  return (
    <div className="absolute right-0 top-11 z-40 bg-white border border-gray-200 rounded-xl shadow-2xl w-80 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-gray-900">Manage Columns</span>
          <p className="text-xs text-gray-400 mt-0.5">{activeCount} of {allColumns.length} shown</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { onChange(local); onClose(); }}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-medium transition-colors">
            Apply
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-md transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search columns..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="px-3 py-1.5 flex gap-2 border-b border-gray-100">
        <button onClick={() => setLocal(allColumns.map(c => c.key))} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">Select all</button>
        <span className="text-gray-300">|</span>
        <button onClick={() => setLocal(DEFAULT_COLS)} className="text-xs text-gray-500 hover:text-gray-700 hover:underline">Reset</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {groups.map(group => {
          const cols = filtered.filter(c => c.group === group);
          if (!cols.length) return null;
          return (
            <div key={group}>
              <div className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest ${group === "Computed" ? "text-violet-500 bg-violet-50" : "text-gray-400 bg-gray-50"}`}>
                {group}
              </div>
              {cols.map(col => (
                <div
                  key={col.key}
                  draggable={local.includes(col.key)}
                  onDragStart={() => onDragStart(col.key)}
                  onDragOver={(e) => onDragOver(e, col.key)}
                  onDrop={onDrop}
                  onClick={() => toggle(col.key)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors
                    ${local.includes(col.key) ? "hover:bg-blue-50" : "opacity-50 hover:opacity-75 hover:bg-gray-50"}`}
                >
                  {local.includes(col.key) && (
                    <svg className="w-3.5 h-3.5 text-gray-300 cursor-grab flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                    </svg>
                  )}
                  {!local.includes(col.key) && <span className="w-3.5 h-3.5 flex-shrink-0" />}
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
                    ${local.includes(col.key) ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white"}`}>
                    {local.includes(col.key) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm ${col.computed ? "text-violet-700" : "text-gray-700"}`}>{col.label}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter chip ──────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium ring-1 ring-blue-200">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 ml-0.5">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

// ── Density control ──────────────────────────────────────────────
const DENSITY_CONFIG: Record<Density, { label: string; rowPy: string; headerPy: string }> = {
  compact:     { label: "Compact",     rowPy: "py-1.5", headerPy: "py-2" },
  default:     { label: "Default",     rowPy: "py-3",   headerPy: "py-3" },
  comfortable: { label: "Comfortable", rowPy: "py-4",   headerPy: "py-4" },
};

// ── Main page ────────────────────────────────────────────────────
export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("");
  const [financialFilter, setFinancialFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showColChooser, setShowColChooser] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const [computedDefs, setComputedDefs] = useState<ComputedFieldDef[]>([]);
  const [sortKey, setSortKey] = useState<string | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [density, setDensity] = useState<Density>("default");
  const [showDensity, setShowDensity] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const getToken = () => localStorage.getItem("oms_token");
  const allColumns = buildAllColumns(computedDefs);
  const dc = DENSITY_CONFIG[density];

  // Load prefs
  useEffect(() => {
    const savedCols = localStorage.getItem(LS_KEY);
    if (savedCols) { try { setVisibleCols(JSON.parse(savedCols)); } catch {} }
    const savedDensity = localStorage.getItem(LS_DENSITY);
    if (savedDensity && savedDensity in DENSITY_CONFIG) setDensity(savedDensity as Density);

    const token = getToken();
    if (!token) return;
    fetch(`${API_URL}/settings/columns/order`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.column_order?.length) { setVisibleCols(d.column_order); localStorage.setItem(LS_KEY, JSON.stringify(d.column_order)); } })
      .catch(() => {});
    fetch(`${API_URL}/rules/transforms?source_entity=order`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((transforms: ComputedFieldDef[]) => { setComputedDefs(transforms.filter((t: ComputedFieldDef) => t.output_field_key)); })
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
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (fulfillmentFilter) params.set("fulfillment_status", fulfillmentFilter);
    if (financialFilter) params.set("financial_status", financialFilter);
    const res = await fetch(`${API_URL}/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { router.push("/login"); return; }
    setData(await res.json());
    setLoading(false);
  }, [page, pageSize, search, statusFilter, fulfillmentFilter, financialFilter, router]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Ctrl+F to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : d === "desc" ? null : "asc");
      if (sortDir === null) setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const colDefs = allColumns
    .filter(c => visibleCols.includes(c.key))
    .sort((a, b) => visibleCols.indexOf(a.key) - visibleCols.indexOf(b.key));

  // Client-side sort (backend doesn't support sort yet, so we sort locally)
  const sortedItems = data?.items ? [...data.items].sort((a, b) => {
    if (!sortKey || !sortDir) return 0;
    let av: string | number | null = null;
    let bv: string | number | null = null;
    if (sortKey === "order_number") { av = a.order_number ?? ""; bv = b.order_number ?? ""; }
    else if (sortKey === "total_price") { av = a.total_price; bv = b.total_price; }
    else if (sortKey === "item_count") { av = a.item_count; bv = b.item_count; }
    else if (sortKey === "created_at") { av = a.created_at; bv = b.created_at; }
    else if (sortKey === "processed_at") { av = a.processed_at; bv = b.processed_at; }
    else if (sortKey === "status") { av = a.status; bv = b.status; }
    else if (sortKey === "fulfillment_status") { av = a.fulfillment_status; bv = b.fulfillment_status; }
    else if (sortKey === "financial_status") { av = a.financial_status; bv = b.financial_status; }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  }) : [];

  const activeFilterCount = [statusFilter, fulfillmentFilter, financialFilter].filter(Boolean).length;

  return (
    <AppLayout>
      <div className="flex flex-col h-full gap-0">
        {/* ── Page header ── */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-none">Orders</h1>
              {data && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {data.total.toLocaleString()} total · page {data.page} of {data.total_pages}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Density picker */}
            <div className="relative">
              <button
                onClick={() => setShowDensity(v => !v)}
                title="Row density"
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="text-xs text-gray-500 hidden sm:inline">{dc.label}</span>
              </button>
              {showDensity && (
                <div className="absolute right-0 top-10 z-40 bg-white border border-gray-200 rounded-xl shadow-xl w-40 py-1 overflow-hidden">
                  {(Object.keys(DENSITY_CONFIG) as Density[]).map(d => (
                    <button key={d} onClick={() => { setDensity(d); localStorage.setItem(LS_DENSITY, d); setShowDensity(false); }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${density === d ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-gray-50 text-gray-700"}`}>
                      {DENSITY_CONFIG[d].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a href="/data-studio" className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline text-xs">Data Studio</span>
            </a>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="flex gap-2 flex-wrap items-center pb-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchRef}
              type="text" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search orders… (Ctrl+F)"
              className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
            {search && (
              <button onClick={() => { setSearch(""); setPage(1); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filter button */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${showFilters || activeFilterCount > 0 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 hover:bg-gray-50 text-gray-700"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 w-4 h-4 bg-blue-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>

          {/* Active filter chips */}
          {statusFilter && <FilterChip label={`Status: ${statusFilter.replace(/_/g, " ")}`} onRemove={() => { setStatusFilter(""); setPage(1); }} />}
          {fulfillmentFilter && <FilterChip label={`Fulfillment: ${fulfillmentFilter.replace(/_/g, " ")}`} onRemove={() => { setFulfillmentFilter(""); setPage(1); }} />}
          {financialFilter && <FilterChip label={`Payment: ${financialFilter.replace(/_/g, " ")}`} onRemove={() => { setFinancialFilter(""); setPage(1); }} />}
          {activeFilterCount > 1 && (
            <button onClick={() => { setStatusFilter(""); setFulfillmentFilter(""); setFinancialFilter(""); setPage(1); }} className="text-xs text-red-500 hover:text-red-700 hover:underline">Clear all</button>
          )}

          {/* Right side controls */}
          <div className="ml-auto flex items-center gap-2">
            {/* Page size */}
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={200}>200 / page</option>
            </select>

            {/* Column chooser */}
            <div className="relative">
              <button
                onClick={() => setShowColChooser(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${showColChooser ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 hover:bg-gray-50 text-gray-700"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Columns
                <span className="text-xs text-gray-400">{visibleCols.length}</span>
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
        </div>

        {/* ── Filter panel ── */}
        {showFilters && (
          <div className="flex gap-3 flex-wrap items-end pb-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 mb-1">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Order Status</label>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All</option>
                <option value="open">Open</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="on_hold">On Hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Fulfillment</label>
              <select value={fulfillmentFilter} onChange={e => { setFulfillmentFilter(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All</option>
                <option value="unfulfilled">Unfulfilled</option>
                <option value="partial">Partial</option>
                <option value="fulfilled">Fulfilled</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Payment</label>
              <select value={financialFilter} onChange={e => { setFinancialFilter(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
                <option value="voided">Voided</option>
              </select>
            </div>
            <button onClick={() => { setStatusFilter(""); setFulfillmentFilter(""); setFinancialFilter(""); setPage(1); }}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg hover:border-red-200 transition-colors">
              Clear filters
            </button>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-3" />
                  {colDefs.map(col => (
                    <th key={col.key}
                      className={`text-left px-4 ${dc.headerPy} text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap select-none
                        ${col.sortable ? "cursor-pointer hover:text-gray-800 hover:bg-gray-100 group transition-colors" : ""}`}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1.5">
                        {col.computed && <span className="text-violet-400">⚡</span>}
                        {col.label.replace(/^⚡ /, "")}
                        {col.sortable && <SortIcon dir={sortKey === col.key ? sortDir : null} />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={colDefs.length} />)
                ) : !sortedItems.length ? (
                  <tr>
                    <td colSpan={colDefs.length + 1}>
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <svg className="w-12 h-12 text-gray-200 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-gray-500 font-medium">No orders found</p>
                        <p className="text-gray-400 text-xs mt-1">Try adjusting your search or filters</p>
                      </div>
                    </td>
                  </tr>
                ) : sortedItems.map((order, rowIdx) => (
                  <>
                    <tr
                      key={order.id}
                      onClick={() => toggleExpand(order.id)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors group
                        ${expanded.has(order.id)
                          ? "bg-blue-50/60"
                          : rowIdx % 2 === 0 ? "bg-white hover:bg-gray-50/80" : "bg-gray-50/40 hover:bg-gray-100/60"}`}
                    >
                      <td className={`px-3 ${dc.rowPy} text-center w-10`}>
                        <div className={`inline-flex items-center justify-center w-5 h-5 rounded transition-transform ${expanded.has(order.id) ? "rotate-90 text-blue-500" : "text-gray-300 group-hover:text-gray-500"}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </td>
                      {colDefs.map(col => (
                        <td key={col.key} className={`px-4 ${dc.rowPy} max-w-[220px]`}>
                          <Cell col={col.key} order={order} computedDefs={computedDefs} />
                        </td>
                      ))}
                    </tr>
                    {expanded.has(order.id) && (
                      <tr key={`${order.id}-items`} className="bg-blue-50/30 border-b border-blue-100">
                        <td colSpan={colDefs.length + 1} className="border-l-4 border-blue-400">
                          <LineItemsPanel items={order.line_items} currency={order.currency} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ── */}
        {data && (
          <div className="flex items-center justify-between pt-3 text-sm">
            <span className="text-xs text-gray-500">
              Showing {((data.page - 1) * data.page_size) + 1}–{Math.min(data.page * data.page_size, data.total)} of {data.total.toLocaleString()} orders
            </span>
            {data.total_pages > 1 && (
              <div className="flex items-center gap-1">
                <button disabled={page === 1} onClick={() => setPage(1)}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-xs text-gray-600 transition-colors">«</button>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-xs text-gray-600 transition-colors">← Prev</button>
                <span className="px-3 py-1.5 text-xs text-gray-600 font-medium bg-blue-50 rounded-lg border border-blue-200 text-blue-700">
                  {data.page} / {data.total_pages}
                </span>
                <button disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-xs text-gray-600 transition-colors">Next →</button>
                <button disabled={page >= data.total_pages} onClick={() => setPage(data.total_pages)}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-xs text-gray-600 transition-colors">»</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

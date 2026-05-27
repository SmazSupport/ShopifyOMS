"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─────────────────────────────────────────────────────────────
// FILTER BUILDER TYPES & CONFIG
// ─────────────────────────────────────────────────────────────
type FilterOp = "=" | "!=" | "contains" | "not_contains" | ">" | "<" | ">=" | "<=" | "is_empty" | "is_not_empty";

interface FilterRow {
  id: string;
  field: string;
  op: FilterOp;
  value: string;
}

const FILTER_FIELDS = [
  // Order fields
  { key: "order_number",       label: "Order #",          type: "text",   group: "Order" },
  { key: "status",             label: "Status",           type: "select", group: "Order", options: ["open","fulfilled","on_hold","cancelled"] },
  { key: "fulfillment_status", label: "Fulfillment",      type: "select", group: "Order", options: ["unfulfilled","partial","fulfilled"] },
  { key: "financial_status",   label: "Payment",          type: "select", group: "Order", options: ["paid","pending","refunded","voided"] },
  { key: "total_price",        label: "Total ($)",        type: "number", group: "Order" },
  { key: "item_count",         label: "Item Count",       type: "number", group: "Order" },
  { key: "email",              label: "Email",            type: "text",   group: "Order" },
  { key: "tags",               label: "Tags",             type: "text",   group: "Order" },
  { key: "payment_gateway",    label: "Gateway",          type: "text",   group: "Order" },
  { key: "source_name",        label: "Source",           type: "text",   group: "Order" },
  { key: "note",               label: "Note",             type: "text",   group: "Order" },
  { key: "created_at",         label: "Created",          type: "date",   group: "Order" },
  { key: "processed_at",       label: "Processed",        type: "date",   group: "Order" },
  // Customer fields
  { key: "customer_name",      label: "Customer Name",    type: "text",   group: "Customer" },
  { key: "customer_email",     label: "Customer Email",   type: "text",   group: "Customer" },
  // Line item fields
  { key: "li_sku",             label: "Line Item SKU",    type: "text",   group: "Line Items" },
  { key: "li_product",         label: "Product Title",    type: "text",   group: "Line Items" },
  { key: "li_variant",         label: "Variant",          type: "text",   group: "Line Items" },
  { key: "li_qty",             label: "Quantity",         type: "number", group: "Line Items" },
  { key: "li_price",           label: "Line Item Price",  type: "number", group: "Line Items" },
  { key: "li_fulfillment",     label: "LI Fulfillment",   type: "select", group: "Line Items", options: ["unfulfilled","partial","fulfilled"] },
] as const;

type FilterFieldKey = typeof FILTER_FIELDS[number]["key"];

const OPS_FOR_TYPE: Record<string, FilterOp[]> = {
  text:   ["contains", "not_contains", "=", "!=", "is_empty", "is_not_empty"],
  select: ["=", "!=", "is_empty", "is_not_empty"],
  number: ["=", "!=", ">", "<", ">=", "<=", "is_empty", "is_not_empty"],
  date:   [">", "<", ">=", "<=", "is_empty", "is_not_empty"],
};

const OP_LABEL: Record<FilterOp, string> = {
  "=": "is",
  "!=": "is not",
  "contains": "contains",
  "not_contains": "does not contain",
  ">": "greater than",
  "<": "less than",
  ">=": "≥",
  "<=": "≤",
  "is_empty": "is empty",
  "is_not_empty": "is not empty",
};

function getOrderVal(order: Order, field: string): string | number | null {
  switch (field) {
    case "order_number":       return order.order_number;
    case "status":             return order.status;
    case "fulfillment_status": return order.fulfillment_status;
    case "financial_status":   return order.financial_status;
    case "total_price":        return order.total_price;
    case "item_count":         return order.item_count;
    case "email":              return order.email;
    case "tags":               return (order.tags ?? []).join(",");
    case "payment_gateway":    return order.payment_gateway;
    case "source_name":        return order.source_name;
    case "note":               return order.note;
    case "created_at":         return order.created_at;
    case "processed_at":       return order.processed_at;
    case "customer_name":
      return order.customer
        ? `${order.customer.first_name ?? ""} ${order.customer.last_name ?? ""}`.trim()
        : null;
    case "customer_email":     return order.customer?.email ?? null;
    default:                   return null;
  }
}

function matchesFilter(order: Order, row: FilterRow): boolean {
  const fd = FILTER_FIELDS.find(f => f.key === row.field);
  if (!fd) return true;

  const isLineItemField = fd.group === "Line Items";

  if (isLineItemField) {
    // For line item fields: the order matches if ANY line item satisfies the condition
    return order.line_items.some(li => {
      const val = getLiVal(li, row.field);
      return evalOp(val, row.op, row.value, fd.type as string);
    });
  }

  const val = getOrderVal(order, row.field);
  return evalOp(val, row.op, row.value, fd.type as string);
}

function getLiVal(li: LineItem, field: string): string | number | null {
  switch (field) {
    case "li_sku":        return li.sku;
    case "li_product":    return li.product_title ?? li.name;
    case "li_variant":    return li.variant_title;
    case "li_qty":        return li.quantity;
    case "li_price":      return li.price;
    case "li_fulfillment":return li.fulfillment_status;
    default:              return null;
  }
}

function evalOp(val: string | number | null, op: FilterOp, target: string, type: string): boolean {
  if (op === "is_empty")     return val == null || String(val).trim() === "";
  if (op === "is_not_empty") return val != null && String(val).trim() !== "";
  if (val == null)           return false;

  if (type === "number") {
    const n = Number(val);
    const t = Number(target);
    if (isNaN(n) || isNaN(t)) return false;
    switch (op) {
      case "=":  return n === t;
      case "!=": return n !== t;
      case ">":  return n > t;
      case "<":  return n < t;
      case ">=": return n >= t;
      case "<=": return n <= t;
    }
  }

  if (type === "date") {
    const d  = new Date(String(val)).getTime();
    const dt = new Date(target).getTime();
    if (isNaN(d) || isNaN(dt)) return false;
    switch (op) {
      case ">":  return d > dt;
      case "<":  return d < dt;
      case ">=": return d >= dt;
      case "<=": return d <= dt;
      case "=":  return d === dt;
      case "!=": return d !== dt;
    }
  }

  const sv = String(val).toLowerCase();
  const tv = target.toLowerCase();
  switch (op) {
    case "=":            return sv === tv;
    case "!=":           return sv !== tv;
    case "contains":     return sv.includes(tv);
    case "not_contains": return !sv.includes(tv);
    default:             return true;
  }
}

// ── Types ────────────────────────────────────────────────────────
interface Customer { id: string; first_name: string | null; last_name: string | null; email: string | null; }
interface LineItem {
  id: string; sku: string | null; product_title: string | null; variant_title: string | null;
  name: string | null; quantity: number; price: number | null; fulfillment_status: string | null;
  requires_shipping: boolean; gift_card: boolean; properties: { name: string; value: string }[] | null;
  grams: number | null; vendor: string | null; product_type: string | null;
  total_discount: number | null; extra_attributes: Record<string, unknown> | null;
  computed_fields: Record<string, string | null> | null;
  custom_fields: Record<string, unknown> | null;
}
interface RegistryField {
  key: string; name: string; field_type: string; source: string; description: string | null;
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
const LS_LI_COLS = "oms_li_columns_v1";

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
// ── Dynamic line item cell renderer ─────────────────────────────
function LiCell({ field, li, currency }: { field: RegistryField; li: LineItem; currency: string }) {
  const dash = <span className="text-gray-200">—</span>;

  // Computed fields (from Data Studio transforms / DerivedFieldValues)
  if (field.source === "computed") {
    const key = field.key.replace(/^cf_/, "");
    const v = li.computed_fields?.[key]
      ?? li.computed_fields?.[field.key]
      ?? li.custom_fields?.[key]
      ?? li.custom_fields?.[field.key];
    if (v == null) return dash;
    return <span className="px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded text-[10px] font-medium ring-1 ring-violet-100">{String(v)}</span>;
  }

  // Custom fields (from CustomFieldValues)
  if (field.source === "shopify_metafield") {
    const v = li.custom_fields?.[field.key];
    if (v == null) return dash;
    return <span className="text-gray-600 text-[10px]">{String(v)}</span>;
  }

  // Native fields
  const cur = currency ?? "USD";
  switch (field.key) {
    case "sku":              return <span className="font-mono text-gray-500 text-[10px]">{li.sku ?? dash}</span>;
    case "product_title":   return <span className="text-gray-800 font-medium text-[11px] truncate block max-w-[200px]" title={li.product_title ?? ""}>{li.product_title ?? li.name ?? "—"}</span>;
    case "variant_title":   return li.variant_title && li.variant_title !== "Default Title" ? <span className="text-gray-400 text-[10px]">{li.variant_title}</span> : dash;
    case "quantity":        return <span className="font-semibold text-gray-700 tabular-nums">{li.quantity}</span>;
    case "price":           return <span className="text-gray-500 tabular-nums">{fmt(li.price, cur)}</span>;
    case "total_discount":  return li.total_discount ? <span className="text-emerald-600 tabular-nums">-{fmt(li.total_discount, cur)}</span> : dash;
    case "grams":           return li.grams ? <span className="text-gray-500 tabular-nums">{li.grams}g</span> : dash;
    case "vendor":          return <span className="text-gray-500 text-[10px]">{li.vendor ?? dash}</span>;
    case "product_type":    return <span className="text-gray-500 text-[10px]">{li.product_type ?? dash}</span>;
    case "fulfillment_status": return li.fulfillment_status ? <Badge value={li.fulfillment_status} colors={FULFIL_COLORS} /> : dash;
    case "requires_shipping":  return <span className={`text-[10px] ${li.requires_shipping ? "text-gray-400" : "text-amber-600"}`}>{li.requires_shipping ? "Yes" : "No"}</span>;
    case "gift_card":       return <span className={`text-[10px] ${li.gift_card ? "text-purple-600" : "text-gray-300"}`}>{li.gift_card ? "Gift" : "—"}</span>;
    case "properties":      return li.properties?.length ? (
      <div className="flex gap-1 flex-wrap">
        {li.properties.map((p: { name: string; value: string }) => (
          <span key={p.name} className="px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded text-[9px]">{p.name}: {p.value}</span>
        ))}
      </div>
    ) : dash;
    default: {
      // Try extra_attributes
      const v = (li.extra_attributes as Record<string, unknown> | null)?.[field.key];
      if (v != null) return <span className="text-gray-500 text-[10px]">{String(v)}</span>;
      return dash;
    }
  }
}

// ── Line items drawer ─────────────────────────────────────────────
const DEFAULT_LI_COLS = ["sku", "product_title", "variant_title", "quantity", "price", "fulfillment_status", "properties"];

function LineItemsPanel({
  items, currency, liRegistry,
}: {
  items: LineItem[];
  currency: string | null;
  liRegistry: RegistryField[];
}) {
  const [liSearch, setLiSearch] = useState("");
  const [visibleLiCols, setVisibleLiCols] = useState<string[]>(() => {
    try { const s = localStorage.getItem(LS_LI_COLS); return s ? JSON.parse(s) : DEFAULT_LI_COLS; } catch { return DEFAULT_LI_COLS; }
  });
  const [showLiColChooser, setShowLiColChooser] = useState(false);

  const registry = liRegistry.length > 0 ? liRegistry : DEFAULT_LI_COLS.map(key => ({
    key, name: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    field_type: "text", source: "native", description: null,
  }));

  if (!items.length) return <div className="px-6 py-3 text-xs text-gray-400 italic">No line items</div>;

  const totalQty   = items.reduce((s, li) => s + li.quantity, 0);
  const totalValue = items.reduce((s, li) => s + (li.price ?? 0) * li.quantity, 0);
  const cur = currency ?? "USD";

  const filtered = liSearch
    ? items.filter(li =>
        [li.sku, li.product_title, li.name, li.variant_title]
          .some(v => v?.toLowerCase().includes(liSearch.toLowerCase()))
      )
    : items;

  const activeCols = registry.filter(f => visibleLiCols.includes(f.key));

  const saveLiCols = (cols: string[]) => {
    setVisibleLiCols(cols);
    try { localStorage.setItem(LS_LI_COLS, JSON.stringify(cols)); } catch {}
  };

  const sourceTag = (source: string) => {
    if (source === "computed") return <span className="text-[8px] bg-violet-50 text-violet-500 rounded px-1">⚡</span>;
    if (source === "shopify_metafield") return <span className="text-[8px] bg-green-50 text-green-500 rounded px-1">SF</span>;
    return null;
  };

  return (
    <div className="px-3 pb-3 pt-2">
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-2 px-1">
        <span className="text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">{items.length}</span> item{items.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">{totalQty}</span> units
        </span>
        <span className="text-[11px] text-gray-500">
          Total: <span className="font-semibold text-gray-700">{fmt(totalValue, cur)}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" value={liSearch}
              onChange={e => setLiSearch(e.target.value)}
              placeholder="Filter items…"
              className="pl-6 pr-3 py-1 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 w-36 bg-white"
            />
          </div>

          {/* Column chooser */}
          <div className="relative">
            <button
              onClick={() => setShowLiColChooser(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] border rounded-md transition-colors ${
                showLiColChooser ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Fields <span className="text-gray-400">{activeCols.length}</span>
            </button>

            {showLiColChooser && (
              <div className="absolute right-0 top-7 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-64 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">Line Item Columns</span>
                  <button onClick={() => setShowLiColChooser(false)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-2 py-1 border-b border-gray-100 flex gap-2">
                  <button onClick={() => saveLiCols(DEFAULT_LI_COLS)} className="text-[10px] text-gray-500 hover:text-gray-700">Reset</button>
                  <span className="text-gray-200">|</span>
                  <button onClick={() => saveLiCols(registry.map(f => f.key))} className="text-[10px] text-blue-500 hover:text-blue-700">All</button>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {["native", "computed", "shopify_metafield"].map(src => {
                    const grp = registry.filter(f => f.source === src);
                    if (!grp.length) return null;
                    const label = src === "native" ? "Native" : src === "computed" ? "⚡ Computed" : "Shopify Fields";
                    return (
                      <div key={src}>
                        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50">{label}</div>
                        {grp.map(f => (
                          <div
                            key={f.key}
                            onClick={() => saveLiCols(
                              visibleLiCols.includes(f.key)
                                ? visibleLiCols.filter(k => k !== f.key)
                                : [...visibleLiCols, f.key]
                            )}
                            className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 select-none"
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                              visibleLiCols.includes(f.key) ? "bg-blue-600 border-blue-600" : "border-gray-300"
                            }`}>
                              {visibleLiCols.includes(f.key) && (
                                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span className="text-xs text-gray-700 flex-1">{f.name}</span>
                            {sourceTag(f.source)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {activeCols.map(f => (
                  <th key={f.key} className="text-left px-3 py-2 font-medium text-gray-400 uppercase tracking-wider text-[9px] whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {sourceTag(f.source)}{f.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {filtered.map(li => (
                <tr key={li.id} className="hover:bg-blue-50/30 transition-colors">
                  {activeCols.map(f => (
                    <td key={f.key} className="px-3 py-2 whitespace-nowrap max-w-[200px]">
                      <LiCell field={f} li={li} currency={cur} />
                    </td>
                  ))}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={activeCols.length || 1} className="px-3 py-3 text-center text-xs text-gray-400">No items match</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
  compact:     { label: "Compact",     rowPy: "py-1",   headerPy: "py-1.5" },
  default:     { label: "Default",     rowPy: "py-2.5", headerPy: "py-2.5" },
  comfortable: { label: "Comfortable", rowPy: "py-4",   headerPy: "py-4" },
};

// ── Advanced Filter Builder ───────────────────────────────────
function newFilterRow(): FilterRow {
  return { id: Math.random().toString(36).slice(2), field: "status", op: "=", value: "" };
}

function AdvancedFilterBuilder({
  filters,
  onChange,
  onClose,
}: {
  filters: FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<FilterRow[]>(filters.length ? filters : [newFilterRow()]);

  const update = (id: string, patch: Partial<FilterRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const addRow = () => setRows(prev => [...prev, newFilterRow()]);
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  const apply = () => { onChange(rows.filter(r => r.field)); onClose(); };
  const clear  = () => { setRows([newFilterRow()]); onChange([]); onClose(); };

  const groups = Array.from(new Set(FILTER_FIELDS.map(f => f.group)));

  return (
    <div className="absolute left-0 top-11 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl w-[580px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-900">Filter Builder</span>
          <span className="text-xs text-gray-400 ml-1">{rows.length} rule{rows.length !== 1 ? "s" : ""} · matches orders where ALL conditions are true</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Rules */}
      <div className="max-h-80 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {rows.map((row, idx) => {
          const fd = FILTER_FIELDS.find(f => f.key === row.field);
          const ops = OPS_FOR_TYPE[fd?.type ?? "text"];
          const needsValue = row.op !== "is_empty" && row.op !== "is_not_empty";
          return (
            <div key={row.id} className="flex items-center gap-2 group">
              <span className="text-[10px] text-gray-400 w-6 text-right shrink-0 font-mono">
                {idx === 0 ? "IF" : "AND"}
              </span>

              {/* Field picker */}
              <select
                value={row.field}
                onChange={e => {
                  const newFd = FILTER_FIELDS.find(f => f.key === e.target.value);
                  const newOps = OPS_FOR_TYPE[newFd?.type ?? "text"];
                  update(row.id, { field: e.target.value, op: newOps[0], value: "" });
                }}
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                {groups.map(g => (
                  <optgroup key={g} label={g}>
                    {FILTER_FIELDS.filter(f => f.group === g).map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Operator picker */}
              <select
                value={row.op}
                onChange={e => update(row.id, { op: e.target.value as FilterOp })}
                className="w-36 shrink-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
              >
                {ops.map(op => (
                  <option key={op} value={op}>{OP_LABEL[op]}</option>
                ))}
              </select>

              {/* Value input */}
              {needsValue && (
                (fd as any)?.options ? (
                  <select
                    value={row.value}
                    onChange={e => update(row.id, { value: e.target.value })}
                    className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                  >
                    <option value="">-- pick --</option>
                    {(fd as any).options.map((o: string) => (
                      <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={fd?.type === "number" ? "number" : fd?.type === "date" ? "date" : "text"}
                    value={row.value}
                    onChange={e => update(row.id, { value: e.target.value })}
                    placeholder="value…"
                    className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                  />
                )
              )}
              {!needsValue && <div className="flex-1" />}

              {/* Remove button */}
              <button
                onClick={() => removeRow(row.id)}
                className="p-1 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title="Remove rule"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add rule
        </button>
        <div className="flex items-center gap-2">
          <button onClick={clear} className="text-xs text-gray-500 hover:text-red-500 px-3 py-1.5 border border-gray-200 rounded-lg hover:border-red-200 transition-colors">Clear all</button>
          <button onClick={apply} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-medium transition-colors">Apply filters</button>
        </div>
      </div>
    </div>
  );
}

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
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showColChooser, setShowColChooser] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const [computedDefs, setComputedDefs] = useState<ComputedFieldDef[]>([]);
  const [sortKey, setSortKey] = useState<string | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [density, setDensity] = useState<Density>("compact");
  const [showDensity, setShowDensity] = useState(false);
  const [liRegistry, setLiRegistry] = useState<RegistryField[]>([]);
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
    fetch(`${API_URL}/fields/registry?entity_type=line_item`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((fields: RegistryField[]) => { if (fields.length) setLiRegistry(fields); })
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

  // Client-side filter: apply builder rules on top of API results
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (!filterRows.length) return data.items;
    return data.items.filter(order => filterRows.every(row => matchesFilter(order, row)));
  }, [data?.items, filterRows]);

  // Client-side sort (backend doesn't support sort yet, so we sort locally)
  const sortedItems = filteredItems.length ? [...filteredItems].sort((a, b) => {
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

  const activeFilterCount = [statusFilter, fulfillmentFilter, financialFilter].filter(Boolean).length + filterRows.length;

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

          {/* Filter builder button */}
          <div className="relative">
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${showFilters || filterRows.length > 0 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 hover:bg-gray-50 text-gray-600"}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter
              {filterRows.length > 0 && (
                <span className="ml-0.5 w-4 h-4 bg-blue-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center">{filterRows.length}</span>
              )}
            </button>
            {showFilters && (
              <AdvancedFilterBuilder
                filters={filterRows}
                onChange={rows => { setFilterRows(rows); }}
                onClose={() => setShowFilters(false)}
              />
            )}
          </div>

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

        {/* ── Filter builder panel ── */}
        {filterRows.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {filterRows.map(row => {
              const fd = FILTER_FIELDS.find(f => f.key === row.field);
              const needsValue = row.op !== "is_empty" && row.op !== "is_not_empty";
              const label = `${fd?.label ?? row.field} ${OP_LABEL[row.op]}${needsValue && row.value ? ` "${row.value}"` : ""}`;
              return (
                <FilterChip
                  key={row.id}
                  label={label}
                  onRemove={() => setFilterRows(prev => prev.filter(r => r.id !== row.id))}
                />
              );
            })}
            <button
              onClick={() => setFilterRows([])}
              className="text-xs text-red-400 hover:text-red-600 px-2 py-1 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        {/* ── Table ── */}
        {/* Airtable/Notion style: no outer card border, hairline row separators only, very light header */}
        <div className="bg-white rounded-lg overflow-hidden flex-1 ring-1 ring-gray-100">
          {filterRows.length > 0 && (
            <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Showing {sortedItems.length} of {data?.total ?? "…"} orders (builder filters active — filtered client-side on this page)
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8 px-2" />
                  {colDefs.map(col => (
                    <th key={col.key}
                      className={`text-left px-3 ${dc.headerPy} text-[10px] font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap select-none
                        ${col.sortable ? "cursor-pointer hover:text-gray-600 group transition-colors" : ""}`}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
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
                  Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} cols={colDefs.length} />)
                ) : !sortedItems.length ? (
                  <tr>
                    <td colSpan={colDefs.length + 1}>
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <svg className="w-10 h-10 text-gray-200 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-gray-500 text-sm font-medium">No orders found</p>
                        <p className="text-gray-400 text-xs mt-1">Try adjusting your search or filters</p>
                      </div>
                    </td>
                  </tr>
                ) : sortedItems.map((order, rowIdx) => (
                  <React.Fragment key={order.id}>
                    <tr
                      onClick={() => toggleExpand(order.id)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors group
                        ${expanded.has(order.id)
                          ? "bg-blue-50/50"
                          : "hover:bg-gray-50/70"}`}
                    >
                      <td className={`px-2 ${dc.rowPy} text-center w-8`}>
                        <div className={`inline-flex items-center justify-center transition-transform ${expanded.has(order.id) ? "rotate-90 text-blue-400" : "text-gray-200 group-hover:text-gray-400"}`}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </td>
                      {colDefs.map(col => (
                        <td key={col.key} className={`px-3 ${dc.rowPy} max-w-[200px]`}>
                          <Cell col={col.key} order={order} computedDefs={computedDefs} />
                        </td>
                      ))}
                    </tr>
                    {expanded.has(order.id) && (
                      <tr key={`${order.id}-items`} className="bg-slate-50 border-b border-gray-100">
                        <td colSpan={colDefs.length + 1} className="border-l-2 border-blue-300">
                          <LineItemsPanel items={order.line_items} currency={order.currency} liRegistry={liRegistry} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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

"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  // Product fields
  { key: "title", label: "Title", type: "text", group: "Product" },
  { key: "handle", label: "Handle", type: "text", group: "Product" },
  { key: "product_type", label: "Type", type: "text", group: "Product" },
  { key: "vendor", label: "Vendor", type: "text", group: "Product" },
  { key: "status", label: "Status", type: "select", group: "Product", options: ["active", "draft", "archived"] },
  { key: "is_active", label: "Active", type: "select", group: "Product", options: ["true", "false"] },
  { key: "variant_count", label: "Variant Count", type: "number", group: "Product" },
  // Variant fields
  { key: "v_sku", label: "SKU", type: "text", group: "Variant" },
  { key: "v_title", label: "Variant Title", type: "text", group: "Variant" },
  { key: "v_price", label: "Price", type: "number", group: "Variant" },
  { key: "v_inventory", label: "Inventory", type: "number", group: "Variant" },
  { key: "v_bin", label: "Bin Number", type: "text", group: "Variant" },
  { key: "v_section", label: "Bin Section", type: "select", group: "Variant", options: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "S"] },
  { key: "v_shipping_unit", label: "Shipping Unit", type: "number", group: "Variant" },
] as const;

type FilterFieldKey = typeof FILTER_FIELDS[number]["key"];

const OPS_FOR_TYPE: Record<string, FilterOp[]> = {
  text: ["contains", "not_contains", "=", "!=", "is_empty", "is_not_empty"],
  select: ["=", "!=", "is_empty", "is_not_empty"],
  number: ["=", "!=", ">", "<", ">=", "<=", "is_empty", "is_not_empty"],
  date: [">", "<", ">=", "<=", "is_empty", "is_not_empty"],
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

// ── Types ────────────────────────────────────────────────────────
interface Variant {
  id: string;
  shopify_variant_id: string | null;
  sku: string | null;
  title: string | null;
  price: number | null;
  inventory_quantity: number | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  // Metafields
  metafields: { custom?: { bin_number?: string; bin_section?: string; bin_column?: number; bin_row?: string } } | null;
  // Dimensions
  length: number | null;
  width: number | null;
  height: number | null;
  // Shipping
  shipping_unit: number | null;
  weight: number | null;
  weight_unit: string | null;
  grams: number | null;
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
  tags: string[] | null;
  variant_count: number;
  variants: Variant[];
  created_at?: string;
  updated_at?: string;
}

interface Page { items: Product[]; total: number; page: number; page_size: number; total_pages: number; }

type SortDir = "asc" | "desc" | null;
type Density = "compact" | "default" | "comfortable";
type ViewMode = "products" | "variants";

// ── Column definitions ───────────────────────────────────────────
const PRODUCT_COLUMNS = [
  { key: "title", label: "Title", group: "Identity", sortable: true },
  { key: "handle", label: "Handle", group: "Identity", sortable: true },
  { key: "product_type", label: "Type", group: "Details", sortable: true },
  { key: "vendor", label: "Vendor", group: "Details", sortable: true },
  { key: "status", label: "Status", group: "Details", sortable: true },
  { key: "variant_count", label: "Variants", group: "Details", sortable: true },
  { key: "tags", label: "Tags", group: "Details", sortable: false },
];

const VARIANT_COLUMNS = [
  { key: "v_image", label: "", group: "Identity", sortable: false },
  { key: "v_product", label: "Product", group: "Identity", sortable: true },
  { key: "v_sku", label: "SKU", group: "Identity", sortable: true },
  { key: "v_title", label: "Variant", group: "Identity", sortable: true },
  { key: "v_price", label: "Price", group: "Pricing", sortable: true },
  { key: "v_inventory", label: "Inventory", group: "Stock", sortable: true },
  { key: "v_bin", label: "Bin Location", group: "Warehouse", sortable: true },
  { key: "v_dimensions", label: "Dimensions", group: "Shipping", sortable: false },
  { key: "v_shipping_unit", label: "Ship Unit", group: "Shipping", sortable: true },
  { key: "v_weight", label: "Weight", group: "Shipping", sortable: true },
];

const DEFAULT_PRODUCT_COLS = ["title", "handle", "product_type", "vendor", "variant_count", "status"];
const DEFAULT_VARIANT_COLS = ["v_image", "v_product", "v_sku", "v_title", "v_price", "v_inventory", "v_bin"];

const LS_KEY_PRODUCTS = "oms_products_columns_v2";
const LS_KEY_VARIANTS = "oms_variants_columns_v2";
const LS_DENSITY = "oms_products_density";

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
  J: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  S: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
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

function BinBadge({ bin }: { bin: string | null }) {
  if (!bin) return <span className="text-gray-300 text-xs select-none">—</span>;
  const section = bin[0];
  const cls = BIN_SECTION_COLORS[section] ?? "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold whitespace-nowrap ${cls}`}>
      {bin}
    </span>
  );
}

function fmt(val: number | null, currency = "USD") {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(val);
}

function fmtNum(val: number | null, decimals = 0) {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);
}

// ── Cell renderers ───────────────────────────────────────────────
function ProductCell({ col, product }: { col: string; product: Product }) {
  switch (col) {
    case "title":
      return (
        <div className="flex items-center gap-2 min-w-0">
          {product.shopify_product_id && (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-xs flex-shrink-0">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            </div>
          )}
          <span className="font-medium text-gray-900 text-sm truncate">{product.title}</span>
        </div>
      );
    case "handle":
      return <span className="text-gray-500 text-xs font-mono truncate">{product.handle ?? "—"}</span>;
    case "product_type":
      return <span className="text-gray-600 text-sm">{product.product_type ?? "—"}</span>;
    case "vendor":
      return <span className="text-gray-600 text-sm">{product.vendor ?? "—"}</span>;
    case "status":
      return product.is_active
        ? <Badge value="active" colors={STATUS_COLORS} />
        : <Badge value="archived" colors={STATUS_COLORS} />;
    case "variant_count":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold tabular-nums">
          {product.variant_count}
        </span>
      );
    case "tags":
      return product.tags?.length ? (
        <div className="flex flex-wrap gap-1 max-w-[180px]">
          {product.tags.slice(0, 3).map((t: string) => (
            <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{t}</span>
          ))}
          {product.tags.length > 3 && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">+{product.tags.length - 3}</span>
          )}
        </div>
      ) : <span className="text-gray-300 text-xs select-none">—</span>;
    default: return <span className="text-gray-300 text-xs select-none">—</span>;
  }
}

function VariantCell({ col, variant, product }: { col: string; variant: Variant; product: Product }) {
  switch (col) {
    case "v_image":
      return (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
      );
    case "v_product":
      return <span className="font-medium text-gray-900 text-sm truncate">{product.title}</span>;
    case "v_sku":
      return <span className="text-gray-700 text-xs font-mono bg-gray-50 px-1.5 py-0.5 rounded">{variant.sku ?? "—"}</span>;
    case "v_title":
      return <span className="text-gray-600 text-sm">{variant.title ?? "Default Title"}</span>;
    case "v_price":
      return <span className="font-medium text-gray-900 tabular-nums text-sm">{fmt(variant.price)}</span>;
    case "v_inventory":
      const qty = variant.inventory_quantity ?? 0;
      const colorClass = qty === 0 ? "text-red-600 bg-red-50" : qty < 10 ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums ${colorClass}`}>
          {qty} in stock
        </span>
      );
    case "v_bin":
      const bin = variant.metafields?.custom?.bin_number;
      return <BinBadge bin={bin ?? null} />;
    case "v_dimensions":
      if (!variant.length && !variant.width && !variant.height) return <span className="text-gray-300 text-xs select-none">—</span>;
      return (
        <span className="text-gray-600 text-xs tabular-nums">
          {variant.length ?? "—"} × {variant.width ?? "—"} × {variant.height ?? "—"}
        </span>
      );
    case "v_shipping_unit":
      if (!variant.shipping_unit) return <span className="text-gray-300 text-xs select-none">—</span>;
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 tabular-nums">
          {variant.shipping_unit}x
        </span>
      );
    case "v_weight":
      if (!variant.weight) return <span className="text-gray-300 text-xs select-none">—</span>;
      return <span className="text-gray-600 text-xs tabular-nums">{fmtNum(variant.weight, 1)} {variant.weight_unit}</span>;
    default: return <span className="text-gray-300 text-xs select-none">—</span>;
  }
}

// ── Skeleton loader ──────────────────────────────────────────────
function SkeletonRow({ cols, density }: { cols: number; density: Density }) {
  const py = density === "compact" ? "py-2" : density === "comfortable" ? "py-4" : "py-3";
  return (
    <tr className="border-b border-gray-100">
      <td className="w-10 px-3 py-3"><div className="w-4 h-4 bg-gray-100 rounded animate-pulse" /></td>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={`px-4 ${py}`}>
          <div className={`h-3.5 bg-gray-100 rounded animate-pulse ${i === 0 ? "w-32" : i === 1 ? "w-24" : i % 3 === 0 ? "w-16" : "w-12"}`} />
        </td>
      ))}
    </tr>
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

// ── Main Component ─────────────────────────────────────────────
export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("products");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  
  // Filters
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  
  // Column management
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_PRODUCT_COLS);
  const [visibleVariantCols, setVisibleVariantCols] = useState<string[]>(DEFAULT_VARIANT_COLS);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  
  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  
  // Density
  const [density, setDensity] = useState<Density>("default");

  const getToken = () => localStorage.getItem("oms_token");

  // Load saved preferences
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedCols = localStorage.getItem(LS_KEY_PRODUCTS);
      if (savedCols) setVisibleCols(JSON.parse(savedCols));
      const savedVariantCols = localStorage.getItem(LS_KEY_VARIANTS);
      if (savedVariantCols) setVisibleVariantCols(JSON.parse(savedVariantCols));
      const savedDensity = localStorage.getItem(LS_DENSITY) as Density;
      if (savedDensity) setDensity(savedDensity);
    }
  }, []);

  // Persist column preferences
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify(visibleCols));
    }
  }, [visibleCols]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY_VARIANTS, JSON.stringify(visibleVariantCols));
    }
  }, [visibleVariantCols]);

  // Close column menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

  // Filtering logic
  const filteredItems = useMemo(() => {
    if (!data?.items || filters.length === 0) return data?.items ?? [];
    return data.items.filter(product => {
      return filters.every(filter => {
        const fd = FILTER_FIELDS.find(f => f.key === filter.field);
        if (!fd) return true;

        const isVariantField = fd.group === "Variant";
        if (isVariantField) {
          return product.variants.some(v => matchesVariantFilter(v, filter, fd.type as string));
        }
        
        const val = getProductVal(product, filter.field);
        return evalOp(val, filter.op, filter.value, fd.type as string);
      });
    });
  }, [data?.items, filters]);

  function getProductVal(product: Product, field: string): string | number | null {
    switch (field) {
      case "title": return product.title;
      case "handle": return product.handle;
      case "product_type": return product.product_type;
      case "vendor": return product.vendor;
      case "status": return product.status;
      case "is_active": return String(product.is_active);
      case "variant_count": return product.variant_count;
      case "tags": return (product.tags ?? []).join(",");
      default: return null;
    }
  }

  function matchesVariantFilter(variant: Variant, filter: FilterRow, type: string): boolean {
    let val: string | number | null = null;
    switch (filter.field) {
      case "v_sku": val = variant.sku; break;
      case "v_title": val = variant.title; break;
      case "v_price": val = variant.price; break;
      case "v_inventory": val = variant.inventory_quantity; break;
      case "v_bin": val = variant.metafields?.custom?.bin_number ?? null; break;
      case "v_section": val = variant.metafields?.custom?.bin_section ?? null; break;
      case "v_shipping_unit": val = variant.shipping_unit; break;
    }
    return evalOp(val, filter.op, filter.value, type);
  }

  function evalOp(val: string | number | null, op: FilterOp, target: string, type: string): boolean {
    if (op === "is_empty") return val == null || String(val).trim() === "";
    if (op === "is_not_empty") return val != null && String(val).trim() !== "";
    if (val == null) return false;

    if (type === "number") {
      const n = Number(val);
      const t = Number(target);
      if (isNaN(n) || isNaN(t)) return false;
      switch (op) {
        case "=": return n === t;
        case "!=": return n !== t;
        case ">": return n > t;
        case "<": return n < t;
        case ">=": return n >= t;
        case "<=": return n <= t;
      }
    }

    const sv = String(val).toLowerCase();
    const tv = target.toLowerCase();
    switch (op) {
      case "=": return sv === tv;
      case "!=": return sv !== tv;
      case "contains": return sv.includes(tv);
      case "not_contains": return !sv.includes(tv);
      default: return true;
    }
  }

  // Sorting
  const sortedItems = useMemo(() => {
    if (!sortCol || !sortDir) return filteredItems;
    return [...filteredItems].sort((a, b) => {
      let av = getProductVal(a, sortCol);
      let bv = getProductVal(b, sortCol);
      if (typeof av === "string" && typeof bv === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? 1 : -1;
      if (bv == null) return sortDir === "asc" ? -1 : 1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredItems, sortCol, sortDir]);

  // Flatten variants for variant view
  const flattenedVariants = useMemo(() => {
    const rows: { variant: Variant; product: Product }[] = [];
    sortedItems.forEach(p => {
      p.variants.forEach(v => rows.push({ variant: v, product: p }));
    });
    return rows;
  }, [sortedItems]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSort(key: string) {
    if (sortCol === key) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
      else setSortDir("asc");
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  }

  function addFilter() {
    setFilters(prev => [...prev, { id: Math.random().toString(36), field: "title", op: "contains", value: "" }]);
    setShowFilters(true);
  }

  function updateFilter(id: string, updates: Partial<FilterRow>) {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }

  function removeFilter(id: string) {
    setFilters(prev => prev.filter(f => f.id !== id));
  }

  const activeColumns = viewMode === "products" ? visibleCols : visibleVariantCols;
  const currentColumnDefs = viewMode === "products" ? PRODUCT_COLUMNS : VARIANT_COLUMNS;

  const py = density === "compact" ? "py-2" : density === "comfortable" ? "py-4" : "py-3";

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">
              {viewMode === "products" ? "Products" : "Variants"}
              {data && <span className="text-gray-400 font-normal text-base ml-2">({filteredItems.length} of {data.total})</span>}
            </h1>
            {/* View Mode Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("products")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "products" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Products
              </button>
              <button
                onClick={() => setViewMode("variants")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "variants" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Variants
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Density toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(["compact", "default", "comfortable"] as Density[]).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDensity(d); localStorage.setItem(LS_DENSITY, d); }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    density === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                  title={d}
                >
                  {d === "compact" ? "≡" : d === "default" ? "≡≡" : "≡≡≡"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" 
              placeholder={`Search ${viewMode}...`} 
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filters.length > 0 ? "bg-blue-50 text-blue-700 border border-blue-200" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters {filters.length > 0 && <span className="bg-blue-200 text-blue-800 text-xs px-1.5 py-0.5 rounded-full">{filters.length}</span>}
          </button>

          <div className="relative" ref={columnMenuRef}>
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              Columns
            </button>
            {showColumnMenu && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Visible Columns</div>
                {currentColumnDefs.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={viewMode === "products" ? visibleCols.includes(col.key) : visibleVariantCols.includes(col.key)}
                      onChange={(e) => {
                        if (viewMode === "products") {
                          setVisibleCols(prev => e.target.checked ? [...prev, col.key] : prev.filter(c => c !== col.key));
                        } else {
                          setVisibleVariantCols(prev => e.target.checked ? [...prev, col.key] : prev.filter(c => c !== col.key));
                        }
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{col.label || col.key}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Filters</span>
              <button onClick={addFilter} className="text-sm text-blue-600 hover:text-blue-700 font-medium">+ Add filter</button>
            </div>
            {filters.length === 0 && <p className="text-sm text-gray-500">No filters applied. Click "Add filter" to get started.</p>}
            {filters.map((filter, idx) => {
              const fd = FILTER_FIELDS.find(f => f.key === filter.field)!;
              return (
                <div key={filter.id} className="flex items-center gap-2">
                  {idx > 0 && <span className="text-sm text-gray-400 font-medium">AND</span>}
                  <select
                    value={filter.field}
                    onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <optgroup label="Product">
                      {FILTER_FIELDS.filter(f => f.group === "Product").map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </optgroup>
                    <optgroup label="Variant">
                      {FILTER_FIELDS.filter(f => f.group === "Variant").map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </optgroup>
                  </select>
                  <select
                    value={filter.op}
                    onChange={(e) => updateFilter(filter.id, { op: e.target.value as FilterOp })}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {(OPS_FOR_TYPE[fd.type] || OPS_FOR_TYPE.text).map(op => (
                      <option key={op} value={op}>{OP_LABEL[op]}</option>
                    ))}
                  </select>
                  {filter.op !== "is_empty" && filter.op !== "is_not_empty" && (
                    fd.type === "select" ? (
                      <select
                        value={filter.value}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Select...</option>
                        {fd.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={fd.type === "number" ? "number" : "text"}
                        value={filter.value}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                        placeholder="Value..."
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    )
                  )}
                  <button onClick={() => removeFilter(filter.id)} className="text-gray-400 hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-10 px-3 py-3"></th>
                {activeColumns.map(key => {
                  const colDef = currentColumnDefs.find(c => c.key === key);
                  if (!colDef) return null;
                  return (
                    <th
                      key={key}
                      onClick={() => colDef.sortable && toggleSort(key)}
                      className={`text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${
                        colDef.sortable ? "cursor-pointer hover:bg-gray-100 group" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {colDef.label || key}
                        {colDef.sortable && <SortIcon dir={sortCol === key ? sortDir : null} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={activeColumns.length} density={density} />)
              ) : viewMode === "products" ? (
                sortedItems.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} className="text-center py-12 text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        <p>No products found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedItems.map(product => (
                    <>
                      <tr key={product.id} className={`hover:bg-blue-50/50 transition-colors ${expanded.has(product.id) ? "bg-blue-50/30" : ""}`}>
                        <td className="px-3 py-3">
                          {product.variants.length > 0 && (
                            <button
                              onClick={() => toggleExpand(product.id)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500 transition-colors"
                            >
                              {expanded.has(product.id) ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                              )}
                            </button>
                          )}
                        </td>
                        {activeColumns.map(col => (
                          <td key={col} className={`px-4 ${py}`}>
                            <ProductCell col={col} product={product} />
                          </td>
                        ))}
                      </tr>
                      {/* Expanded Variants */}
                      {expanded.has(product.id) && product.variants.map((variant, idx) => (
                        <tr key={variant.id} className="bg-gray-50/50 border-l-4 border-blue-300">
                          <td className="px-3 py-2">
                            <span className="text-gray-300 text-xs">{idx === product.variants.length - 1 ? "└" : "├"}</span>
                          </td>
                          {activeColumns.map(col => {
                            if (col === "title") {
                              return (
                                <td key={col} className="px-4 py-2">
                                  <div className="flex items-center gap-2 pl-4">
                                    <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px]">
                                      V
                                    </div>
                                    <span className="text-gray-500 text-xs">{variant.title || "Default"}</span>
                                  </div>
                                </td>
                              );
                            }
                            if (col === "handle") {
                              return (
                                <td key={col} className="px-4 py-2">
                                  <span className="text-gray-500 text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">{variant.sku || "—"}</span>
                                </td>
                              );
                            }
                            if (col === "variant_count") {
                              return (
                                <td key={col} className="px-4 py-2">
                                  <span className="text-gray-900 text-sm font-medium tabular-nums">{fmt(variant.price)}</span>
                                </td>
                              );
                            }
                            if (col === "status") {
                              const bin = variant.metafields?.custom?.bin_number;
                              return (
                                <td key={col} className="px-4 py-2">
                                  {bin ? <BinBadge bin={bin} /> : <span className="text-gray-300 text-xs">—</span>}
                                </td>
                              );
                            }
                            return <td key={col} className="px-4 py-2" />;
                          })}
                        </tr>
                      ))}
                    </>
                  ))
                )
              ) : (
                // Variants view
                flattenedVariants.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} className="text-center py-12 text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        <p>No variants found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  flattenedVariants.map(({ variant, product }) => (
                    <tr key={variant.id} className="hover:bg-blue-50/50 transition-colors">
                      <td className="px-3 py-3"></td>
                      {activeColumns.map(col => (
                        <td key={col} className={`px-4 ${py}`}>
                          <VariantCell col={col} variant={variant} product={product} />
                        </td>
                      ))}
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {viewMode === "products" && data && data.total_pages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Page {data.page} of {data.total_pages}</span>
            <div className="flex gap-2">
              <button 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Previous
              </button>
              <button 
                disabled={page >= data.total_pages} 
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
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


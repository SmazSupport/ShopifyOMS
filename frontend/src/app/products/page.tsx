"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Types
interface Variant {
  id: string;
  sku: string | null;
  title: string | null;
  price: number | null;
  inventory_quantity: number | null;
  metafields: { custom?: { bin_number?: string } } | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shipping_unit: number | null;
}

interface Product {
  id: string;
  title: string;
  handle: string | null;
  product_type: string | null;
  vendor: string | null;
  status: string | null;
  is_active: boolean;
  variants: Variant[];
}

// Format helpers
const fmt = (val: number | null) => val == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
const fmtNum = (val: number | null, decimals = 2) => val == null ? "—" : val.toFixed(decimals);

// Column definitions
const PRODUCT_COLUMNS = [
  { key: "expand", label: "", default: true },
  { key: "title", label: "Product", default: true },
  { key: "type", label: "Type", default: true },
  { key: "vendor", label: "Vendor", default: true },
  { key: "status", label: "Status", default: true },
  { key: "variant_count", label: "Variants", default: true },
];

const VARIANT_COLUMNS = [
  { key: "product", label: "Product", default: true },
  { key: "sku", label: "SKU", default: true },
  { key: "title", label: "Variant", default: true },
  { key: "price", label: "Price", default: true },
  { key: "stock", label: "Stock", default: true },
  { key: "bin", label: "Bin", default: true },
  { key: "dimensions", label: "Dimensions", default: true },
  { key: "shipping_unit", label: "Ship Unit", default: true },
];

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"products" | "variants">("products");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  
  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterVendor, setFilterVendor] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  
  // Column visibility
  const [visibleProductCols, setVisibleProductCols] = useState<string[]>(PRODUCT_COLUMNS.filter(c => c.default).map(c => c.key));
  const [visibleVariantCols, setVisibleVariantCols] = useState<string[]>(VARIANT_COLUMNS.filter(c => c.default).map(c => c.key));
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const getToken = () => localStorage.getItem("oms_token");

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      const token = getToken();
      if (!token) { router.push("/login"); return; }
      
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/products?page=1&page_size=100`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 401) { router.push("/login"); return; }
        const data = await res.json();
        setProducts(data.items || []);
      } catch (e) {
        console.error("Failed to fetch:", e);
      }
      setLoading(false);
    };
    
    fetchProducts();
  }, [router]);

  // Get unique values for filters
  const uniqueTypes = useMemo(() => [...new Set(products.map(p => p.product_type).filter(Boolean))], [products]);
  const uniqueVendors = useMemo(() => [...new Set(products.map(p => p.vendor).filter(Boolean))], [products]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = !search || 
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.handle?.toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === "all" || p.product_type === filterType;
      const matchesVendor = filterVendor === "all" || p.vendor === filterVendor;
      const matchesStatus = filterStatus === "all" || 
        (filterStatus === "active" && p.is_active) ||
        (filterStatus === "archived" && !p.is_active);
      return matchesSearch && matchesType && matchesVendor && matchesStatus;
    });
  }, [products, search, filterType, filterVendor, filterStatus]);

  // Flatten all variants for the variants tab
  const allVariants = useMemo(() => {
    return filteredProducts.flatMap(p => 
      p.variants.map(v => ({ ...v, productTitle: p.title, productType: p.product_type, productId: p.id }))
    );
  }, [filteredProducts]);

  // Toggle expand single product
  const toggleExpand = (id: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Expand all
  const expandAll = () => {
    setExpandedProducts(new Set(filteredProducts.map(p => p.id)));
  };

  // Collapse all
  const collapseAll = () => {
    setExpandedProducts(new Set());
  };

  // Toggle column visibility
  const toggleColumn = (key: string, tab: "products" | "variants") => {
    if (tab === "products") {
      setVisibleProductCols(prev => 
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
    } else {
      setVisibleVariantCols(prev => 
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
    }
  };

  // Check if a column is visible
  const isColVisible = (key: string, tab: "products" | "variants") => {
    if (key === "expand") return true; // Always show expand column
    return tab === "products" ? visibleProductCols.includes(key) : visibleVariantCols.includes(key);
  };

  if (loading) return <AppLayout><div className="p-8">Loading...</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header with Tabs */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          
          <div className="flex items-center gap-4">
            {/* Expand/Collapse All (Products tab only) */}
            {activeTab === "products" && (
              <div className="flex gap-2">
                <button onClick={expandAll} className="text-sm text-blue-600 hover:text-blue-700">Expand All</button>
                <span className="text-gray-300">|</span>
                <button onClick={collapseAll} className="text-sm text-blue-600 hover:text-blue-700">Collapse All</button>
              </div>
            )}
            
            {/* Tabs */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab("products")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "products" 
                    ? "bg-white text-gray-900 shadow-sm" 
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Products ({filteredProducts.length})
              </button>
              <button
                onClick={() => setActiveTab("variants")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "variants" 
                    ? "bg-white text-gray-900 shadow-sm" 
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Variants ({allVariants.length})
              </button>
            </div>
          </div>
        </div>

        {/* Filters & Column Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          {/* Type Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          
          {/* Vendor Filter */}
          <select
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Vendors</option>
            {uniqueVendors.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          
          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          
          {/* Columns Button */}
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Columns
            </button>
            {showColumnMenu && (
              <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase">
                  {activeTab === "products" ? "Product Columns" : "Variant Columns"}
                </div>
                {(activeTab === "products" ? PRODUCT_COLUMNS : VARIANT_COLUMNS)
                  .filter(c => c.key !== "expand")
                  .map(col => (
                    <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isColVisible(col.key, activeTab)}
                        onChange={() => toggleColumn(col.key, activeTab)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{col.label}</span>
                    </label>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Products Tab */}
        {activeTab === "products" && (
          <div className="bg-white rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-10"></th>
                  {isColVisible("title", "products") && <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>}
                  {isColVisible("type", "products") && <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>}
                  {isColVisible("vendor", "products") && <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>}
                  {isColVisible("status", "products") && <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>}
                  {isColVisible("variant_count", "products") && <th className="text-left px-4 py-3 font-medium text-gray-600">Variants</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map(product => (
                  <>
                    <tr 
                      key={product.id} 
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => product.variants.length > 0 && toggleExpand(product.id)}
                    >
                      <td className="px-4 py-3">
                        {product.variants.length > 0 && (
                          <span className="text-gray-400">
                            {expandedProducts.has(product.id) ? "▼" : "▶"}
                          </span>
                        )}
                      </td>
                      {isColVisible("title", "products") && (
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{product.title}</div>
                          <div className="text-xs text-gray-500">{product.handle}</div>
                        </td>
                      )}
                      {isColVisible("type", "products") && (
                        <td className="px-4 py-3 text-gray-600">{product.product_type || "—"}</td>
                      )}
                      {isColVisible("vendor", "products") && (
                        <td className="px-4 py-3 text-gray-600">{product.vendor || "—"}</td>
                      )}
                      {isColVisible("status", "products") && (
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            product.is_active 
                              ? "bg-green-100 text-green-800" 
                              : "bg-gray-100 text-gray-800"
                          }`}>
                            {product.is_active ? "Active" : "Archived"}
                          </span>
                        </td>
                      )}
                      {isColVisible("variant_count", "products") && (
                        <td className="px-4 py-3 text-gray-600">{product.variants.length}</td>
                      )}
                    </tr>
                    
                    {/* Expanded Variants */}
                    {expandedProducts.has(product.id) && product.variants.map(variant => (
                      <tr key={variant.id} className="bg-gray-50">
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2" colSpan={5}>
                          <div className="grid grid-cols-6 gap-4 text-sm">
                            <div>
                              <span className="text-gray-500">SKU:</span>
                              <span className="ml-2 font-medium">{variant.sku || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Price:</span>
                              <span className="ml-2">{fmt(variant.price)}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Stock:</span>
                              <span className="ml-2">{variant.inventory_quantity ?? 0}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Bin:</span>
                              <span className="ml-2">{variant.metafields?.custom?.bin_number || "—"}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Dimensions:</span>
                              <span className="ml-2">
                                {fmtNum(variant.length, 1)} × {fmtNum(variant.width, 1)} × {fmtNum(variant.height, 1)}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">Ship Unit:</span>
                              <span className="ml-2">{variant.shipping_unit || "—"}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Variants Tab */}
        {activeTab === "variants" && (
          <div className="bg-white rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {isColVisible("product", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>}
                  {isColVisible("sku", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>}
                  {isColVisible("title", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Variant</th>}
                  {isColVisible("price", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Price</th>}
                  {isColVisible("stock", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Stock</th>}
                  {isColVisible("bin", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Bin</th>}
                  {isColVisible("dimensions", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Dimensions</th>}
                  {isColVisible("shipping_unit", "variants") && <th className="text-left px-4 py-3 font-medium text-gray-600">Ship Unit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allVariants.map(variant => (
                  <tr key={variant.id} className="hover:bg-gray-50">
                    {isColVisible("product", "variants") && (
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{variant.productTitle}</div>
                        <div className="text-xs text-gray-500">{variant.productType}</div>
                      </td>
                    )}
                    {isColVisible("sku", "variants") && (
                      <td className="px-4 py-3 font-mono text-xs">{variant.sku || "—"}</td>
                    )}
                    {isColVisible("title", "variants") && (
                      <td className="px-4 py-3">{variant.title || "Default"}</td>
                    )}
                    {isColVisible("price", "variants") && (
                      <td className="px-4 py-3">{fmt(variant.price)}</td>
                    )}
                    {isColVisible("stock", "variants") && (
                      <td className="px-4 py-3">{variant.inventory_quantity ?? 0}</td>
                    )}
                    {isColVisible("bin", "variants") && (
                      <td className="px-4 py-3">{variant.metafields?.custom?.bin_number || "—"}</td>
                    )}
                    {isColVisible("dimensions", "variants") && (
                      <td className="px-4 py-3 text-xs">
                        {fmtNum(variant.length, 1)} × {fmtNum(variant.width, 1)} × {fmtNum(variant.height, 1)}
                      </td>
                    )}
                    {isColVisible("shipping_unit", "variants") && (
                      <td className="px-4 py-3">{variant.shipping_unit || "—"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

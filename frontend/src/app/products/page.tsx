"use client";

import { useEffect, useState, useCallback } from "react";
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

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"products" | "variants">("products");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

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

  // Toggle expanded product
  const toggleExpand = (id: string) => {
    setExpandedProduct(expandedProduct === id ? null : id);
  };

  // Flatten all variants for the variants tab
  const allVariants = products.flatMap(p => 
    p.variants.map(v => ({ ...v, productTitle: p.title, productType: p.product_type }))
  );

  if (loading) return <AppLayout><div className="p-8">Loading...</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        {/* Header with Tabs */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("products")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === "products" 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Products ({products.length})
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

        {/* Products Tab */}
        {activeTab === "products" && (
          <div className="bg-white rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-10"></th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Variants</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map(product => (
                  <>
                    <tr 
                      key={product.id} 
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => product.variants.length > 0 && toggleExpand(product.id)}
                    >
                      <td className="px-4 py-3">
                        {product.variants.length > 0 && (
                          <span className="text-gray-400">
                            {expandedProduct === product.id ? "▼" : "▶"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{product.title}</div>
                        <div className="text-xs text-gray-500">{product.handle}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{product.product_type || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{product.vendor || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          product.is_active 
                            ? "bg-green-100 text-green-800" 
                            : "bg-gray-100 text-gray-800"
                        }`}>
                          {product.is_active ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{product.variants.length}</td>
                    </tr>
                    
                    {/* Expanded Variants */}
                    {expandedProduct === product.id && product.variants.map(variant => (
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Variant</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Price</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stock</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Bin</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Dimensions</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Ship Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allVariants.map(variant => (
                  <tr key={variant.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{variant.productTitle}</div>
                      <div className="text-xs text-gray-500">{variant.productType}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{variant.sku || "—"}</td>
                    <td className="px-4 py-3">{variant.title || "Default"}</td>
                    <td className="px-4 py-3">{fmt(variant.price)}</td>
                    <td className="px-4 py-3">{variant.inventory_quantity ?? 0}</td>
                    <td className="px-4 py-3">{variant.metafields?.custom?.bin_number || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {fmtNum(variant.length, 1)} × {fmtNum(variant.width, 1)} × {fmtNum(variant.height, 1)}
                    </td>
                    <td className="px-4 py-3">{variant.shipping_unit || "—"}</td>
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

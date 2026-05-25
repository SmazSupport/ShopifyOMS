"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ENTITY_TYPES = ["product", "variant", "order", "line_item", "customer"];
const FIELD_TYPES = ["text", "number", "boolean", "date", "json"];

interface Mapping { id: string; shopify_namespace: string; shopify_key: string; }
interface Field { id: string; entity_type: string; name: string; key: string; field_type: string; description: string | null; mapping: Mapping | null; }

const ENTITY_COLORS: Record<string, string> = {
  product: "bg-blue-100 text-blue-800",
  variant: "bg-indigo-100 text-indigo-800",
  order: "bg-green-100 text-green-800",
  line_item: "bg-yellow-100 text-yellow-800",
  customer: "bg-purple-100 text-purple-800",
};

export default function FieldsPage() {
  const router = useRouter();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editMapping, setEditMapping] = useState<Field | null>(null);
  const [form, setForm] = useState({ entity_type: "product", name: "", key: "", field_type: "text", description: "" });
  const [mapForm, setMapForm] = useState({ shopify_namespace: "custom", shopify_key: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const getToken = () => localStorage.getItem("oms_token");

  const fetchFields = useCallback(async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    const params = new URLSearchParams();
    if (entityFilter) params.set("entity_type", entityFilter);
    const res = await fetch(`${API_URL}/fields?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { router.push("/login"); return; }
    setFields(await res.json());
    setLoading(false);
  }, [entityFilter]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const autoKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const createField = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setFormError("");
    const token = getToken();
    const res = await fetch(`${API_URL}/fields`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) { const d = await res.json(); setFormError(d.detail ?? "Error"); }
    else { setShowAdd(false); setForm({ entity_type: "product", name: "", key: "", field_type: "text", description: "" }); fetchFields(); }
    setSaving(false);
  };

  const deleteField = async (id: string) => {
    if (!confirm("Delete this field and all its values?")) return;
    const token = getToken();
    await fetch(`${API_URL}/fields/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    fetchFields();
  };

  const saveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMapping) return;
    setSaving(true);
    const token = getToken();
    await fetch(`${API_URL}/fields/${editMapping.id}/mapping`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(mapForm),
    });
    setEditMapping(null);
    fetchFields();
    setSaving(false);
  };

  const removeMapping = async (field: Field) => {
    if (!confirm("Remove this Shopify mapping?")) return;
    const token = getToken();
    await fetch(`${API_URL}/fields/${field.id}/mapping`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    fetchFields();
  };

  const grouped = ENTITY_TYPES.reduce<Record<string, Field[]>>((acc, et) => {
    acc[et] = fields.filter(f => f.entity_type === et);
    return acc;
  }, {});

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Fields &amp; Mappings</h1>
            <p className="text-sm text-gray-500 mt-0.5">Define custom fields and map them to Shopify metafield keys.</p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700">
            + New Field
          </button>
        </div>

        {/* Filter */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setEntityFilter("")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!entityFilter ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            All
          </button>
          {ENTITY_TYPES.map(et => (
            <button key={et} onClick={() => setEntityFilter(et === entityFilter ? "" : et)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${entityFilter === et ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              {et}
            </button>
          ))}
        </div>

        {/* Add field form */}
        {showAdd && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
            <h2 className="font-semibold text-gray-900 mb-4">New Custom Field</h2>
            <form onSubmit={createField} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Entity Type</label>
                  <select required value={form.entity_type}
                    onChange={e => setForm(f => ({ ...f, entity_type: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ENTITY_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Field Type</label>
                  <select required value={form.field_type}
                    onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {FIELD_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
                <input required type="text" placeholder="e.g. Product Length" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value, key: autoKey(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Key <span className="text-gray-400">(auto-generated, editable)</span></label>
                <input required type="text" placeholder="e.g. product_length" value={form.key}
                  onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="text-gray-400">(optional)</span></label>
                <input type="text" placeholder="What is this field for?" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={saving}
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Creating..." : "Create Field"}
                </button>
                <button type="button" onClick={() => setShowAdd(false)}
                  className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Mapping modal */}
        {editMapping && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h2 className="font-semibold text-gray-900 mb-1">Shopify Metafield Mapping</h2>
              <p className="text-sm text-gray-500 mb-4">
                Map <strong>{editMapping.name}</strong> to a Shopify metafield key.
              </p>
              <form onSubmit={saveMapping} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Shopify Namespace</label>
                  <input required type="text" value={mapForm.shopify_namespace}
                    onChange={e => setMapForm(f => ({ ...f, shopify_namespace: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">Usually &quot;custom&quot; for merchant-created metafields</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Shopify Key</label>
                  <input required type="text" placeholder="e.g. len" value={mapForm.shopify_key}
                    onChange={e => setMapForm(f => ({ ...f, shopify_key: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">The exact key from your Shopify metafield definition</p>
                </div>
                <div className="pt-1 flex gap-2">
                  <button type="submit" disabled={saving}
                    className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {saving ? "Saving..." : "Save Mapping"}
                  </button>
                  <button type="button" onClick={() => setEditMapping(null)}
                    className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Fields grouped by entity */}
        {loading ? (
          <div className="text-gray-400 text-sm">Loading...</div>
        ) : fields.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
            <p className="text-sm">No custom fields yet. Create your first field above.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {ENTITY_TYPES.filter(et => !entityFilter || et === entityFilter).map(et => (
              grouped[et]?.length > 0 && (
                <div key={et} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${ENTITY_COLORS[et]}`}>{et}</span>
                    <span className="text-xs text-gray-500">{grouped[et].length} field{grouped[et].length !== 1 ? "s" : ""}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100">
                      <tr>
                        {["Name", "Key", "Type", "Description", "Shopify Mapping", ""].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {grouped[et].map(f => (
                        <tr key={f.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{f.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{f.key}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{f.field_type}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{f.description ?? "—"}</td>
                          <td className="px-4 py-3">
                            {f.mapping ? (
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">
                                  {f.mapping.shopify_namespace}.{f.mapping.shopify_key}
                                </span>
                                <button onClick={() => removeMapping(f)}
                                  className="text-xs text-red-400 hover:text-red-600">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditMapping(f); setMapForm({ shopify_namespace: "custom", shopify_key: "" }); }}
                                className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add mapping</button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => deleteField(f.id)}
                              className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

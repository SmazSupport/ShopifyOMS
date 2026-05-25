"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ENTITY_TABS = [
  { key: "order", label: "Orders" },
  { key: "line_item", label: "Line Items" },
  { key: "product", label: "Products" },
  { key: "variant", label: "Variants" },
  { key: "customer", label: "Customers" },
];

interface FieldSetting {
  id: string;
  entity_type: string;
  field_key: string;
  field_label: string | null;
  is_enabled: boolean;
  display_order: number;
  category: string | null;
  is_system: boolean;
}

export default function FieldSettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("order");
  const [fields, setFields] = useState<FieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const getToken = () => localStorage.getItem("oms_token");

  const fetchFields = useCallback(async () => {
    const token = getToken();
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    const res = await fetch(`${API_URL}/settings/fields?entity_type=${activeTab}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { router.push("/login"); return; }
    setFields(await res.json());
    setLoading(false);
    setDirty(false);
  }, [activeTab, router]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const toggle = (fieldKey: string) => {
    setFields(prev => prev.map(f => f.field_key === fieldKey ? { ...f, is_enabled: !f.is_enabled } : f));
    setDirty(true);
    setSaved(false);
  };

  const enableAll = () => {
    setFields(prev => prev.map(f => ({ ...f, is_enabled: true })));
    setDirty(true);
    setSaved(false);
  };

  const disableAll = () => {
    setFields(prev => prev.map(f => ({ ...f, is_enabled: false })));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    const token = getToken();
    setSaving(true);
    await fetch(`${API_URL}/settings/fields`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields.map(f => ({ field_key: f.field_key, is_enabled: f.is_enabled }))),
    });
    setSaving(false);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Group by category
  const grouped = fields.reduce<Record<string, FieldSetting[]>>((acc, f) => {
    const cat = f.category ?? "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(f);
    return acc;
  }, {});

  const enabledCount = fields.filter(f => f.is_enabled).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Field Settings</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Choose which Shopify fields to ingest and display. Fields you disable will be ignored during webhook processing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-sm text-green-600 font-medium">Saved ✓</span>
            )}
            <button onClick={save} disabled={!dirty || saving}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Entity tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {ENTITY_TABS.map(tab => (
            <button key={tab.key}
              onClick={() => { if (dirty && !confirm("Unsaved changes — switch anyway?")) return; setActiveTab(tab.key); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-gray-400 text-sm">Loading fields...</div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span><strong className="text-gray-900">{enabledCount}</strong> of {fields.length} fields enabled</span>
              <button onClick={enableAll} className="text-blue-600 hover:text-blue-800 font-medium">Enable all</button>
              <button onClick={disableAll} className="text-red-500 hover:text-red-700 font-medium">Disable all</button>
            </div>

            {/* Field groups */}
            <div className="space-y-4">
              {Object.entries(grouped).map(([category, catFields]) => (
                <div key={category} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</span>
                    <span className="text-xs text-gray-400">{catFields.filter(f => f.is_enabled).length}/{catFields.length}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {catFields.map(f => (
                      <label key={f.field_key}
                        className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={f.is_enabled}
                          onChange={() => toggle(f.field_key)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900">{f.field_label ?? f.field_key}</span>
                          <span className="ml-2 text-xs font-mono text-gray-400">{f.field_key}</span>
                        </div>
                        {!f.is_enabled && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">ignored</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

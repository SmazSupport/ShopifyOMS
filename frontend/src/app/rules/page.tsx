"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ───────────────────────────────────────────────────────

interface FieldTransformRule {
  id: string; name: string; source_entity: string; source_field: string;
  transform_type: string; transform_config: Record<string, any>;
  output_field_key: string; output_field_label: string; output_entity: string;
  is_active: boolean; run_order: number; notes?: string;
}
interface BundleChild { sku: string; quantity: number; }
interface BundleRule {
  id: string; parent_sku: string; bundle_name?: string;
  child_skus: BundleChild[]; ships_together: boolean;
  allow_partial_ship: boolean; notify_shopify_as_parent: boolean;
  is_active: boolean; notes?: string;
}
interface MysteryRule {
  id: string; mystery_sku: string; eligible_skus: string[];
  selection_strategy: string; fallback_sku?: string;
  exclude_if_previously_received: boolean; is_active: boolean; notes?: string;
}
interface SkuRule {
  id: string; sku: string; ships_alone: boolean; ships_alone_reason?: string;
  is_preorder: boolean; preorder_release_date?: string;
  allow_partial_ship: boolean; hold_reason?: string; is_active: boolean; notes?: string;
}

const TABS = ["Field Transforms", "Bundles", "Mystery Items", "SKU Rules"] as const;
type Tab = typeof TABS[number];

const ENTITIES = ["order", "line_item", "product", "variant", "customer"];
const TRANSFORM_TYPES = [
  { value: "first_alpha", label: "First alpha character(s)", description: "Extract leading letters — e.g. 'A5C' → 'A'" },
  { value: "first_numeric", label: "First numeric character(s)", description: "Extract leading digits — e.g. 'A5C' → '5'" },
  { value: "chars", label: "Specific characters (start/end position)", description: "Substring — e.g. characters 2–3 of 'A5C'" },
  { value: "split", label: "Split on delimiter", description: "Split value on a character and pick a part — e.g. 'A-5-C' split by '-' index 0 → 'A'" },
  { value: "if_then", label: "IF … THEN … ELSE", description: "Conditional: if value matches condition, output one value, else another" },
  { value: "formula", label: "Formula (LEFT / RIGHT / MID / UPPER / TRIM…)", description: "Spreadsheet-style string functions" },
  { value: "extract_pattern", label: "Regex pattern", description: "Advanced: extract using a regular expression with named groups" },
  { value: "custom_js", label: "Custom expression", description: "Advanced: write a Python-style expression, 'value' is the source" },
];

const STRATEGIES = [
  { value: "exclude_previously_shipped", label: "Exclude items already received by customer" },
  { value: "random", label: "Random from eligible pool" },
  { value: "sequential", label: "Sequential round-robin through pool" },
];

// ─── Helpers ─────────────────────────────────────────────────────

function authHeaders() {
  const t = typeof window !== "undefined" ? localStorage.getItem("oms_token") : null;
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function Badge({ color, label }: { color: string; label: string }) {
  const cls: Record<string, string> = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    gray: "bg-gray-100 text-gray-600",
    yellow: "bg-yellow-100 text-yellow-700",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls[color] ?? cls.gray}`}>{label}</span>;
}

// ─── Transform Config Sub-form ────────────────────────────────────

function TransformConfigForm({ type, config, onChange }: {
  type: string; config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  const inp = "border border-gray-300 rounded px-2 py-1 text-sm w-full";

  if (type === "first_alpha" || type === "first_numeric") return (
    <div className="space-y-2">
      <label className="text-xs text-gray-500">Default (if no match)</label>
      <input className={inp} placeholder="e.g. UNKNOWN" value={config.default ?? ""} onChange={e => set("default", e.target.value)} />
      {type === "first_alpha" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!config.uppercase} onChange={e => set("uppercase", e.target.checked)} />
          Convert to uppercase
        </label>
      )}
    </div>
  );

  if (type === "chars") return (
    <div className="grid grid-cols-2 gap-2">
      <div><label className="text-xs text-gray-500">Start position (0-based)</label>
        <input className={inp} type="number" min={0} value={config.start ?? 0} onChange={e => set("start", +e.target.value)} /></div>
      <div><label className="text-xs text-gray-500">End position (leave blank = to end)</label>
        <input className={inp} type="number" min={1} value={config.end ?? ""} onChange={e => set("end", e.target.value === "" ? undefined : +e.target.value)} /></div>
    </div>
  );

  if (type === "split") return (
    <div className="grid grid-cols-2 gap-2">
      <div><label className="text-xs text-gray-500">Delimiter</label>
        <input className={inp} placeholder="-" value={config.delimiter ?? ""} onChange={e => set("delimiter", e.target.value)} /></div>
      <div><label className="text-xs text-gray-500">Part index (0 = first)</label>
        <input className={inp} type="number" min={0} value={config.index ?? 0} onChange={e => set("index", +e.target.value)} /></div>
    </div>
  );

  if (type === "if_then") return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs text-gray-500">Condition type</label>
          <select className={inp} value={config.condition_type ?? "equals"} onChange={e => set("condition_type", e.target.value)}>
            {["equals","contains","starts_with","ends_with","matches","not_empty"].map(v => <option key={v} value={v}>{v}</option>)}
          </select></div>
        <div><label className="text-xs text-gray-500">Condition value</label>
          <input className={inp} placeholder="compare against..." value={config.condition_value ?? ""} onChange={e => set("condition_value", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs text-gray-500">THEN output</label>
          <input className={inp} placeholder="value if true" value={config.then_value ?? ""} onChange={e => set("then_value", e.target.value)} /></div>
        <div><label className="text-xs text-gray-500">ELSE output</label>
          <input className={inp} placeholder="value if false" value={config.else_value ?? ""} onChange={e => set("else_value", e.target.value)} /></div>
      </div>
    </div>
  );

  if (type === "formula") return (
    <div className="space-y-2">
      <div><label className="text-xs text-gray-500">Function</label>
        <select className={inp} value={config.function ?? "LEFT"} onChange={e => set("function", e.target.value)}>
          {["LEFT","RIGHT","MID","UPPER","LOWER","TRIM","LEN","CONCAT"].map(v => <option key={v}>{v}</option>)}
        </select></div>
      {(config.function === "LEFT" || config.function === "RIGHT") && (
        <div><label className="text-xs text-gray-500">Number of characters</label>
          <input className={inp} type="number" min={1} value={config.n ?? 1} onChange={e => set("n", +e.target.value)} /></div>
      )}
      {config.function === "MID" && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500">Start (1-based)</label>
            <input className={inp} type="number" min={1} value={config.start ?? 1} onChange={e => set("start", +e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Length</label>
            <input className={inp} type="number" min={1} value={config.length ?? 1} onChange={e => set("length", +e.target.value)} /></div>
        </div>
      )}
      {config.function === "CONCAT" && (
        <div><label className="text-xs text-gray-500">Parts (comma-separated, use __value__ for source field)</label>
          <input className={inp} placeholder="prefix_, __value__, _suffix"
            value={(config.parts ?? []).join(",")} onChange={e => set("parts", e.target.value.split(","))} /></div>
      )}
    </div>
  );

  if (type === "extract_pattern") return (
    <div className="space-y-2">
      <div><label className="text-xs text-gray-500">Regex pattern</label>
        <input className={`${inp} font-mono`} placeholder="([A-Z]+)(\d+)([A-Z]+)" value={config.pattern ?? ""} onChange={e => set("pattern", e.target.value)} /></div>
      <div><label className="text-xs text-gray-500">Capture group number (1 = first group)</label>
        <input className={inp} type="number" min={1} value={config.group ?? 1} onChange={e => set("group", +e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!config.case_insensitive} onChange={e => set("case_insensitive", e.target.checked)} />
        Case insensitive
      </label>
    </div>
  );

  if (type === "custom_js") return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500">Expression (<code>value</code> = source field string)</label>
      <textarea className={`${inp} font-mono h-20`} placeholder={`value[0].upper()  # first char uppercased\nre.search(r'[A-Z]+', value).group(0)  # first alpha run`}
        value={config.expression ?? ""} onChange={e => set("expression", e.target.value)} />
      <p className="text-xs text-gray-400">Available: value, re, len, str, int, float</p>
    </div>
  );

  return null;
}

// ─── Live Preview Panel ──────────────────────────────────────────

function LivePreview({ type, config }: { type: string; config: Record<string, any> }) {
  const [sample, setSample] = useState("A5C");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runPreview = useCallback(async () => {
    if (!type) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/rules/preview`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ sample_value: sample, transform_type: type, transform_config: config }),
      });
      const data = await res.json();
      setResult(String(data.output ?? "null"));
    } catch { setResult("error"); }
    setLoading(false);
  }, [type, config, sample]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-medium text-gray-600">Live Preview</p>
      <div className="flex gap-2">
        <input className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 font-mono"
          placeholder="sample value" value={sample} onChange={e => setSample(e.target.value)} />
        <button onClick={runPreview} disabled={loading}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? "…" : "Test"}
        </button>
      </div>
      {result !== null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{sample}</span>
          <span className="text-xs text-gray-400">→</span>
          <span className="font-mono text-sm font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded">{result}</span>
        </div>
      )}
    </div>
  );
}

// ─── Transform Rule Modal ─────────────────────────────────────────

function TransformModal({ rule, onSave, onClose }: {
  rule?: FieldTransformRule; onSave: (d: any) => Promise<void>; onClose: () => void;
}) {
  const blank: Partial<FieldTransformRule> = {
    name: "", source_entity: "variant", source_field: "", transform_type: "first_alpha",
    transform_config: {}, output_field_key: "", output_field_label: "", output_entity: "line_item",
    is_active: true, run_order: 0, notes: "",
  };
  const [form, setForm] = useState<Partial<FieldTransformRule>>(rule ?? blank);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const inp = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full";

  const typeInfo = TRANSFORM_TYPES.find(t => t.value === form.transform_type);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-indigo-700 text-white px-6 py-4 rounded-t-xl">
          <h2 className="font-bold text-lg">{rule ? "Edit Transform Rule" : "New Field Transform Rule"}</h2>
          <p className="text-indigo-200 text-sm mt-0.5">Derive a new computed field from an existing source field</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-xs font-medium text-gray-600">Rule name</label>
              <input className={inp} placeholder="e.g. Extract bin section" value={form.name} onChange={e => set("name", e.target.value)} /></div>
            <div><label className="text-xs font-medium text-gray-600">Source entity</label>
              <select className={inp} value={form.source_entity} onChange={e => set("source_entity", e.target.value)}>
                {ENTITIES.map(e => <option key={e}>{e}</option>)}
              </select></div>
            <div><label className="text-xs font-medium text-gray-600">Source field / metafield key</label>
              <input className={inp} placeholder="e.g. bin_number" value={form.source_field} onChange={e => set("source_field", e.target.value)} /></div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Transform type</label>
            <select className={inp} value={form.transform_type} onChange={e => { set("transform_type", e.target.value); set("transform_config", {}); }}>
              {TRANSFORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {typeInfo && <p className="text-xs text-gray-500 mt-1">{typeInfo.description}</p>}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
            <p className="text-xs font-medium text-gray-600">Configure transform</p>
            <TransformConfigForm
              type={form.transform_type ?? "first_alpha"}
              config={form.transform_config ?? {}}
              onChange={c => set("transform_config", c)}
            />
          </div>

          <LivePreview type={form.transform_type ?? ""} config={form.transform_config ?? {}} />

          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-gray-600">Output field key (slug, no spaces)</label>
              <input className={`${inp} font-mono`} placeholder="bin_section" value={form.output_field_key} onChange={e => set("output_field_key", e.target.value.replace(/\s/g, "_").toLowerCase())} /></div>
            <div><label className="text-xs font-medium text-gray-600">Output field label</label>
              <input className={inp} placeholder="Bin Section" value={form.output_field_label} onChange={e => set("output_field_label", e.target.value)} /></div>
            <div><label className="text-xs font-medium text-gray-600">Attach output to entity</label>
              <select className={inp} value={form.output_entity} onChange={e => set("output_entity", e.target.value)}>
                {ENTITIES.map(e => <option key={e}>{e}</option>)}
              </select></div>
            <div><label className="text-xs font-medium text-gray-600">Run order (lower = first)</label>
              <input className={inp} type="number" value={form.run_order ?? 0} onChange={e => set("run_order", +e.target.value)} /></div>
          </div>

          <div><label className="text-xs font-medium text-gray-600">Notes (optional)</label>
            <input className={inp} placeholder="Why this rule exists..." value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} /></div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active (rules that are off won&apos;t run)
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            disabled={saving || !form.name || !form.source_field || !form.output_field_key}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bundle Rule Modal ────────────────────────────────────────────

function BundleModal({ rule, onSave, onClose }: {
  rule?: BundleRule; onSave: (d: any) => Promise<void>; onClose: () => void;
}) {
  const blank: Partial<BundleRule> = {
    parent_sku: "", bundle_name: "", child_skus: [{ sku: "", quantity: 1 }],
    ships_together: true, allow_partial_ship: false, notify_shopify_as_parent: true, is_active: true,
  };
  const [form, setForm] = useState<Partial<BundleRule>>(rule ?? blank);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const inp = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full";

  const updateChild = (i: number, k: keyof BundleChild, v: any) => {
    const children = [...(form.child_skus ?? [])];
    children[i] = { ...children[i], [k]: v };
    set("child_skus", children);
  };
  const addChild = () => set("child_skus", [...(form.child_skus ?? []), { sku: "", quantity: 1 }]);
  const removeChild = (i: number) => set("child_skus", (form.child_skus ?? []).filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="bg-emerald-700 text-white px-6 py-4 rounded-t-xl">
          <h2 className="font-bold text-lg">{rule ? "Edit Bundle Rule" : "New Bundle Rule"}</h2>
          <p className="text-emerald-200 text-sm mt-0.5">Define a parent SKU that explodes into child SKUs when an order is ingested</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-gray-600">Parent SKU (bundle SKU on Shopify)</label>
              <input className={`${inp} font-mono`} placeholder="BUNDLE-001" value={form.parent_sku} onChange={e => set("parent_sku", e.target.value)} /></div>
            <div><label className="text-xs font-medium text-gray-600">Bundle name (optional)</label>
              <input className={inp} placeholder="Holiday Bundle" value={form.bundle_name ?? ""} onChange={e => set("bundle_name", e.target.value)} /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Child SKUs</label>
              <button onClick={addChild} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">+ Add SKU</button>
            </div>
            <div className="space-y-2">
              {(form.child_skus ?? []).map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={`${inp} flex-1 font-mono`} placeholder="CHILD-SKU" value={c.sku} onChange={e => updateChild(i, "sku", e.target.value)} />
                  <input className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 text-center" type="number" min={1} value={c.quantity}
                    onChange={e => updateChild(i, "quantity", +e.target.value)} />
                  <span className="text-xs text-gray-400">qty</span>
                  <button onClick={() => removeChild(i)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-600">Shipping behavior</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.ships_together} onChange={e => set("ships_together", e.target.checked)} />
              All children must ship together (one fulfillment group)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.allow_partial_ship} onChange={e => set("allow_partial_ship", e.target.checked)} />
              Allow partial shipment (ship available children first)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.notify_shopify_as_parent} onChange={e => set("notify_shopify_as_parent", e.target.checked)} />
              Fulfill against parent line item in Shopify (not child SKUs)
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            disabled={saving || !form.parent_sku || !(form.child_skus ?? []).some(c => c.sku)}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mystery Rule Modal ───────────────────────────────────────────

function MysteryModal({ rule, onSave, onClose }: {
  rule?: MysteryRule; onSave: (d: any) => Promise<void>; onClose: () => void;
}) {
  const blank: Partial<MysteryRule> = {
    mystery_sku: "", eligible_skus: [], selection_strategy: "exclude_previously_shipped",
    fallback_sku: "", exclude_if_previously_received: true, is_active: true,
  };
  const [form, setForm] = useState<Partial<MysteryRule>>(rule ?? blank);
  const [newSku, setNewSku] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const inp = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full";

  const addEligible = () => {
    if (!newSku.trim()) return;
    set("eligible_skus", [...(form.eligible_skus ?? []), newSku.trim()]);
    setNewSku("");
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="bg-purple-700 text-white px-6 py-4 rounded-t-xl">
          <h2 className="font-bold text-lg">{rule ? "Edit Mystery Rule" : "New Mystery Rule"}</h2>
          <p className="text-purple-200 text-sm mt-0.5">Define a mystery SKU and the eligible items pool for substitution</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-gray-600">Mystery SKU (on Shopify order)</label>
              <input className={`${inp} font-mono`} placeholder="MYSTERY-BOX" value={form.mystery_sku} onChange={e => set("mystery_sku", e.target.value)} /></div>
            <div><label className="text-xs font-medium text-gray-600">Fallback SKU (if pool exhausted)</label>
              <input className={`${inp} font-mono`} placeholder="DEFAULT-ITEM" value={form.fallback_sku ?? ""} onChange={e => set("fallback_sku", e.target.value)} /></div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Eligible item pool</label>
            <div className="flex gap-2 mt-1">
              <input className={`${inp} flex-1 font-mono`} placeholder="Add SKU to pool" value={newSku}
                onChange={e => setNewSku(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEligible()} />
              <button onClick={addEligible} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(form.eligible_skus ?? []).map((s, i) => (
                <span key={i} className="flex items-center gap-1 bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full font-mono">
                  {s}
                  <button onClick={() => set("eligible_skus", (form.eligible_skus ?? []).filter((_, j) => j !== i))} className="text-purple-400 hover:text-purple-700">✕</button>
                </span>
              ))}
              {(form.eligible_skus ?? []).length === 0 && <span className="text-xs text-gray-400 italic">No items in pool yet</span>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Selection strategy</label>
            <select className={inp} value={form.selection_strategy} onChange={e => set("selection_strategy", e.target.value)}>
              {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.exclude_if_previously_received} onChange={e => set("exclude_if_previously_received", e.target.checked)} />
            Exclude SKUs the customer has already received in past orders
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            disabled={saving || !form.mystery_sku}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SKU Rule Modal ───────────────────────────────────────────────

function SkuRuleModal({ rule, onSave, onClose }: {
  rule?: SkuRule; onSave: (d: any) => Promise<void>; onClose: () => void;
}) {
  const blank: Partial<SkuRule> = {
    sku: "", ships_alone: false, is_preorder: false, allow_partial_ship: false, is_active: true,
  };
  const [form, setForm] = useState<Partial<SkuRule>>(rule ?? blank);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const inp = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="bg-orange-700 text-white px-6 py-4 rounded-t-xl">
          <h2 className="font-bold text-lg">{rule ? "Edit SKU Rule" : "New SKU Rule"}</h2>
          <p className="text-orange-200 text-sm mt-0.5">Override shipping and hold behavior for a specific SKU</p>
        </div>
        <div className="p-6 space-y-4">
          <div><label className="text-xs font-medium text-gray-600">SKU</label>
            <input className={`${inp} font-mono`} placeholder="ITEM-SKU-123" value={form.sku} onChange={e => set("sku", e.target.value)} /></div>
          <div className="space-y-2 border border-gray-200 rounded-lg p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.ships_alone} onChange={e => set("ships_alone", e.target.checked)} />
              Ships alone (never combined with other items)
            </label>
            {form.ships_alone && <input className={inp} placeholder="Reason (e.g. oversized)" value={form.ships_alone_reason ?? ""} onChange={e => set("ships_alone_reason", e.target.value)} />}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_preorder} onChange={e => set("is_preorder", e.target.checked)} />
              Preorder — hold until release date
            </label>
            {form.is_preorder && <input className={inp} type="date" value={form.preorder_release_date ?? ""} onChange={e => set("preorder_release_date", e.target.value)} />}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.allow_partial_ship} onChange={e => set("allow_partial_ship", e.target.checked)} />
              Allow partial shipment
            </label>
          </div>
          <div><label className="text-xs font-medium text-gray-600">Hold reason (optional)</label>
            <input className={inp} placeholder="Awaiting supplier..." value={form.hold_reason ?? ""} onChange={e => set("hold_reason", e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            disabled={saving || !form.sku}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
            className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function RulesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Field Transforms");
  const [transforms, setTransforms] = useState<FieldTransformRule[]>([]);
  const [bundles, setBundles] = useState<BundleRule[]>([]);
  const [mystery, setMystery] = useState<MysteryRule[]>([]);
  const [skuRules, setSkuRules] = useState<SkuRule[]>([]);
  const [modal, setModal] = useState<{ type: Tab; rule?: any } | null>(null);
  const [loading, setLoading] = useState(false);

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`${API_URL}${path}`, { ...opts, headers: { ...authHeaders(), ...(opts?.headers ?? {}) } });
    if (res.status === 401) { router.push("/login"); throw new Error("unauth"); }
    return res.json();
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("oms_token") : null;
    if (!token) { router.push("/login"); return; }
    const [t, b, m, s] = await Promise.all([
      api("/rules/transforms"),
      api("/rules/bundles"),
      api("/rules/mystery"),
      api("/rules/sku"),
    ]);
    setTransforms(Array.isArray(t) ? t : []);
    setBundles(Array.isArray(b) ? b : []);
    setMystery(Array.isArray(m) ? m : []);
    setSkuRules(Array.isArray(s) ? s : []);
    setLoading(false);
  }, [api, router]);

  useEffect(() => { load(); }, [load]);

  const saveTransform = async (data: any) => {
    if (data.id) await api(`/rules/transforms/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/transforms", { method: "POST", body: JSON.stringify(data) });
    setModal(null); load();
  };
  const deleteTransform = async (id: string) => { await api(`/rules/transforms/${id}`, { method: "DELETE" }); load(); };

  const saveBundle = async (data: any) => {
    if (data.id) await api(`/rules/bundles/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/bundles", { method: "POST", body: JSON.stringify(data) });
    setModal(null); load();
  };
  const deleteBundle = async (id: string) => { await api(`/rules/bundles/${id}`, { method: "DELETE" }); load(); };

  const saveMystery = async (data: any) => {
    if (data.id) await api(`/rules/mystery/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/mystery", { method: "POST", body: JSON.stringify(data) });
    setModal(null); load();
  };
  const deleteMystery = async (id: string) => { await api(`/rules/mystery/${id}`, { method: "DELETE" }); load(); };

  const saveSkuRule = async (data: any) => {
    if (data.id) await api(`/rules/sku/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/sku", { method: "POST", body: JSON.stringify(data) });
    setModal(null); load();
  };
  const deleteSkuRule = async (id: string) => { await api(`/rules/sku/${id}`, { method: "DELETE" }); load(); };

  const tabColors: Record<Tab, string> = {
    "Field Transforms": "bg-indigo-600 text-white",
    "Bundles": "bg-emerald-600 text-white",
    "Mystery Items": "bg-purple-600 text-white",
    "SKU Rules": "bg-orange-600 text-white",
  };
  const newBtnColor: Record<Tab, string> = {
    "Field Transforms": "bg-indigo-600 hover:bg-indigo-700",
    "Bundles": "bg-emerald-600 hover:bg-emerald-700",
    "Mystery Items": "bg-purple-600 hover:bg-purple-700",
    "SKU Rules": "bg-orange-600 hover:bg-orange-700",
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Rules Engine</h1>
            <p className="text-sm text-gray-500 mt-1">Define no-code rules for computed fields, bundle explosion, mystery substitution, and SKU overrides</p>
          </div>
          <button
            onClick={() => setModal({ type: tab })}
            className={`px-4 py-2 text-sm text-white rounded-lg font-medium ${newBtnColor[tab]}`}>
            + New {tab === "Field Transforms" ? "Transform" : tab === "Bundles" ? "Bundle" : tab === "Mystery Items" ? "Mystery Rule" : "SKU Rule"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? tabColors[t] : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}>
              {t}
              <span className="ml-1.5 text-xs opacity-70">
                ({t === "Field Transforms" ? transforms.length : t === "Bundles" ? bundles.length : t === "Mystery Items" ? mystery.length : skuRules.length})
              </span>
            </button>
          ))}
        </div>

        {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading rules…</div>}

        {/* ── Field Transforms ── */}
        {!loading && tab === "Field Transforms" && (
          <div className="space-y-3">
            {transforms.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-medium">No transform rules yet</p>
                <p className="text-sm mt-1">Create a rule to derive computed fields from Shopify metafields or existing data</p>
              </div>
            )}
            {transforms.map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{r.name}</span>
                    {!r.is_active && <Badge color="gray" label="inactive" />}
                    <Badge color="blue" label={r.transform_type} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-sm text-gray-500 flex-wrap">
                    <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{r.source_entity}.{r.source_field}</span>
                    <span>→</span>
                    <span className="font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-xs">{r.output_entity}.{r.output_field_key}</span>
                    <span className="text-gray-400">({r.output_field_label})</span>
                  </div>
                  {r.notes && <p className="text-xs text-gray-400 mt-1">{r.notes}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setModal({ type: "Field Transforms", rule: r })}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  <button onClick={() => deleteTransform(r.id)}
                    className="text-sm text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Bundles ── */}
        {!loading && tab === "Bundles" && (
          <div className="space-y-3">
            {bundles.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-medium">No bundle rules yet</p>
                <p className="text-sm mt-1">Define parent SKUs that get exploded into child SKUs when orders arrive</p>
              </div>
            )}
            {bundles.map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-gray-900">{r.parent_sku}</span>
                    {r.bundle_name && <span className="text-gray-500 text-sm">— {r.bundle_name}</span>}
                    {!r.is_active && <Badge color="gray" label="inactive" />}
                    {r.ships_together && <Badge color="green" label="ships together" />}
                    {r.allow_partial_ship && <Badge color="yellow" label="partial ship ok" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {r.child_skus.map((c, i) => (
                      <span key={i} className="bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-mono">
                        {c.sku} ×{c.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setModal({ type: "Bundles", rule: r })}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  <button onClick={() => deleteBundle(r.id)}
                    className="text-sm text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Mystery Items ── */}
        {!loading && tab === "Mystery Items" && (
          <div className="space-y-3">
            {mystery.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-medium">No mystery rules yet</p>
                <p className="text-sm mt-1">Define mystery SKUs and their eligible item pools — OMS will pick one the customer hasn&apos;t received</p>
              </div>
            )}
            {mystery.map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-gray-900">{r.mystery_sku}</span>
                    {!r.is_active && <Badge color="gray" label="inactive" />}
                    <Badge color="blue" label={r.selection_strategy.replace(/_/g, " ")} />
                    {r.fallback_sku && <span className="text-xs text-gray-400">fallback: <span className="font-mono">{r.fallback_sku}</span></span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {r.eligible_skus.map((s, i) => (
                      <span key={i} className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full font-mono">{s}</span>
                    ))}
                    {r.eligible_skus.length === 0 && <span className="text-xs text-gray-400 italic">No eligible SKUs defined</span>}
                  </div>
                  {r.exclude_if_previously_received && (
                    <p className="text-xs text-gray-400 mt-1">✓ Excludes items customer has already received</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setModal({ type: "Mystery Items", rule: r })}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  <button onClick={() => deleteMystery(r.id)}
                    className="text-sm text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SKU Rules ── */}
        {!loading && tab === "SKU Rules" && (
          <div className="space-y-3">
            {skuRules.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-medium">No SKU rules yet</p>
                <p className="text-sm mt-1">Override shipping behavior for specific SKUs — ships alone, preorder holds, partial shipment</p>
              </div>
            )}
            {skuRules.map(r => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-gray-900">{r.sku}</span>
                    {!r.is_active && <Badge color="gray" label="inactive" />}
                    {r.ships_alone && <Badge color="yellow" label="ships alone" />}
                    {r.is_preorder && <Badge color="blue" label={`preorder${r.preorder_release_date ? ` — ${r.preorder_release_date}` : ""}`} />}
                    {r.allow_partial_ship && <Badge color="green" label="partial ship" />}
                    {r.hold_reason && <Badge color="red" label="on hold" />}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                    {r.ships_alone_reason && <p>Ships alone: {r.ships_alone_reason}</p>}
                    {r.hold_reason && <p>Hold: {r.hold_reason}</p>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setModal({ type: "SKU Rules", rule: r })}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                  <button onClick={() => deleteSkuRule(r.id)}
                    className="text-sm text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === "Field Transforms" && (
        <TransformModal rule={modal.rule} onSave={saveTransform} onClose={() => setModal(null)} />
      )}
      {modal?.type === "Bundles" && (
        <BundleModal rule={modal.rule} onSave={saveBundle} onClose={() => setModal(null)} />
      )}
      {modal?.type === "Mystery Items" && (
        <MysteryModal rule={modal.rule} onSave={saveMystery} onClose={() => setModal(null)} />
      )}
      {modal?.type === "SKU Rules" && (
        <SkuRuleModal rule={modal.rule} onSave={saveSkuRule} onClose={() => setModal(null)} />
      )}
    </AppLayout>
  );
}

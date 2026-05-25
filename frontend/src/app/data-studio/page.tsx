"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/AppLayout";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ─────────────────────────────────────────────────────────────────

type EntityType = "order" | "line_item" | "variant" | "product" | "customer";
type TopTab = "fields" | "transforms" | "bundles" | "sku_rules" | "mystery";

interface CustomField {
  id: string; entity_type: string; name: string; key: string;
  field_type: string; description: string | null;
  mapping: { id: string; shopify_namespace: string; shopify_key: string } | null;
}
interface FieldSetting {
  id: string; entity_type: string; field_key: string; field_label: string | null;
  is_enabled: boolean; display_order: number; category: string | null; is_system: boolean;
}
interface FieldTransformRule {
  id: string; name: string; source_entity: string; source_field: string;
  transform_type: string; transform_config: Record<string, unknown>;
  output_field_key: string; output_field_label: string; output_entity: string;
  is_active: boolean; run_order: number; notes?: string;
}
interface BundleChild { sku: string; quantity: number; }
interface BundleRule {
  id: string; parent_sku: string; bundle_name?: string;
  child_skus: BundleChild[]; ships_together: boolean;
  allow_partial_ship: boolean; notify_shopify_as_parent: boolean;
  read_from_shopify: boolean; shopify_bundle_field?: string;
  companion_skus?: string[];
  is_active: boolean; notes?: string;
}
interface SkuRule {
  id: string; sku: string; ships_alone: boolean; ships_alone_reason?: string;
  companion_skus?: string[];
  is_preorder: boolean; preorder_release_date?: string;
  allow_partial_ship: boolean; hold_reason?: string; is_active: boolean; notes?: string;
}
interface MysteryRule {
  id: string; mystery_sku: string; eligible_skus: string[];
  selection_strategy: string; fallback_sku?: string;
  exclude_if_previously_received: boolean; is_active: boolean; notes?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ENTITIES: { key: EntityType; label: string; color: string; dot: string }[] = [
  { key: "order",     label: "Orders",     color: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  { key: "line_item", label: "Line Items", color: "bg-blue-100 text-blue-800",       dot: "bg-blue-500" },
  { key: "variant",   label: "Variants",   color: "bg-indigo-100 text-indigo-800",   dot: "bg-indigo-500" },
  { key: "product",   label: "Products",   color: "bg-orange-100 text-orange-800",   dot: "bg-orange-500" },
  { key: "customer",  label: "Customers",  color: "bg-purple-100 text-purple-800",   dot: "bg-purple-500" },
];

const TRANSFORM_TYPES = [
  { value: "first_alpha",      label: "First alpha chars" },
  { value: "first_numeric",    label: "First numeric chars" },
  { value: "chars",            label: "Substring (start/end)" },
  { value: "split",            label: "Split on delimiter" },
  { value: "if_then",          label: "IF … THEN … ELSE" },
  { value: "formula",          label: "Formula (LEFT/RIGHT/MID…)" },
  { value: "extract_pattern",  label: "Regex extract" },
  { value: "custom_js",        label: "Custom expression" },
];

const FIELD_TYPES = ["text", "number", "boolean", "date", "json"];

const STRATEGIES = [
  { value: "exclude_previously_shipped", label: "Exclude items already received by customer" },
  { value: "random",      label: "Random from pool" },
  { value: "sequential",  label: "Sequential round-robin" },
];

const TAB_CONFIG: { key: TopTab; label: string; accent: string }[] = [
  { key: "fields",     label: "Fields & Mappings",  accent: "text-blue-600 border-blue-600" },
  { key: "transforms", label: "Transforms",          accent: "text-indigo-600 border-indigo-600" },
  { key: "bundles",    label: "Bundles",             accent: "text-emerald-600 border-emerald-600" },
  { key: "sku_rules",  label: "SKU Rules",           accent: "text-orange-600 border-orange-600" },
  { key: "mystery",    label: "Mystery Items",       accent: "text-purple-600 border-purple-600" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function token() { return typeof window !== "undefined" ? localStorage.getItem("oms_token") ?? "" : ""; }
function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function EntityBadge({ type }: { type: string }) {
  const e = ENTITIES.find(x => x.key === type);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${e?.color ?? "bg-gray-100 text-gray-600"}`}>{type}</span>;
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{active ? "Active" : "Off"}</span>;
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <tr><td colSpan={99}>
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-gray-400">{message}</p>
        {sub && <p className="text-xs text-gray-300 mt-1">{sub}</p>}
      </div>
    </td></tr>
  );
}

// ─── Slide-In Panel ────────────────────────────────────────────────────────

function SlidePanel({ open, onClose, title, subtitle, accentColor, children }: {
  open: boolean; onClose: () => void;
  title: string; subtitle?: string; accentColor?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <>
      <div className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
      <div ref={ref} className={`fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className={`px-6 py-5 border-b border-gray-100 ${accentColor ?? "bg-gray-900"}`}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-bold text-white text-lg">{title}</h2>
              {subtitle && <p className="text-sm text-white/70 mt-0.5">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none ml-4">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {children}
        </div>
      </div>
    </>
  );
}

// ─── Shared Form Atoms ─────────────────────────────────────────────────────

const inp = "border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500";
const label = (txt: string) => <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{txt}</label>;

function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

function ToggleRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      <span className="text-sm text-gray-700">{children}</span>
    </label>
  );
}

function SaveBar({ onSave, onCancel, saving, disabled }: {
  onSave: () => void; onCancel: () => void; saving: boolean; disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 pt-4 border-t border-gray-100">
      <button onClick={onSave} disabled={saving || disabled}
        className="flex-1 py-2.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40">
        {saving ? "Saving…" : "Save"}
      </button>
      <button onClick={onCancel} className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
    </div>
  );
}

// ─── Transform Config Sub-form ─────────────────────────────────────────────

function TransformConfig({ type, config, onChange }: {
  type: string; config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });

  if (type === "first_alpha" || type === "first_numeric") return (
    <div className="space-y-3">
      <FormRow>{label("Default if no match")}<input className={inp} value={String(config.default ?? "")} onChange={e => set("default", e.target.value)} /></FormRow>
      {type === "first_alpha" && <ToggleRow checked={!!config.uppercase} onChange={v => set("uppercase", v)}>Convert to uppercase</ToggleRow>}
    </div>
  );

  if (type === "chars") return (
    <div className="grid grid-cols-2 gap-3">
      <FormRow>{label("Start (0-based)")}<input className={inp} type="number" min={0} value={Number(config.start ?? 0)} onChange={e => set("start", +e.target.value)} /></FormRow>
      <FormRow>{label("End (blank = to end)")}<input className={inp} type="number" min={1} value={config.end !== undefined ? String(config.end) : ""} onChange={e => set("end", e.target.value === "" ? undefined : +e.target.value)} /></FormRow>
    </div>
  );

  if (type === "split") return (
    <div className="grid grid-cols-2 gap-3">
      <FormRow>{label("Delimiter")}<input className={inp} placeholder="-" value={String(config.delimiter ?? "")} onChange={e => set("delimiter", e.target.value)} /></FormRow>
      <FormRow>{label("Part index (0=first)")}<input className={inp} type="number" min={0} value={Number(config.index ?? 0)} onChange={e => set("index", +e.target.value)} /></FormRow>
    </div>
  );

  if (type === "if_then") return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Condition type")}
          <select className={inp} value={String(config.condition_type ?? "equals")} onChange={e => set("condition_type", e.target.value)}>
            {["equals","contains","starts_with","ends_with","matches","not_empty"].map(v => <option key={v}>{v}</option>)}
          </select>
        </FormRow>
        <FormRow>{label("Compare value")}<input className={inp} value={String(config.condition_value ?? "")} onChange={e => set("condition_value", e.target.value)} /></FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("THEN output")}<input className={inp} placeholder="value if true" value={String(config.then_value ?? "")} onChange={e => set("then_value", e.target.value)} /></FormRow>
        <FormRow>{label("ELSE output")}<input className={inp} placeholder="value if false" value={String(config.else_value ?? "")} onChange={e => set("else_value", e.target.value)} /></FormRow>
      </div>
    </div>
  );

  if (type === "formula") return (
    <div className="space-y-3">
      <FormRow>{label("Function")}
        <select className={inp} value={String(config.function ?? "LEFT")} onChange={e => set("function", e.target.value)}>
          {["LEFT","RIGHT","MID","UPPER","LOWER","TRIM","LEN","CONCAT"].map(v => <option key={v}>{v}</option>)}
        </select>
      </FormRow>
      {(config.function === "LEFT" || config.function === "RIGHT") && (
        <FormRow>{label("Number of chars")}<input className={inp} type="number" min={1} value={Number(config.n ?? 1)} onChange={e => set("n", +e.target.value)} /></FormRow>
      )}
      {config.function === "MID" && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow>{label("Start (1-based)")}<input className={inp} type="number" min={1} value={Number(config.start ?? 1)} onChange={e => set("start", +e.target.value)} /></FormRow>
          <FormRow>{label("Length")}<input className={inp} type="number" min={1} value={Number(config.length ?? 1)} onChange={e => set("length", +e.target.value)} /></FormRow>
        </div>
      )}
    </div>
  );

  if (type === "extract_pattern") return (
    <div className="space-y-3">
      <FormRow>{label("Pattern")}<input className={`${inp} font-mono`} placeholder="([A-Z]+)(\d+)" value={String(config.pattern ?? "")} onChange={e => set("pattern", e.target.value)} /></FormRow>
      <FormRow>{label("Group # (1=first)")}<input className={inp} type="number" min={1} value={Number(config.group ?? 1)} onChange={e => set("group", +e.target.value)} /></FormRow>
      <ToggleRow checked={!!config.case_insensitive} onChange={v => set("case_insensitive", v)}>Case insensitive</ToggleRow>
    </div>
  );

  if (type === "custom_js") return (
    <FormRow>
      {label("Expression (value = source field)")}
      <textarea className={`${inp} font-mono h-24`} placeholder={`value[0].upper()\nre.search(r'[A-Z]+', value).group(0)`}
        value={String(config.expression ?? "")} onChange={e => set("expression", e.target.value)} />
      <p className="text-xs text-gray-400">Available: value, re, len, str, int, float</p>
    </FormRow>
  );
  return null;
}

// ─── Live Preview ──────────────────────────────────────────────────────────

function LivePreview({ type, config }: { type: string; config: Record<string, unknown> }) {
  const [sample, setSample] = useState("A5C");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/rules/preview`, {
        method: "POST", headers: headers(true),
        body: JSON.stringify({ sample_value: sample, transform_type: type, transform_config: config }),
      });
      const d = await res.json();
      setResult(String(d.output ?? "null"));
    } catch { setResult("error"); }
    setLoading(false);
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Live Preview</p>
      <div className="flex gap-2">
        <input className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm flex-1 font-mono"
          value={sample} onChange={e => setSample(e.target.value)} placeholder="test value" />
        <button onClick={run} disabled={loading}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {loading ? "…" : "Test"}
        </button>
      </div>
      {result !== null && (
        <div className="flex items-center gap-2 mt-2">
          <span className="font-mono text-xs text-gray-400">{sample}</span>
          <span className="text-gray-300">→</span>
          <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{result}</span>
        </div>
      )}
    </div>
  );
}

// ─── Panel: Custom Field ───────────────────────────────────────────────────

function FieldPanel({ field, onSave, onClose, onDelete }: {
  field: Partial<CustomField> | null; onSave: (d: Partial<CustomField>) => Promise<void>;
  onClose: () => void; onDelete?: (id: string) => Promise<void>;
}) {
  const blank: Partial<CustomField> = { entity_type: "variant", name: "", key: "", field_type: "text", description: "" };
  const [form, setForm] = useState<Partial<CustomField>>(field ?? blank);
  const [mapForm, setMapForm] = useState({ shopify_namespace: field?.mapping?.shopify_namespace ?? "custom", shopify_key: field?.mapping?.shopify_key ?? "" });
  const [showMap, setShowMap] = useState(!!field?.mapping);
  const [saving, setSaving] = useState(false);

  const autoKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const set = (k: keyof CustomField, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const isNew = !field?.id;
  const title = isNew ? "New Custom Field" : form.name ?? "Edit Field";

  return (
    <SlidePanel open title={title} subtitle="Define a custom field and optionally map it to a Shopify metafield" accentColor="bg-blue-700" onClose={onClose}>
      <FormRow>{label("Entity")}<select className={inp} value={form.entity_type} onChange={e => set("entity_type", e.target.value as EntityType)}>{ENTITIES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></FormRow>
      <FormRow>{label("Display name")}<input className={inp} value={form.name ?? ""} onChange={e => { set("name", e.target.value); if (isNew) set("key", autoKey(e.target.value)); }} placeholder="e.g. Bin Section" /></FormRow>
      <FormRow>{label("Field key (slug)")}<input className={`${inp} font-mono`} value={form.key ?? ""} onChange={e => set("key", e.target.value)} placeholder="bin_section" /></FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Type")}<select className={inp} value={form.field_type ?? "text"} onChange={e => set("field_type", e.target.value)}>{FIELD_TYPES.map(t => <option key={t}>{t}</option>)}</select></FormRow>
      </div>
      <FormRow>{label("Description (optional)")}<input className={inp} value={form.description ?? ""} onChange={e => set("description", e.target.value)} placeholder="What is this field for?" /></FormRow>

      <div className="border-t border-gray-100 pt-4">
        <ToggleRow checked={showMap} onChange={setShowMap}>Map to Shopify metafield</ToggleRow>
        {showMap && (
          <div className="mt-3 space-y-3 pl-12">
            <FormRow>{label("Shopify namespace")}<input className={`${inp} font-mono`} value={mapForm.shopify_namespace} onChange={e => setMapForm(p => ({ ...p, shopify_namespace: e.target.value }))} /></FormRow>
            <FormRow>{label("Shopify key")}<input className={`${inp} font-mono`} value={mapForm.shopify_key} onChange={e => setMapForm(p => ({ ...p, shopify_key: e.target.value }))} placeholder="e.g. bin_number" /></FormRow>
            <p className="text-xs text-gray-400">OMS will read this Shopify metafield value and store it under this field key</p>
          </div>
        )}
      </div>

      <SaveBar saving={saving} disabled={!form.name || !form.key}
        onCancel={onClose}
        onSave={async () => {
          setSaving(true);
          const payload = { ...form, _mapping: showMap ? mapForm : null };
          await onSave(payload as Partial<CustomField>);
          setSaving(false);
        }} />

      {!isNew && onDelete && (
        <button onClick={() => onDelete(field!.id!)} className="w-full py-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50">
          Delete field
        </button>
      )}
    </SlidePanel>
  );
}

// ─── Panel: Transform Rule ─────────────────────────────────────────────────

function TransformPanel({ rule, onSave, onClose, onDelete }: {
  rule: Partial<FieldTransformRule> | null; onSave: (d: Partial<FieldTransformRule>) => Promise<void>;
  onClose: () => void; onDelete?: (id: string) => Promise<void>;
}) {
  const blank: Partial<FieldTransformRule> = {
    name: "", source_entity: "variant", source_field: "", transform_type: "first_alpha",
    transform_config: {}, output_field_key: "", output_field_label: "", output_entity: "line_item",
    is_active: true, run_order: 0,
  };
  const [form, setForm] = useState<Partial<FieldTransformRule>>(rule ?? blank);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FieldTransformRule, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <SlidePanel open
      title={rule?.id ? (form.name ?? "Edit Transform") : "New Transform Rule"}
      subtitle="Derive a computed field from any source field"
      accentColor="bg-indigo-700" onClose={onClose}>

      <FormRow>{label("Rule name")}<input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="e.g. Extract bin section" /></FormRow>

      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Source entity")}<select className={inp} value={form.source_entity} onChange={e => set("source_entity", e.target.value)}>{ENTITIES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></FormRow>
        <FormRow>{label("Source field / metafield key")}<input className={`${inp} font-mono`} value={form.source_field ?? ""} onChange={e => set("source_field", e.target.value)} placeholder="bin_number" /></FormRow>
      </div>

      <FormRow>{label("Transform type")}
        <select className={inp} value={form.transform_type} onChange={e => { set("transform_type", e.target.value); set("transform_config", {}); }}>
          {TRANSFORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </FormRow>

      <div className="bg-gray-50 rounded-lg p-3 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Configure</p>
        <TransformConfig type={form.transform_type ?? "first_alpha"} config={form.transform_config ?? {}} onChange={c => set("transform_config", c)} />
      </div>

      <LivePreview type={form.transform_type ?? ""} config={form.transform_config ?? {}} />

      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Output field key")}<input className={`${inp} font-mono`} value={form.output_field_key ?? ""} onChange={e => set("output_field_key", e.target.value.replace(/\s/g, "_").toLowerCase())} placeholder="bin_section" /></FormRow>
        <FormRow>{label("Output label")}<input className={inp} value={form.output_field_label ?? ""} onChange={e => set("output_field_label", e.target.value)} placeholder="Bin Section" /></FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Attach to entity")}<select className={inp} value={form.output_entity} onChange={e => set("output_entity", e.target.value)}>{ENTITIES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></FormRow>
        <FormRow>{label("Run order")}<input className={inp} type="number" value={form.run_order ?? 0} onChange={e => set("run_order", +e.target.value)} /></FormRow>
      </div>
      <FormRow>{label("Notes")}<input className={inp} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} /></FormRow>
      <ToggleRow checked={!!form.is_active} onChange={v => set("is_active", v)}>Active</ToggleRow>

      <SaveBar saving={saving} disabled={!form.name || !form.source_field || !form.output_field_key}
        onCancel={onClose}
        onSave={async () => { setSaving(true); await onSave(form); setSaving(false); }} />
      {rule?.id && onDelete && (
        <button onClick={() => onDelete(rule.id!)} className="w-full py-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50">Delete rule</button>
      )}
    </SlidePanel>
  );
}

// ─── Panel: Bundle Rule ────────────────────────────────────────────────────

function BundlePanel({ rule, onSave, onClose, onDelete }: {
  rule: Partial<BundleRule> | null; onSave: (d: Partial<BundleRule>) => Promise<void>;
  onClose: () => void; onDelete?: (id: string) => Promise<void>;
}) {
  const blank: Partial<BundleRule> = {
    parent_sku: "", bundle_name: "", child_skus: [{ sku: "", quantity: 1 }],
    ships_together: true, allow_partial_ship: false, notify_shopify_as_parent: true,
    read_from_shopify: false, companion_skus: [], is_active: true,
  };
  const [form, setForm] = useState<Partial<BundleRule>>(rule ?? blank);
  const [newCompanion, setNewCompanion] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof BundleRule, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const updateChild = (i: number, k: keyof BundleChild, v: string | number) => {
    const arr = [...(form.child_skus ?? [])];
    arr[i] = { ...arr[i], [k]: v };
    set("child_skus", arr);
  };

  return (
    <SlidePanel open
      title={rule?.id ? (form.parent_sku ?? "Edit Bundle") : "New Bundle Rule"}
      subtitle="Define a parent SKU that explodes into child SKUs"
      accentColor="bg-emerald-700" onClose={onClose}>

      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Parent SKU")}<input className={`${inp} font-mono`} value={form.parent_sku ?? ""} onChange={e => set("parent_sku", e.target.value)} placeholder="BUNDLE-001" /></FormRow>
        <FormRow>{label("Bundle name")}<input className={inp} value={form.bundle_name ?? ""} onChange={e => set("bundle_name", e.target.value)} placeholder="Holiday Bundle" /></FormRow>
      </div>

      <div className="space-y-2">
        <ToggleRow checked={!!form.read_from_shopify} onChange={v => set("read_from_shopify", v)}>
          Read bundle children from Shopify field
        </ToggleRow>
        {form.read_from_shopify ? (
          <div className="pl-12">
            <FormRow>{label("Shopify bundle field / metafield key")}<input className={`${inp} font-mono`} value={form.shopify_bundle_field ?? ""} onChange={e => set("shopify_bundle_field", e.target.value)} placeholder="bundle_contents" /></FormRow>
            <p className="text-xs text-gray-400 mt-1">OMS will read your existing Shopify bundle structure from this metafield instead of the list below</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Child SKUs</p>
              <button onClick={() => set("child_skus", [...(form.child_skus ?? []), { sku: "", quantity: 1 }])}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold">+ Add SKU</button>
            </div>
            <div className="space-y-2">
              {(form.child_skus ?? []).map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={`${inp} flex-1 font-mono`} placeholder="CHILD-SKU" value={c.sku} onChange={e => updateChild(i, "sku", e.target.value)} />
                  <input className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-16 text-center" type="number" min={1} value={c.quantity} onChange={e => updateChild(i, "quantity", +e.target.value)} />
                  <span className="text-xs text-gray-400">qty</span>
                  <button onClick={() => set("child_skus", (form.child_skus ?? []).filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Companion items</p>
        <p className="text-xs text-gray-400">Items that ship <em>with</em> this bundle but aren&apos;t bundle children — e.g. an insert or bonus item</p>
        <div className="flex gap-2">
          <input className={`${inp} flex-1 font-mono`} placeholder="Add companion SKU" value={newCompanion}
            onChange={e => setNewCompanion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newCompanion.trim()) { set("companion_skus", [...(form.companion_skus ?? []), newCompanion.trim()]); setNewCompanion(""); } }} />
          <button onClick={() => { if (newCompanion.trim()) { set("companion_skus", [...(form.companion_skus ?? []), newCompanion.trim()]); setNewCompanion(""); } }}
            className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg">Add</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(form.companion_skus ?? []).map((s, i) => (
            <span key={i} className="flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs px-2 py-1 rounded-full font-mono">
              {s}<button onClick={() => set("companion_skus", (form.companion_skus ?? []).filter((_, j) => j !== i))} className="text-emerald-400 hover:text-emerald-700">✕</button>
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Shipping options</p>
        <ToggleRow checked={!!form.ships_together} onChange={v => set("ships_together", v)}>All children must ship together</ToggleRow>
        <ToggleRow checked={!!form.allow_partial_ship} onChange={v => set("allow_partial_ship", v)}>Allow partial shipment</ToggleRow>
        <ToggleRow checked={!!form.notify_shopify_as_parent} onChange={v => set("notify_shopify_as_parent", v)}>Fulfill against parent SKU in Shopify</ToggleRow>
      </div>

      <ToggleRow checked={!!form.is_active} onChange={v => set("is_active", v)}>Active</ToggleRow>

      <SaveBar saving={saving} disabled={!form.parent_sku}
        onCancel={onClose}
        onSave={async () => { setSaving(true); await onSave(form); setSaving(false); }} />
      {rule?.id && onDelete && (
        <button onClick={() => onDelete(rule.id!)} className="w-full py-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50">Delete rule</button>
      )}
    </SlidePanel>
  );
}

// ─── Panel: SKU Rule ───────────────────────────────────────────────────────

function SkuPanel({ rule, onSave, onClose, onDelete }: {
  rule: Partial<SkuRule> | null; onSave: (d: Partial<SkuRule>) => Promise<void>;
  onClose: () => void; onDelete?: (id: string) => Promise<void>;
}) {
  const blank: Partial<SkuRule> = { sku: "", ships_alone: false, companion_skus: [], is_preorder: false, allow_partial_ship: false, is_active: true };
  const [form, setForm] = useState<Partial<SkuRule>>(rule ?? blank);
  const [newCompanion, setNewCompanion] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof SkuRule, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <SlidePanel open
      title={rule?.id ? (form.sku ?? "Edit SKU Rule") : "New SKU Rule"}
      subtitle="Override shipping and hold behavior for a specific SKU"
      accentColor="bg-orange-700" onClose={onClose}>

      <FormRow>{label("SKU")}<input className={`${inp} font-mono`} value={form.sku ?? ""} onChange={e => set("sku", e.target.value)} placeholder="ITEM-SKU" /></FormRow>

      <div className="space-y-3">
        <ToggleRow checked={!!form.ships_alone} onChange={v => set("ships_alone", v)}>Ships alone (never combined)</ToggleRow>
        {form.ships_alone && (
          <div className="pl-12 space-y-3">
            <FormRow>{label("Reason")}<input className={inp} value={form.ships_alone_reason ?? ""} onChange={e => set("ships_alone_reason", e.target.value)} placeholder="e.g. oversized" /></FormRow>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Companion items (ship with this SKU)</p>
              <p className="text-xs text-gray-400 mb-2">Items that always ship alongside this SKU even though it ships alone from other items</p>
              <div className="flex gap-2 mb-2">
                <input className={`${inp} flex-1 font-mono`} placeholder="Companion SKU" value={newCompanion}
                  onChange={e => setNewCompanion(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newCompanion.trim()) { set("companion_skus", [...(form.companion_skus ?? []), newCompanion.trim()]); setNewCompanion(""); } }} />
                <button onClick={() => { if (newCompanion.trim()) { set("companion_skus", [...(form.companion_skus ?? []), newCompanion.trim()]); setNewCompanion(""); } }}
                  className="px-3 py-2 text-sm bg-orange-600 text-white rounded-lg">Add</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(form.companion_skus ?? []).map((s, i) => (
                  <span key={i} className="flex items-center gap-1 bg-orange-50 text-orange-700 text-xs px-2 py-1 rounded-full font-mono">
                    {s}<button onClick={() => set("companion_skus", (form.companion_skus ?? []).filter((_, j) => j !== i))} className="text-orange-400 hover:text-orange-700">✕</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <ToggleRow checked={!!form.is_preorder} onChange={v => set("is_preorder", v)}>Preorder — hold until release date</ToggleRow>
      {form.is_preorder && (
        <div className="pl-12">
          <FormRow>{label("Release date")}<input className={inp} type="date" value={form.preorder_release_date ?? ""} onChange={e => set("preorder_release_date", e.target.value)} /></FormRow>
        </div>
      )}

      <ToggleRow checked={!!form.allow_partial_ship} onChange={v => set("allow_partial_ship", v)}>Allow partial shipment</ToggleRow>
      <FormRow>{label("Hold reason (optional)")}<input className={inp} value={form.hold_reason ?? ""} onChange={e => set("hold_reason", e.target.value)} /></FormRow>
      <ToggleRow checked={!!form.is_active} onChange={v => set("is_active", v)}>Active</ToggleRow>

      <SaveBar saving={saving} disabled={!form.sku}
        onCancel={onClose}
        onSave={async () => { setSaving(true); await onSave(form); setSaving(false); }} />
      {rule?.id && onDelete && (
        <button onClick={() => onDelete(rule.id!)} className="w-full py-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50">Delete rule</button>
      )}
    </SlidePanel>
  );
}

// ─── Panel: Mystery Rule ───────────────────────────────────────────────────

function MysteryPanel({ rule, onSave, onClose, onDelete }: {
  rule: Partial<MysteryRule> | null; onSave: (d: Partial<MysteryRule>) => Promise<void>;
  onClose: () => void; onDelete?: (id: string) => Promise<void>;
}) {
  const blank: Partial<MysteryRule> = { mystery_sku: "", eligible_skus: [], selection_strategy: "exclude_previously_shipped", exclude_if_previously_received: true, is_active: true };
  const [form, setForm] = useState<Partial<MysteryRule>>(rule ?? blank);
  const [newSku, setNewSku] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof MysteryRule, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <SlidePanel open
      title={rule?.id ? (form.mystery_sku ?? "Edit Mystery Rule") : "New Mystery Rule"}
      subtitle="Define a mystery SKU and its eligible item pool"
      accentColor="bg-purple-700" onClose={onClose}>

      <div className="grid grid-cols-2 gap-3">
        <FormRow>{label("Mystery SKU")}<input className={`${inp} font-mono`} value={form.mystery_sku ?? ""} onChange={e => set("mystery_sku", e.target.value)} /></FormRow>
        <FormRow>{label("Fallback SKU")}<input className={`${inp} font-mono`} value={form.fallback_sku ?? ""} onChange={e => set("fallback_sku", e.target.value)} /></FormRow>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Eligible item pool</p>
        <div className="flex gap-2 mb-2">
          <input className={`${inp} flex-1 font-mono`} placeholder="Add SKU to pool" value={newSku}
            onChange={e => setNewSku(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newSku.trim()) { set("eligible_skus", [...(form.eligible_skus ?? []), newSku.trim()]); setNewSku(""); } }} />
          <button onClick={() => { if (newSku.trim()) { set("eligible_skus", [...(form.eligible_skus ?? []), newSku.trim()]); setNewSku(""); } }}
            className="px-3 py-2 text-sm bg-purple-600 text-white rounded-lg">Add</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(form.eligible_skus ?? []).map((s, i) => (
            <span key={i} className="flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2 py-1 rounded-full font-mono">
              {s}<button onClick={() => set("eligible_skus", (form.eligible_skus ?? []).filter((_, j) => j !== i))} className="text-purple-400 hover:text-purple-700">✕</button>
            </span>
          ))}
          {(form.eligible_skus ?? []).length === 0 && <span className="text-xs text-gray-400 italic">No items added yet</span>}
        </div>
      </div>

      <FormRow>{label("Selection strategy")}
        <select className={inp} value={form.selection_strategy} onChange={e => set("selection_strategy", e.target.value)}>
          {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </FormRow>
      <ToggleRow checked={!!form.exclude_if_previously_received} onChange={v => set("exclude_if_previously_received", v)}>Exclude items customer already received</ToggleRow>
      <ToggleRow checked={!!form.is_active} onChange={v => set("is_active", v)}>Active</ToggleRow>

      <SaveBar saving={saving} disabled={!form.mystery_sku}
        onCancel={onClose}
        onSave={async () => { setSaving(true); await onSave(form); setSaving(false); }} />
      {rule?.id && onDelete && (
        <button onClick={() => onDelete(rule.id!)} className="w-full py-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50">Delete rule</button>
      )}
    </SlidePanel>
  );
}

// ─── Table wrapper ─────────────────────────────────────────────────────────

function DataTable({ headers: ths, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {ths.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  );
}

// ─── Search + Filter Bar ───────────────────────────────────────────────────

function FilterBar({ search, onSearch, entity, onEntity, newLabel, onNew }: {
  search: string; onSearch: (v: string) => void;
  entity: string; onEntity: (v: string) => void;
  newLabel: string; onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <input className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search…" value={search} onChange={e => onSearch(e.target.value)} />
        <span className="absolute left-3 top-2.5 text-gray-400 text-sm">⌕</span>
      </div>
      <div className="flex gap-1 flex-wrap">
        <button onClick={() => onEntity("")}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${!entity ? "bg-gray-900 text-white" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>All</button>
        {ENTITIES.map(e => (
          <button key={e.key} onClick={() => onEntity(entity === e.key ? "" : e.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${entity === e.key ? "bg-gray-900 text-white" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${e.dot}`} />{e.label}
          </button>
        ))}
      </div>
      <button onClick={onNew} className="ml-auto px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 whitespace-nowrap">
        + {newLabel}
      </button>
    </div>
  );
}

// ─── Tab: Fields & Mappings ────────────────────────────────────────────────

function FieldsTab({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("");
  const [panel, setPanel] = useState<Partial<CustomField> | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api("/fields") as CustomField[];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    (!entity || r.entity_type === entity) &&
    (!search || r.name.toLowerCase().includes(search) || r.key.includes(search))
  );

  const save = async (data: Partial<CustomField> & { _mapping?: { shopify_namespace: string; shopify_key: string } | null }) => {
    const { _mapping, ...body } = data;
    if (data.id) {
      await api(`/fields/${data.id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      const created = await api("/fields", { method: "POST", body: JSON.stringify(body) }) as CustomField;
      if (_mapping?.shopify_key && created.id) {
        await api(`/fields/${created.id}/mapping`, { method: "PUT", body: JSON.stringify(_mapping) });
      }
      setPanel(null); load(); return;
    }
    if (_mapping === null && data.id) {
      await api(`/fields/${data.id}/mapping`, { method: "DELETE" }).catch(() => {});
    } else if (_mapping?.shopify_key && data.id) {
      await api(`/fields/${data.id}/mapping`, { method: "PUT", body: JSON.stringify(_mapping) });
    }
    setPanel(null); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this field and all its values?")) return;
    await api(`/fields/${id}`, { method: "DELETE" });
    setPanel(null); load();
  };

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} entity={entity} onEntity={setEntity} newLabel="New Field" onNew={() => setPanel("new")} />
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <DataTable headers={["Name", "Key", "Entity", "Type", "Shopify Mapping", ""]}>
          {filtered.length === 0
            ? <EmptyState message="No custom fields" sub="Create a field to start collecting custom data" />
            : filtered.map(r => (
              <tr key={r.id} onClick={() => setPanel(r)}
                className="hover:bg-blue-50/40 cursor-pointer group transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.key}</td>
                <td className="px-4 py-3"><EntityBadge type={r.entity_type} /></td>
                <td className="px-4 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{r.field_type}</span></td>
                <td className="px-4 py-3">
                  {r.mapping
                    ? <span className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">{r.mapping.shopify_namespace}.{r.mapping.shopify_key}</span>
                    : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100">
                  <span className="text-xs text-blue-500 font-medium">Edit →</span>
                </td>
              </tr>
            ))}
        </DataTable>
      )}
      {panel !== null && (
        <FieldPanel field={panel === "new" ? null : panel} onSave={save} onClose={() => setPanel(null)} onDelete={del} />
      )}
    </div>
  );
}

// ─── Tab: Transforms ──────────────────────────────────────────────────────

function TransformsTab({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<FieldTransformRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("");
  const [panel, setPanel] = useState<Partial<FieldTransformRule> | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api("/rules/transforms") as FieldTransformRule[];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    (!entity || r.source_entity === entity || r.output_entity === entity) &&
    (!search || r.name.toLowerCase().includes(search) || r.source_field.includes(search) || r.output_field_key.includes(search))
  );

  const save = async (data: Partial<FieldTransformRule>) => {
    if (data.id) await api(`/rules/transforms/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/transforms", { method: "POST", body: JSON.stringify(data) });
    setPanel(null); load();
  };
  const del = async (id: string) => { if (!confirm("Delete this transform rule?")) return; await api(`/rules/transforms/${id}`, { method: "DELETE" }); setPanel(null); load(); };

  const toggle = async (r: FieldTransformRule) => {
    await api(`/rules/transforms/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, is_active: !r.is_active }) });
    load();
  };

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} entity={entity} onEntity={setEntity} newLabel="New Transform" onNew={() => setPanel("new")} />
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <DataTable headers={["Name", "Source", "Transform", "Output", "Status", ""]}>
          {filtered.length === 0
            ? <EmptyState message="No transform rules" sub="Create a rule to derive computed fields from source data" />
            : filtered.map(r => (
              <tr key={r.id} onClick={() => setPanel(r)}
                className="hover:bg-indigo-50/40 cursor-pointer group transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <EntityBadge type={r.source_entity} />
                    <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{r.source_field}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">{r.transform_type.replace(/_/g, " ")}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <EntityBadge type={r.output_entity} />
                    <span className="font-mono text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{r.output_field_key}</span>
                  </div>
                </td>
                <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(r); }}>
                  <StatusPill active={r.is_active} />
                </td>
                <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100">
                  <span className="text-xs text-blue-500 font-medium">Edit →</span>
                </td>
              </tr>
            ))}
        </DataTable>
      )}
      {panel !== null && (
        <TransformPanel rule={panel === "new" ? null : panel} onSave={save} onClose={() => setPanel(null)} onDelete={del} />
      )}
    </div>
  );
}

// ─── Tab: Bundles ──────────────────────────────────────────────────────────

function BundlesTab({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<BundleRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Partial<BundleRule> | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api("/rules/bundles") as BundleRule[];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => !search || r.parent_sku.toLowerCase().includes(search) || (r.bundle_name ?? "").toLowerCase().includes(search));

  const save = async (data: Partial<BundleRule>) => {
    if (data.id) await api(`/rules/bundles/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/bundles", { method: "POST", body: JSON.stringify(data) });
    setPanel(null); load();
  };
  const del = async (id: string) => { if (!confirm("Delete this bundle rule?")) return; await api(`/rules/bundles/${id}`, { method: "DELETE" }); setPanel(null); load(); };
  const toggle = async (r: BundleRule) => { await api(`/rules/bundles/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, is_active: !r.is_active }) }); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search parent SKU or name…" value={search} onChange={e => setSearch(e.target.value)} />
          <span className="absolute left-3 top-2.5 text-gray-400 text-sm">⌕</span>
        </div>
        <button onClick={() => setPanel("new")} className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800">+ New Bundle</button>
      </div>
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <DataTable headers={["Parent SKU", "Name", "Children", "Companions", "Source", "Status", ""]}>
          {filtered.length === 0
            ? <EmptyState message="No bundle rules" sub="Define parent SKUs that explode into child SKUs at order ingestion" />
            : filtered.map(r => (
              <tr key={r.id} onClick={() => setPanel(r)}
                className="hover:bg-emerald-50/40 cursor-pointer group transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">{r.parent_sku}</td>
                <td className="px-4 py-3 text-gray-500 text-sm">{r.bundle_name ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3">
                  {r.read_from_shopify
                    ? <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Shopify: {r.shopify_bundle_field}</span>
                    : <div className="flex flex-wrap gap-1">{r.child_skus.slice(0, 3).map((c, i) => <span key={i} className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{c.sku}×{c.quantity}</span>)}{r.child_skus.length > 3 && <span className="text-xs text-gray-400">+{r.child_skus.length - 3}</span>}</div>}
                </td>
                <td className="px-4 py-3">
                  {(r.companion_skus ?? []).length > 0
                    ? <div className="flex flex-wrap gap-1">{(r.companion_skus ?? []).slice(0, 2).map((s, i) => <span key={i} className="font-mono text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">{s}</span>)}</div>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {r.read_from_shopify
                    ? <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">Shopify</span>
                    : <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">Manual</span>}
                </td>
                <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(r); }}><StatusPill active={r.is_active} /></td>
                <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100"><span className="text-xs text-blue-500 font-medium">Edit →</span></td>
              </tr>
            ))}
        </DataTable>
      )}
      {panel !== null && <BundlePanel rule={panel === "new" ? null : panel} onSave={save} onClose={() => setPanel(null)} onDelete={del} />}
    </div>
  );
}

// ─── Tab: SKU Rules ────────────────────────────────────────────────────────

function SkuRulesTab({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<SkuRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Partial<SkuRule> | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api("/rules/sku") as SkuRule[];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => !search || r.sku.toLowerCase().includes(search));

  const save = async (data: Partial<SkuRule>) => {
    if (data.id) await api(`/rules/sku/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/sku", { method: "POST", body: JSON.stringify(data) });
    setPanel(null); load();
  };
  const del = async (id: string) => { if (!confirm("Delete this SKU rule?")) return; await api(`/rules/sku/${id}`, { method: "DELETE" }); setPanel(null); load(); };
  const toggle = async (r: SkuRule) => { await api(`/rules/sku/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, is_active: !r.is_active }) }); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search SKU…" value={search} onChange={e => setSearch(e.target.value)} />
          <span className="absolute left-3 top-2.5 text-gray-400 text-sm">⌕</span>
        </div>
        <button onClick={() => setPanel("new")} className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800">+ New SKU Rule</button>
      </div>
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <DataTable headers={["SKU", "Ships Alone", "Companions", "Hold / Preorder", "Partial Ship", "Status", ""]}>
          {filtered.length === 0
            ? <EmptyState message="No SKU rules" sub="Override shipping behavior for specific SKUs" />
            : filtered.map(r => (
              <tr key={r.id} onClick={() => setPanel(r)}
                className="hover:bg-orange-50/40 cursor-pointer group transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">{r.sku}</td>
                <td className="px-4 py-3">
                  {r.ships_alone
                    ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-medium">Yes{r.ships_alone_reason ? ` — ${r.ships_alone_reason}` : ""}</span>
                    : <span className="text-gray-300 text-xs">No</span>}
                </td>
                <td className="px-4 py-3">
                  {(r.companion_skus ?? []).length > 0
                    ? <div className="flex flex-wrap gap-1">{(r.companion_skus ?? []).slice(0, 2).map((s, i) => <span key={i} className="font-mono text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">{s}</span>)}</div>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {r.is_preorder && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded mr-1">Preorder</span>}
                  {r.hold_reason && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Hold</span>}
                  {!r.is_preorder && !r.hold_reason && <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">{r.allow_partial_ship ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Yes</span> : <span className="text-gray-300 text-xs">No</span>}</td>
                <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(r); }}><StatusPill active={r.is_active} /></td>
                <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100"><span className="text-xs text-blue-500 font-medium">Edit →</span></td>
              </tr>
            ))}
        </DataTable>
      )}
      {panel !== null && <SkuPanel rule={panel === "new" ? null : panel} onSave={save} onClose={() => setPanel(null)} onDelete={del} />}
    </div>
  );
}

// ─── Tab: Mystery Items ────────────────────────────────────────────────────

function MysteryTab({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<MysteryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Partial<MysteryRule> | null | "new">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api("/rules/mystery") as MysteryRule[];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => !search || r.mystery_sku.toLowerCase().includes(search));

  const save = async (data: Partial<MysteryRule>) => {
    if (data.id) await api(`/rules/mystery/${data.id}`, { method: "PUT", body: JSON.stringify(data) });
    else await api("/rules/mystery", { method: "POST", body: JSON.stringify(data) });
    setPanel(null); load();
  };
  const del = async (id: string) => { if (!confirm("Delete this mystery rule?")) return; await api(`/rules/mystery/${id}`, { method: "DELETE" }); setPanel(null); load(); };
  const toggle = async (r: MysteryRule) => { await api(`/rules/mystery/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, is_active: !r.is_active }) }); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search mystery SKU…" value={search} onChange={e => setSearch(e.target.value)} />
          <span className="absolute left-3 top-2.5 text-gray-400 text-sm">⌕</span>
        </div>
        <button onClick={() => setPanel("new")} className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800">+ New Mystery Rule</button>
      </div>
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <DataTable headers={["Mystery SKU", "Pool size", "Strategy", "Fallback", "Exclude prior", "Status", ""]}>
          {filtered.length === 0
            ? <EmptyState message="No mystery rules" sub="Define mystery SKUs and their eligible item pools" />
            : filtered.map(r => (
              <tr key={r.id} onClick={() => setPanel(r)}
                className="hover:bg-purple-50/40 cursor-pointer group transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">{r.mystery_sku}</td>
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-gray-900">{r.eligible_skus.length}</span>
                  <span className="text-xs text-gray-400 ml-1">SKUs</span>
                </td>
                <td className="px-4 py-3"><span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{r.selection_strategy.replace(/_/g, " ")}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.fallback_sku ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3">{r.exclude_if_previously_received ? <span className="text-xs text-green-600">✓ Yes</span> : <span className="text-xs text-gray-400">No</span>}</td>
                <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(r); }}><StatusPill active={r.is_active} /></td>
                <td className="px-4 py-3 text-right opacity-0 group-hover:opacity-100"><span className="text-xs text-blue-500 font-medium">Edit →</span></td>
              </tr>
            ))}
        </DataTable>
      )}
      {panel !== null && <MysteryPanel rule={panel === "new" ? null : panel} onSave={save} onClose={() => setPanel(null)} onDelete={del} />}
    </div>
  );
}

// ─── Field Settings Inline ─────────────────────────────────────────────────

function FieldSettingsInline({ api }: { api: (path: string, opts?: RequestInit) => Promise<unknown> }) {
  const ENTITY_TABS = [
    { key: "order", label: "Orders" }, { key: "line_item", label: "Line Items" },
    { key: "variant", label: "Variants" }, { key: "product", label: "Products" }, { key: "customer", label: "Customers" },
  ];
  const [activeTab, setActiveTab] = useState("order");
  const [fields, setFields] = useState<FieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api(`/settings/fields?entity_type=${activeTab}`) as FieldSetting[];
    setFields(Array.isArray(data) ? data : []);
    setLoading(false); setDirty(false);
  }, [api, activeTab]);

  useEffect(() => { load(); }, [load]);

  const toggle = (key: string) => { setFields(p => p.map(f => f.field_key === key ? { ...f, is_enabled: !f.is_enabled } : f)); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaving(true);
    await api("/settings/fields", { method: "PUT", body: JSON.stringify(fields.map(f => ({ field_key: f.field_key, is_enabled: f.is_enabled }))) });
    setSaving(false); setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const grouped = fields.reduce<Record<string, FieldSetting[]>>((acc, f) => {
    const cat = f.category ?? "Other"; if (!acc[cat]) acc[cat] = []; acc[cat].push(f); return acc;
  }, {});

  const enabledCount = fields.filter(f => f.is_enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Control which Shopify fields are ingested and visible per entity. Fields you disable are ignored during webhook processing.</p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">Saved ✓</span>}
          <button onClick={save} disabled={!dirty || saving}
            className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {ENTITY_TABS.map(t => (
          <button key={t.key} onClick={() => { if (dirty && !confirm("Unsaved changes — switch?")) return; setActiveTab(t.key); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? <div className="text-sm text-gray-400 py-8 text-center">Loading…</div> : (
        <>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span><strong className="text-gray-900">{enabledCount}</strong> / {fields.length} enabled</span>
            <button onClick={() => { setFields(p => p.map(f => ({ ...f, is_enabled: true }))); setDirty(true); }} className="text-blue-600 hover:text-blue-800 font-medium">Enable all</button>
            <button onClick={() => { setFields(p => p.map(f => ({ ...f, is_enabled: false }))); setDirty(true); }} className="text-red-500 hover:text-red-700 font-medium">Disable all</button>
          </div>
          <div className="space-y-3">
            {Object.entries(grouped).map(([cat, catFields]) => (
              <div key={cat} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat}</span>
                  <span className="text-xs text-gray-400">{catFields.filter(f => f.is_enabled).length}/{catFields.length}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {catFields.map(f => (
                    <label key={f.field_key} className="flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={f.is_enabled} onChange={() => toggle(f.field_key)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                      <span className="text-sm font-medium text-gray-900 flex-1">{f.field_label ?? f.field_key}</span>
                      <span className="font-mono text-xs text-gray-400">{f.field_key}</span>
                      {!f.is_enabled && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">ignored</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function DataStudioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TopTab>((searchParams.get("tab") as TopTab) ?? "fields");

  const api = useCallback(async (path: string, opts?: RequestInit): Promise<unknown> => {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { ...headers(true), ...(opts?.headers ?? {}) },
    });
    if (res.status === 401) { router.push("/login"); throw new Error("unauth"); }
    if (opts?.method === "DELETE") return {};
    return res.json();
  }, [router]);

  const tabCounts: Partial<Record<TopTab, number>> = {};

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Data Studio</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your data pipeline — custom fields, metafield mappings, transform rules, bundle explosion, SKU shipping rules, and mystery substitution
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 gap-0">
          {TAB_CONFIG.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key ? `${t.accent} bg-white` : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
              }`}>
              {t.label}
              {(tabCounts[t.key] !== undefined) && (
                <span className="ml-1.5 text-xs opacity-60">({tabCounts[t.key]})</span>
              )}
            </button>
          ))}
          {/* Field Settings as a secondary tab */}
          <button onClick={() => setTab("fields" as TopTab)}
            className="ml-auto px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-400 hover:text-gray-700">
          </button>
        </div>

        {/* Tab content */}
        {tab === "fields"     && <FieldsTab api={api} />}
        {tab === "transforms" && <TransformsTab api={api} />}
        {tab === "bundles"    && <BundlesTab api={api} />}
        {tab === "sku_rules"  && <SkuRulesTab api={api} />}
        {tab === "mystery"    && <MysteryTab api={api} />}
      </div>
    </AppLayout>
  );
}

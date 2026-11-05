import { useState, useMemo, useRef, useEffect } from "react";
import {
  AlertTriangle,
  Layers,
  RefreshCw,
  ShieldAlert,
  Search,
  CheckCircle2,
  Save,
  RotateCcw,
  Trash2,
  Filter,
  CheckSquare,
  Square
} from "lucide-react";

// 预设可用用途标准类别字典（中英双语标签，稳定键保持英文）
const RECOGNITION_CATEGORIES = [
  { key: "wall", zh: "墙体", en: "Wall" },
  { key: "column", zh: "柱", en: "Column" },
  { key: "beam", zh: "梁", en: "Beam" },
  { key: "slab", zh: "板", en: "Slab" },
  { key: "roof", zh: "屋顶", en: "Roof" },
  { key: "stair", zh: "楼梯", en: "Stair" },
  { key: "door", zh: "门", en: "Door" },
  { key: "window", zh: "窗", en: "Window" },
  { key: "curtain-wall", zh: "幕墙", en: "Curtain Wall" },
  { key: "railing", zh: "栏杆", en: "Railing" },
  { key: "shell", zh: "壳体", en: "Shell" },
  { key: "grid", zh: "轴网", en: "Axis Grid" },
  { key: "opening", zh: "洞口", en: "Opening" },
  { key: "dimension", zh: "尺寸标注", en: "Dimension" },
  { key: "text", zh: "文字注释", en: "Text" },
  { key: "label", zh: "标签", en: "Label" },
  { key: "zone", zh: "空间区域", en: "Zone" },
  { key: "mep-plumbing", zh: "给排水管", en: "Plumbing" },
  { key: "mep-hvac", zh: "暖通风管", en: "HVAC" },
  { key: "mep-electrical", zh: "电气桥架", en: "Electrical" },
  { key: "mep-fire", zh: "消防管网", en: "Fire Protection" },
  { key: "site", zh: "场地红线", en: "Site" },
  { key: "structure", zh: "结构构件", en: "Structure" },
  { key: "architecture", zh: "建筑装饰", en: "Architecture" },
  { key: "furniture", zh: "家具布置", en: "Furniture" },
  { key: "cad", zh: "2D 绘图", en: "2D Drafting" },
  { key: "background", zh: "底图参照", en: "Background" },
  { key: "safety", zh: "避难安全", en: "Safety" }
] as const;

export const USE_CATEGORIES = [
  ...RECOGNITION_CATEGORIES.filter(c => ['grid', 'column', 'wall', 'door', 'window', 'opening', 'text', 'dimension'].includes(c.key)),
  { key: 'other', zh: '其他', en: 'Other' }, { key: 'ignore', zh: '忽略', en: 'Ignore' }
];

type RecognitionReport = {
  documentType?: string;
  schemaVersion?: string;
  summary?: {
    layerCount?: number;
    recognizedCount?: number;
    reviewRequiredCount?: number;
    byCategory?: Record<string, number>;
  };
  layers?: Array<{
    index?: number;
    layerKey: string;
    missing?: boolean;
    guid?: string;
    name: string;
    recognition?: {
      category?: string | null;
      confidence?: number;
      matchingRule?: string;
      matchedKeywords?: string[];
      reviewRequired?: boolean;
    };
    confirmedUse?: string | null;
    isConfirmed?: boolean;
    isDraftModified?: boolean;
    change?: "unchanged" | "new" | "renamed" | "deleted";
    oldName?: string | null;
  }>;
};

type MergedLayerItem = NonNullable<RecognitionReport["layers"]>[number];

function confidenceLabel(value: number | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "--";
}

function categoryLabel(value: string | null | undefined, zh: boolean): string {
  if (!value) return zh ? "未指定 / 未识别" : "Unassigned / Unrecognized";
  const found = [...RECOGNITION_CATEGORIES, ...USE_CATEGORIES].find((c) => c.key === value || c.key.toLowerCase() === value.toLowerCase());
  if (found) return zh ? found.zh : found.en;
  return value; // 用户自定义用途保持原文字符
}

function categorySummary(byCategory: Record<string, number> | undefined, zh: boolean): string {
  if (!byCategory || Object.keys(byCategory).length === 0) return zh ? "暂无分类" : "No categories";
  return Object.entries(byCategory).map(([key, value]) => `${categoryLabel(key, zh)}: ${value}`).join(" · ");
}

type ResolveData = {
  ok: boolean;
  identity: { projectKey: string | null; projectName: string; isIdentifiable: boolean };
  targetPort: number | null;
  mapping: { schemaVersion: string; mappingRevision: number } | null;
  draft: { draftRevision: number } | null;
  warnings?: string[];
  view: {
    staleDraft: boolean;
    summary: { total: number; unrecognized: number; pending: number; byCategory: Record<string, number> };
    mergedEntries: Array<{
      layerKey: string; layerIndex: number | null; layerName: string; guid: string | null;
      suggestedUse: string | null; confirmedUse: string | null; confidence: number;
      status: 'confirmed' | 'pending'; isDraftModified: boolean; reviewRequired: boolean;
      matchingRule?: string; matchedKeywords: string[]; missing: boolean;
      change: 'unchanged' | 'new' | 'renamed' | 'deleted'; oldName: string | null;
    }>;
  };
};
class MappingRequestError extends Error {
  constructor(public code: string, message: string, public operationCompleted = false) { super(message); }
}
async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new MappingRequestError(data?.errorType || 'REQUEST_FAILED', data?.error || data?.message || `HTTP ${response.status}`, data?.detail?.operationCompleted === true);
  }
  return data as T;
}

export default function CadLayerRecognitionPanel({ lang }: { lang: "zh-CN" | "en-US" }) {
  const zh = lang === "zh-CN";
  const [report, setReport] = useState<RecognitionReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [error, setError] = useState<{code: string; detail: string} | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  // 项目身份与版本追踪（双 revision 乐观锁）
  const [projectKey, setProjectKey] = useState<string>("");
  const [targetInput, setTargetInput] = useState('');
  const [targetPort, setTargetPort] = useState<number | null>(null);
  const [projectName, setProjectName] = useState('');
  const [staleDraft, setStaleDraft] = useState(false);
  const sessionKey = useRef('');
  if (!sessionKey.current) sessionKey.current = crypto.randomUUID();
  const inflight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const busy = loading || savingDraft || savingMapping;
  const showError = (err: unknown) => setError({
    code: err instanceof MappingRequestError ? err.code : 'REQUEST_FAILED',
    detail: err instanceof Error ? err.message : String(err)
  });
  const [mappingRevision, setMappingRevision] = useState<number>(0);
  const [draftRevision, setDraftRevision] = useState<number>(0);

  // 本地草稿修改集合: layerKey/name -> confirmedUse
  const [localDraftMap, setLocalDraftMap] = useState<Map<string, string | null>>(new Map());

  // 搜索、筛选与多选状态
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "review" | "confirmed" | "unassigned">("all");
  const [selectedLayerKeys, setSelectedLayerKeys] = useState<Set<string>>(new Set());
  const [batchCategory, setBatchCategory] = useState<string>("");

  // 获取主键
  const getLayerKey = (layer: MergedLayerItem): string => {
    return layer.layerKey;
  };

  const applyResolved = (data: ResolveData) => {
    if (!data.view || !data.targetPort) throw new MappingRequestError('INVALID_MAPPING_RESPONSE', 'Live target binding required');
    const entries = data.view.mergedEntries;
    setReport({
      documentType: 'CAD-Layer-Merged-View', schemaVersion: data.mapping?.schemaVersion || 'cad0-1',
      summary: { layerCount: entries.length, recognizedCount: entries.length - data.view.summary.unrecognized,
        reviewRequiredCount: data.view.summary.pending, byCategory: data.view.summary.byCategory },
      layers: entries.map(e => ({
        layerKey: e.layerKey, index: e.layerIndex ?? undefined, guid: e.guid ?? undefined, name: e.layerName,
        recognition: { category: e.suggestedUse, confidence: e.confidence, matchingRule: e.matchingRule,
          matchedKeywords: e.matchedKeywords, reviewRequired: e.reviewRequired },
        confirmedUse: e.confirmedUse, isConfirmed: e.status === 'confirmed' && !e.isDraftModified,
        isDraftModified: e.isDraftModified, missing: e.missing, change: e.change, oldName: e.oldName
      }))
    });
    setProjectKey(data.identity.projectKey || '');
    setProjectName(data.identity.projectName);
    setTargetPort(data.targetPort);
    setStaleDraft(data.view.staleDraft);
    setMappingRevision(data.mapping?.mappingRevision ?? 0);
    setDraftRevision(data.draft?.draftRevision ?? 0);
    setWarnings(data.warnings || []);
    setLocalDraftMap(new Map());
    setSelectedLayerKeys(new Set());
  };
  const resolveSnapshot = (port: number | null) => requestJson<ResolveData>('/api/cad-layers/mapping/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(port ? { targetPort: port } : {}), sessionKey: sessionKey.current })
  });
  const recognizeLayers = async () => {
    if (inflight.current) return;
    inflight.current = true;
    const epoch = ++generation.current;
    setLoading(true); setError(null); setSuccessMsg('');
    try {
      const port = targetInput ? Number(targetInput) : targetPort;
      if (targetInput && (!Number.isInteger(port) || port! < 19723 || port! > 19743))
        throw new MappingRequestError('INVALID_TARGET_PORT', '19723–19743');
      const data = await resolveSnapshot(port);
      if (epoch === generation.current) applyResolved(data);
    } catch (err) {
      if (epoch === generation.current) { setReport(null); setProjectKey(''); setTargetPort(null); showError(err); }
    } finally {
      inflight.current = false;
      if (epoch === generation.current) setLoading(false);
    }
  };
  const changeTarget = (value: string) => {
    if (inflight.current) return;
    generation.current++;
    sessionKey.current = crypto.randomUUID();
    setTargetInput(value); setTargetPort(null); setProjectKey(''); setProjectName('');
    setReport(null); setLocalDraftMap(new Map()); setError(null); setSuccessMsg('');
  };

  // 2. 单项用途调整
  const handleUpdateLayerUse = (layer: MergedLayerItem, newUse: string) => {
    if (inflight.current) return;
    const key = getLayerKey(layer);
    setLocalDraftMap((prev) => {
      const next = new Map(prev);
      next.set(key, newUse || null);
      return next;
    });
  };

  // 3. 批量用途赋予
  const handleBatchAssign = () => {
    if (inflight.current || !batchCategory || selectedLayerKeys.size === 0) return;
    setLocalDraftMap((prev) => {
      const next = new Map(prev);
      for (const key of selectedLayerKeys) {
        next.set(key, batchCategory);
      }
      return next;
    });
    setSuccessMsg('assigned');
    setSelectedLayerKeys(new Set());
  };

  const mappingEntries = () => (report?.layers || []).map(layer => {
    const key = getLayerKey(layer);
    const use = localDraftMap.has(key) ? localDraftMap.get(key) : layer.confirmedUse;
    const manual = Boolean(use && USE_CATEGORIES.some(c => c.key === use) &&
      (localDraftMap.has(key) || layer.recognition?.reviewRequired === false));
    return { layerKey: key, guid: layer.guid, layerIndex: layer.index, layerName: layer.name,
      confirmedUse: use ?? null, suggestedUse: layer.recognition?.category ?? null,
      status: manual && layer.guid ? 'confirmed' : 'pending', reviewRequired: !manual || !layer.guid };
  });
  const mutate = async (operation: 'draft' | 'confirm' | 'reset' | 'delete') => {
    if (inflight.current || !report || !targetPort) return;
    const entries = mappingEntries();
    if (operation === 'confirm' && (!projectKey || staleDraft || entries.some(e => e.status === 'pending'))) {
      setError({ code: 'MAPPING_UNRESOLVED_ITEMS', detail: '' }); return;
    }
    inflight.current = true;
    const epoch = generation.current;
    setSavingDraft(operation === 'draft'); setSavingMapping(operation !== 'draft');
    setError(null); setSuccessMsg('');
    const suffix = operation === 'draft' ? '/draft' : operation === 'reset' ? '/reset-draft' : '';
    try {
      await requestJson('/api/cad-layers/mapping' + suffix, {
        method: operation === 'delete' ? 'DELETE' : operation === 'reset' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPort, expectedProjectKey: projectKey || null, sessionKey: sessionKey.current,
          expectedMappingRevision: mappingRevision, expectedDraftRevision: draftRevision,
          basedOnMappingRevision: mappingRevision, entries, confirm: operation === 'delete' })
      });
      // Read BOTH revisions and authoritative entries, including stale draft status.
      const data = await resolveSnapshot(targetPort);
      if (epoch === generation.current) {
        if (data.identity.projectKey !== (projectKey || null)) throw new MappingRequestError('MAPPING_TARGET_CHANGED', '');
        applyResolved(data); setSuccessMsg(operation);
      }
    } catch (err) {
      if (epoch === generation.current) {
        // Lock cleanup can fail AFTER committing. Re-read rather than re-send.
        if (err instanceof MappingRequestError && err.operationCompleted) {
          try {
            const current = await resolveSnapshot(targetPort);
            if (epoch !== generation.current) return;
            if (current.identity.projectKey !== (projectKey || null)) throw new Error('Target changed');
            applyResolved(current);
          } catch (_) {
            if (epoch === generation.current) { setReport(null); setTargetPort(null); }
          }
        } else { setReport(null); setTargetPort(null); }
        if (epoch === generation.current) showError(err);
      }
    } finally {
      inflight.current = false;
      if (epoch === generation.current) { setSavingDraft(false); setSavingMapping(false); }
    }
  };
  const handleSaveDraft = () => mutate('draft');
  const handleConfirmAndSaveMapping = () => mutate('confirm');
  const handleResetDraft = () => {
    if (inflight.current) return;
    setLocalDraftMap(new Map()); setSuccessMsg('undo');
  };
  const messages: Record<string, [string, string]> = {
    assigned: ['已更新人工用途，尚未持久确认', 'Manual uses updated; not yet confirmed'],
    draft: ['草稿已保存并重新读取', 'Draft saved and reloaded'],
    confirm: ['映射已确认并重新读取', 'Mapping confirmed and reloaded'],
    reset: ['服务端草稿已重置', 'Stored draft reset'],
    delete: ['确认映射已删除', 'Confirmed mapping deleted'],
    undo: ['已撤销未保存修改', 'Unsaved edits reverted']
  };

  const errorMessages: Record<string, [string, string]> = {
    MAPPING_UNRESOLVED_ITEMS: ['仍有待复核项、无 GUID 项、过期草稿或未保存工程，不能确认。', 'Resolve pending or GUID-less layers, stale drafts and unsaved project identity before confirmation.'],
    MAPPING_TARGET_CHANGED: ['目标工程已变化，请重新读取。', 'The target project changed. Reload before editing.'],
    MAPPING_TARGET_REQUIRED: ['请先读取并绑定目标工程。', 'Read and bind the target project first.'],
    MAPPING_LOCK_RELEASE_FAILED: ['锁清理失败；操作可能已完成，已尝试重新读取，禁止盲目重试。', 'Lock cleanup failed; the operation may be complete. A reload was attempted. Do not retry blindly.'],
    REQUEST_FAILED: ['请求失败，请检查目标并重新读取。', 'Request failed. Check the target and reload.']
  };

  // 7. 过滤图层列表
  const filteredLayers = useMemo(() => {
    if (!report?.layers) return [];
    return report.layers.filter((layer) => {
      // 搜索过滤（原图层名保持原文搜索）
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = layer.name.toLowerCase().includes(q);
        const matchesOldName = layer.oldName ? layer.oldName.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesOldName) return false;
      }

      const key = getLayerKey(layer);
      const effectiveUse = localDraftMap.has(key)
        ? localDraftMap.get(key)
        : layer.confirmedUse;

      // 分类过滤
      if (selectedCategoryFilter !== "all") {
        if (effectiveUse !== selectedCategoryFilter) return false;
      }

      // 状态过滤
      if (statusFilter === "review") {
        if (layer.recognition?.reviewRequired !== true) return false;
      } else if (statusFilter === "confirmed") {
        if (!layer.isConfirmed || localDraftMap.has(key)) return false;
      } else if (statusFilter === "unassigned") {
        if (Boolean(effectiveUse)) return false;
      }

      return true;
    });
  }, [report?.layers, searchQuery, selectedCategoryFilter, statusFilter, localDraftMap]);

  // 全选 / 取消全选逻辑
  const allFilteredSelected = filteredLayers.length > 0 && filteredLayers.every((l) => selectedLayerKeys.has(getLayerKey(l)));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedLayerKeys(new Set());
    } else {
      const next = new Set<string>();
      filteredLayers.forEach((l) => next.add(getLayerKey(l)));
      setSelectedLayerKeys(next);
    }
  };

  const toggleSelectLayer = (key: string) => {
    setSelectedLayerKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const summaryItems = [
    { label: "layers", value: report?.summary?.layerCount ?? 0 },
    { label: "recognized", value: report?.summary?.recognizedCount ?? 0 },
    { label: "review", value: report?.summary?.reviewRequiredCount ?? 0 }
  ];

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* 顶部标题栏与全局操作 */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-lime-400" />
          <span className="text-xs font-semibold text-zinc-200">{zh ? "CAD 图层识别与映射" : "CAD Layer Mapping"}</span>
          {report && (
            <span className="shrink-0 font-mono text-[10px] text-zinc-500">
              {report.schemaVersion ?? "--"} {projectKey ? `· ${projectKey.slice(0, 12)}...` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void recognizeLayers()}
            disabled={busy}
            className="flex items-center gap-1.5 bg-lime-600/20 px-2.5 py-1 text-[11px] font-semibold text-lime-200 transition-colors hover:bg-lime-600/35 disabled:cursor-not-allowed disabled:opacity-50"
            title={zh ? "从 Archicad 当前工程重新读取图层并合并识别" : "Read layers from Archicad and resolve"}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? (zh ? "识别中..." : "Recognizing...") : (zh ? "读取与识别" : "Recognize")}
          </button>
          {report && (
            <>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={busy}
                className="flex items-center gap-1 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
                title={zh ? "将当前修改保存为项目草稿（不作为建模最终依据）" : "Save as draft"}
              >
                <Save className="h-3 w-3 text-amber-400" />
                {savingDraft ? (zh ? "保存中..." : "Saving...") : (zh ? "保存草稿" : "Save Draft")}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAndSaveMapping()}
                disabled={busy || !projectKey || staleDraft}
                className="flex items-center gap-1 bg-lime-700/80 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-lime-600 disabled:opacity-50"
                title={zh ? "持久化确认该工程图层映射（安全只读模型）" : "Confirm and persist layer mapping"}
              >
                <CheckCircle2 className="h-3 w-3" />
                {savingMapping ? (zh ? "持久化中..." : "Confirming...") : (zh ? "确认保存" : "Confirm Mapping")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-4 py-2 text-xs flex flex-wrap gap-2">
        <label>{zh ? '目标实例端口' : 'Target instance port'}
          <input aria-label={lang === "zh-CN" ? "目标实例端口" : "Target instance port"} value={targetInput} disabled={busy}
            placeholder="19723–19743" onChange={e => changeTarget(e.target.value)} className="bg-zinc-800 ml-2 w-28" />
        </label>
        <span>{projectName} {targetPort ? `:${targetPort}` : ''}</span>
        {report && !projectKey && <span>{zh ? '未保存工程：仅本面板／实例会话草稿，不绑定工程；切换未命名工程后请重开面板。不可持久确认。' : 'Unsaved: panel/instance session draft only, not project-bound. Reopen the panel after switching unsaved projects. Confirmation disabled.'}</span>}
        {staleDraft && <span>{zh ? '草稿基线已过期：请保存草稿以重建基线，或重置服务端草稿。' : 'Stale draft: save to rebase, or reset stored draft.'}</span>}
        {report && <>
          <button disabled={busy} onClick={() => { if (window.confirm(zh ? '重置已保存草稿？' : 'Reset stored draft?')) void mutate('reset'); }}>{zh ? '重置已保存草稿' : 'Reset stored draft'}</button>
          <button disabled={busy || !projectKey} onClick={() => { if (window.confirm(zh ? '删除该工程确认映射？不修改模型。' : 'Delete confirmed mapping? Model unchanged.')) void mutate('delete'); }}>{zh ? '删除确认映射' : 'Delete mapping'}</button>
        </>}
      </div>
      <fieldset disabled={busy} className="contents">
      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <div className="mb-3 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-300">
            {(errorMessages[error.code] || errorMessages.REQUEST_FAILED)[zh ? 0 : 1]} [{error.code}] {error.detail}
          </div>
        )}
        {successMsg && (
          <div className="mb-3 border-l-2 border-lime-500 bg-lime-500/5 px-3 py-2 text-[11px] leading-relaxed text-lime-300">
            {messages[successMsg]?.[zh ? 0 : 1] || successMsg}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-3 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            {warnings.map((warning) => (
              <div key={warning} className="truncate" title={warning}>{warning}</div>
            ))}
          </div>
        )}

        {report ? (
          <>
            {/* 识别摘要 */}
            <section className="border-b border-zinc-800 pb-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "识别与映射摘要" : "Recognition & Mapping Summary"}</h4>
                <div className="flex items-center gap-3 font-mono text-[10px] text-zinc-400">
                  <span>{lang === "zh-CN" ? "映射修订:" : "Mapping revision:"} {mappingRevision}</span>
                  <span>{lang === "zh-CN" ? "草稿修订:" : "Draft revision:"} {draftRevision}</span>
                  {localDraftMap.size > 0 && (
                    <span className="flex items-center gap-1 text-amber-400 font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {zh ? `${localDraftMap.size} 项未保存修改` : `${localDraftMap.size} unsaved edits`}
                      <button
                        type="button"
                        onClick={handleResetDraft}
                        className="ml-1 text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                        title={zh ? "重置所有未保存的本地草稿修改" : "Reset draft edits"}
                      >
                        {zh ? "撤销" : "Undo"}
                      </button>
                    </span>
                  )}
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                {summaryItems.map((item) => (
                  <div key={item.label} className="bg-zinc-900/50 px-2 py-1.5">
                    <dt className="font-mono text-[9px] text-zinc-500">{item.label}</dt>
                    <dd className="font-mono text-sm text-zinc-100">{String(item.value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 truncate text-[10px] text-zinc-500" title={categorySummary(report.summary?.byCategory, zh)}>
                {categorySummary(report.summary?.byCategory, zh)}
              </div>
            </section>

            {/* 搜索、筛选与批量操作栏 */}
            <section className="border-b border-zinc-800 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* 搜索框 */}
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={zh ? "搜索图层名..." : "Search layer name..."}
                    className="w-full bg-zinc-900 pl-7 pr-2 py-1 text-[11px] text-zinc-200 border border-zinc-800 focus:border-lime-500 focus:outline-none"
                  />
                </div>

                {/* 分类筛选 */}
                <select
                  value={selectedCategoryFilter}
                  onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                  className="bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 border border-zinc-800 focus:outline-none"
                >
                  <option value="all">{zh ? "全部分类" : "All Categories"}</option>
                  {USE_CATEGORIES.map((cat) => (
                    <option key={cat.key} value={cat.key}>
                      {zh ? cat.zh : cat.en}
                    </option>
                  ))}
                </select>

                {/* 状态筛选 */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 border border-zinc-800 focus:outline-none"
                >
                  <option value="all">{zh ? "全部状态" : "All Status"}</option>
                  <option value="review">{zh ? "待人工复核" : "Review Required"}</option>
                  <option value="confirmed">{zh ? "已确认映射" : "Confirmed"}</option>
                  <option value="unassigned">{zh ? "未指定用途" : "Unassigned"}</option>
                </select>
              </div>

              {/* 批量操作工具条 */}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-900 pt-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-lime-400" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                    <span>{zh ? (allFilteredSelected ? "取消全选" : "全选当前") : (allFilteredSelected ? "Clear All" : "Select All")}</span>
                  </button>
                  {selectedLayerKeys.size > 0 && (
                    <span className="text-[10px] text-lime-400">
                      ({zh ? `已选 ${selectedLayerKeys.size} 项` : `${selectedLayerKeys.size} selected`})
                    </span>
                  )}
                </div>

                {selectedLayerKeys.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={batchCategory}
                      onChange={(e) => setBatchCategory(e.target.value)}
                      className="bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300 border border-zinc-800 focus:outline-none"
                    >
                      <option value="">{zh ? "-- 批量指定用途 --" : "-- Assign Use --"}</option>
                      {USE_CATEGORIES.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {zh ? cat.zh : cat.en}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleBatchAssign}
                      disabled={!batchCategory}
                      className="bg-lime-600/30 px-2 py-0.5 text-[10px] font-semibold text-lime-200 hover:bg-lime-600/50 disabled:opacity-40"
                    >
                      {zh ? "应用" : "Apply"}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* 图层结果列表 */}
            <section className="py-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold text-zinc-300">
                  {zh ? "图层映射清单" : "Layer Mapping List"} ({filteredLayers.length})
                </h4>
              </div>

              {filteredLayers.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500">
                  {zh ? "没有匹配的图层记录" : "No layers matching filter"}
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {filteredLayers.map((layer, index) => {
                    const key = getLayerKey(layer);
                    const isSelected = selectedLayerKeys.has(key);
                    const recognition = layer.recognition;
                    const reviewRequired = recognition?.reviewRequired === true;
                    const lowConfidence = typeof recognition?.confidence === "number" && recognition.confidence < 0.8;

                    const effectiveUse = localDraftMap.has(key)
                      ? localDraftMap.get(key)
                      : (layer.confirmedUse || "");

                    const isLocalModified = localDraftMap.has(key) || layer.isDraftModified === true;

                    return (
                      <div
                        key={`${layer.index ?? index}-${layer.name}`}
                        className={`border px-2.5 py-2 transition-colors ${
                          isSelected ? "border-lime-500/50 bg-lime-950/20" : reviewRequired ? "border-amber-500/35 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            {/* 选择框 */}
                            <button
                              type="button"
                              onClick={() => toggleSelectLayer(key)}
                              className="mt-0.5 text-zinc-400 hover:text-zinc-200 shrink-0"
                            >
                              {isSelected ? (
                                <CheckSquare className="h-3.5 w-3.5 text-lime-400" />
                              ) : (
                                <Square className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <div className="min-w-0">
                              {/* 图层名称（用户原文保持） */}
                              <div className="flex items-center gap-1.5 truncate text-[11px] font-medium text-zinc-100" title={layer.name}>
                                <span>{layer.name}</span>
                                {layer.oldName && (
                                  <span className="font-mono text-[9px] text-zinc-500">
                                    ({zh ? "原名:" : "was:"} {layer.oldName})
                                  </span>
                                )}
                                {layer.change === "new" && (
                                  <span className="bg-emerald-500/20 text-emerald-300 text-[8px] px-1 py-0.2 font-mono">
                                    {lang === "zh-CN" ? "新增" : "NEW"}
                                  </span>
                                )}
                              </div>

                              {/* 识别与确认详情 */}
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`px-1.5 py-0.5 text-[9px] font-semibold ${recognition?.category ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800 text-zinc-500"}`}>
                                  {zh ? "建议: " : "Suggested: "}{categoryLabel(recognition?.category, zh)}
                                </span>
                                <span className={`font-mono text-[9px] ${lowConfidence ? "text-amber-300" : "text-zinc-400"}`}>
                                  {confidenceLabel(recognition?.confidence)}
                                </span>

                                {/* 确认用途下拉选择器 */}
                                <div className="flex items-center gap-1 ml-1">
                                  <span className="text-[9px] text-zinc-400">{zh ? "确认:" : "Confirmed:"}</span>
                                  <select
                                    value={effectiveUse || ""}
                                    onChange={(e) => handleUpdateLayerUse(layer, e.target.value)}
                                    className={`px-1.5 py-0.5 text-[10px] font-medium border focus:outline-none ${
                                      isLocalModified
                                        ? "border-amber-400 bg-amber-950/40 text-amber-200"
                                        : layer.isConfirmed
                                        ? "border-lime-500/50 bg-lime-950/30 text-lime-300 font-semibold"
                                        : "border-zinc-700 bg-zinc-800 text-zinc-200"
                                    }`}
                                  >
                                    <option value="">{zh ? "-- 未指定 --" : "-- None --"}</option>
                                    {USE_CATEGORIES.map((cat) => (
                                      <option key={cat.key} value={cat.key}>
                                        {zh ? cat.zh : cat.en}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 状态徽章 */}
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {reviewRequired && (
                              <span className="flex items-center gap-1 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                                <ShieldAlert className="h-3 w-3" />
                                {zh ? "待复核" : "Review"}
                              </span>
                            )}
                            {layer.isConfirmed && !isLocalModified && (
                              <span className="flex items-center gap-1 bg-lime-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-lime-300">
                                <CheckCircle2 className="h-3 w-3" />
                                {zh ? "已确认" : "Confirmed"}
                              </span>
                            )}
                            {isLocalModified && (
                              <span className="bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                                {zh ? "草稿修改" : "Draft Modified"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 匹配依据证据 */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] text-zinc-500">
                          <span className="truncate font-mono" title={recognition?.matchingRule}>
                            {recognition?.matchingRule || "no-keyword-match"}
                          </span>
                          {(recognition?.matchedKeywords?.length ?? 0) > 0 && (
                            <span className="truncate font-mono text-zinc-400">
                              [{recognition?.matchedKeywords?.join(", ")}]
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {(report.summary?.reviewRequiredCount ?? 0) > 0 && (
              <div className="mb-3 flex items-start gap-1.5 border-l-2 border-amber-500 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {zh
                    ? `有 ${report.summary?.reviewRequiredCount} 个图层需要人工复核确认用途。`
                    : `${report.summary?.reviewRequiredCount} layers require manual review and confirmation.`}
                </span>
              </div>
            )}
          </>
        ) : !loading && !error && (
          <p className="py-8 text-center text-xs text-zinc-500">
            {zh ? "尚无识别结果，请点击右上角「读取与识别」按钮" : "No recognition report yet. Click \"Recognize\" above."}
          </p>
        )}
      </div>
      </fieldset>
    </div>
  );
}

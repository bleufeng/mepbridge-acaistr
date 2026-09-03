import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  GitCompare,
  RefreshCw,
  Server,
  ShieldAlert,
  X
} from "lucide-react";
import ConfirmationDialog from "./ConfirmationDialog";

type ElementTypeName = "Wall" | "Column" | "Beam" | "Slab" | "Zone";

type InstanceInfo = {
  port: number;
  productName?: string | null;
  productInfo?: {
    version?: number | string | null;
    buildNumber?: number | string | null;
    languageCode?: string | null;
  } | null;
  mepbridge: boolean;
  addOnVersion?: string | null;
  archicadVersion?: number | string | null;
  projectName?: string | null;
  projectPath?: string | null;
  untitled?: boolean | null;
  teamwork?: boolean | null;
};

type InstancesResponse = {
  ok: boolean;
  count?: number;
  mepbridgeCount?: number;
  distinctProjectCount?: number;
  primaryPort?: number | null;
  instances?: InstanceInfo[];
  note?: string;
  error?: string;
};

type ElementSnapshot = {
  snapshotId?: string;
  contentHash?: string;
  source?: {
    port?: number | null;
    projectName?: string | null;
    projectPath?: string | null;
  };
  elements?: unknown[];
  capture?: {
    selectionMode?: string;
    succeeded?: unknown[];
    failed?: unknown[];
    skipped?: unknown[];
  };
  warnings?: string[];
};

type ReplayPreview = {
  previewId?: string;
  snapshotId?: string;
  snapshotHash?: string;
  targetFingerprint?: string;
  estimatedCreateCount?: number;
  planHash?: string;
  unsupportedElements?: Array<{ sourceGuid?: string; elementType?: string; reason?: string }>;
  warnings?: string[];
  canApply?: boolean;
  expiresAt?: string;
};

type SnapshotDiffReport = {
  summary?: {
    matchedCount?: number;
    identicalCount?: number;
    differingCount?: number;
    onlyInACount?: number;
    onlyInBCount?: number;
  };
  sources?: {
    a?: { projectName?: string | null; contentHash?: string };
    b?: { projectName?: string | null; contentHash?: string };
  };
  tolerance?: { distanceToleranceM?: number };
};

type SnapshotSlot = "A" | "B";
type SnapshotRecord = { label: string; snapshot: ElementSnapshot };

type PanelProps = {
  lang: "zh-CN" | "en-US";
};

const ELEMENT_TYPE_OPTIONS: ElementTypeName[] = ["Wall", "Column", "Beam", "Slab", "Zone"];

const CAPTURE_MODES = ["selection", "types"] as const;
type CaptureMode = (typeof CAPTURE_MODES)[number];

async function requestJson(input: string, init?: RequestInit): Promise<any> {
  const response = await fetch(input, init);
  let data: any;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return data;
}

function formatPort(instance: InstanceInfo): string {
  return `:${instance.port}`;
}

function instanceLabel(instance: InstanceInfo): string {
  const project = instance.projectName || "untitled";
  const version = instance.productInfo?.version;
  return `${project}${version ? ` · AC${version}` : ""} · ${formatPort(instance)}`;
}

export default function InstancesSnapshotsPanel({ lang }: PanelProps) {
  const zh = lang === "zh-CN";
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [instancesMeta, setInstancesMeta] = useState<{
    count: number;
    mepbridgeCount: number;
    distinctProjectCount: number;
    primaryPort: number | null;
  } | null>(null);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState("");
  const [sourcePort, setSourcePort] = useState<number | null>(null);
  const [targetPort, setTargetPort] = useState<number | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("types");
  const [selectedTypes, setSelectedTypes] = useState<ElementTypeName[]>(["Wall"]);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotA, setSnapshotA] = useState<string>("");
  const [snapshotB, setSnapshotB] = useState<string>("");
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [diff, setDiff] = useState<SnapshotDiffReport | null>(null);
  const [preview, setPreview] = useState<ReplayPreview | null>(null);
  const [replayResult, setReplayResult] = useState<any>(null);
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);

  const loadInstances = useCallback(async () => {
    setInstancesLoading(true);
    setInstancesError("");
    try {
      const data = await requestJson("/api/status/instances") as InstancesResponse;
      const nextInstances = Array.isArray(data.instances) ? data.instances : [];
      setInstances(nextInstances);
      setInstancesMeta({
        count: data.count ?? nextInstances.length,
        mepbridgeCount: data.mepbridgeCount ?? nextInstances.filter((item) => item.mepbridge).length,
        distinctProjectCount: data.distinctProjectCount ?? 0,
        primaryPort: data.primaryPort ?? null
      });
      setSourcePort((current) => (current && nextInstances.some((item) => item.port === current)
        ? current
        : nextInstances.find((item) => item.mepbridge)?.port ?? null));
      setTargetPort((current) => (current && nextInstances.some((item) => item.port === current)
        ? current
        : nextInstances.filter((item) => item.mepbridge).at(-1)?.port ?? null));
    } catch (error) {
      setInstances([]);
      setInstancesMeta(null);
      setInstancesError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  const usableInstances = useMemo(
    () => instances.filter((instance) => instance.mepbridge),
    [instances]
  );
  const selectedSnapshotA = useMemo(
    () => snapshots.find((item) => item.label === snapshotA)?.snapshot ?? null,
    [snapshots, snapshotA]
  );
  const selectedSnapshotB = useMemo(
    () => snapshots.find((item) => item.label === snapshotB)?.snapshot ?? null,
    [snapshots, snapshotB]
  );
  const snapshotSourcePort = selectedSnapshotA?.source?.port ?? null;
  const snapshotSourceMissing = selectedSnapshotA !== null && snapshotSourcePort === null;
  const sameSourceTarget = snapshotSourcePort !== null && snapshotSourcePort === targetPort;
  const canCapture = sourcePort !== null
    && (captureMode === "selection" || selectedTypes.length > 0)
    && !instancesLoading
    && busyAction === "";

  const toggleType = (type: ElementTypeName) => {
    setSelectedTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type]);
  };

  const runCapture = async () => {
    if (sourcePort === null) return;
    setBusyAction("capture");
    setActionError("");
    setWarnings([]);
    try {
      const body = captureMode === "selection"
        ? { selectionMode: "selection", sourcePort }
        : { selectionMode: "types", requestedTypes: selectedTypes, sourcePort };
      const data = await requestJson("/api/snapshot-replay/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const snapshot = data.snapshot as ElementSnapshot;
      if (!snapshot?.snapshotId) throw new Error(zh ? "服务未返回快照 ID" : "Server returned no snapshotId");
      const record: SnapshotRecord = {
        label: `${snapshot.snapshotId} · ${snapshot.source?.projectName || `:${sourcePort}`}`,
        snapshot
      };
      setSnapshots((current) => [record, ...current]);
      setSnapshotA((current) => current || record.label);
      setSnapshotB("");
      setPreview(null);
      setReplayResult(null);
      setDiff(null);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction("");
    }
  };

  const runCompare = async () => {
    if (!selectedSnapshotA || !selectedSnapshotB) return;
    setBusyAction("compare");
    setActionError("");
    setWarnings([]);
    try {
      const data = await requestJson("/api/snapshot-replay/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotA: selectedSnapshotA, snapshotB: selectedSnapshotB })
      });
      setDiff(data.report as SnapshotDiffReport);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction("");
    }
  };

  const runPreview = async () => {
    if (!selectedSnapshotA || targetPort === null) return;
    setBusyAction("preview");
    setActionError("");
    setWarnings([]);
    setReplayResult(null);
    try {
      const data = await requestJson("/api/snapshot-replay/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: selectedSnapshotA,
          targetPort,
          targetProject: usableInstances.find((item) => item.port === targetPort)?.projectPath
        })
      });
      const nextPreview = data.preview as ReplayPreview;
      if (!nextPreview?.previewId || !nextPreview?.planHash) {
        throw new Error(zh ? "服务未返回 previewId/planHash" : "Server returned no previewId/planHash");
      }
      setPreview(nextPreview);
      setWarnings(Array.isArray(nextPreview.warnings) ? nextPreview.warnings : []);
    } catch (error) {
      setPreview(null);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction("");
    }
  };

  const applyReplay = async () => {
    if (!preview || !selectedSnapshotA) return;
    setBusyAction("apply");
    setActionError("");
    try {
      const data = await requestJson("/api/snapshot-replay/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "replay-apply-request",
          previewId: preview.previewId,
          planHash: preview.planHash,
          snapshotHash: preview.snapshotHash,
          targetFingerprint: preview.targetFingerprint,
          dryRun: false,
          confirmRequired: true
        })
      });
      setReplayResult(data.result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setShowReplayConfirm(false);
      setBusyAction("");
    }
  };

  const invalidPair = snapshotA !== "" && snapshotB !== "" && snapshotA === snapshotB;

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-teal-400" />
          <span className="text-xs font-semibold text-zinc-200">{zh ? "实例与快照" : "Instances & Snapshots"}</span>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500">
            {instancesMeta ? `${instancesMeta.count}/${instancesMeta.distinctProjectCount}` : "--/--"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadInstances()}
          className="p-1 text-zinc-500 transition-colors hover:text-teal-300"
          title={zh ? "刷新实例列表" : "Refresh instances"}
          aria-label={zh ? "刷新实例列表" : "Refresh instances"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${instancesLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {(instancesError || actionError) && (
          <div className="mb-3 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-300">
            {instancesError || actionError}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-3 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            {warnings.slice(0, 4).map((warning) => (
              <div key={warning} className="truncate" title={warning}>{warning}</div>
            ))}
          </div>
        )}

        <section className="border-b border-zinc-800 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "运行实例" : "Running Instances"}</h4>
            {instancesMeta && (
              <span className="font-mono text-[10px] text-zinc-500">
                {zh
                  ? `主端口 ${instancesMeta.primaryPort ?? "--"} · MEPBridge ${instancesMeta.mepbridgeCount}/${instancesMeta.count}`
                  : `primary ${instancesMeta.primaryPort ?? "--"} · MEPBridge ${instancesMeta.mepbridgeCount}/${instancesMeta.count}`}
              </span>
            )}
          </div>
          {instancesLoading && instances.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">{zh ? "正在扫描端口..." : "Scanning ports..."}</p>
          ) : instances.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">
              {zh ? "未发现 Archicad 实例" : "No Archicad instances found"}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {instances.map((instance) => (
                <div key={instance.port} className="flex items-center justify-between gap-2 bg-zinc-900/50 px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-zinc-200">{instanceLabel(instance)}</div>
                    <div className="truncate font-mono text-[9px] text-zinc-600" title={instance.projectPath || undefined}>
                      {instance.projectPath || (zh ? "工程信息不可用" : "Project info unavailable")}
                    </div>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 font-mono text-[9px] ${instance.mepbridge ? "text-emerald-400" : "text-red-400"}`}>
                    {instance.mepbridge ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {instance.mepbridge ? "MEPBridge" : "missing"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-b border-zinc-800 py-3">
          <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "采集快照" : "Capture Snapshot"}</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">{zh ? "来源实例" : "Source instance"}</span>
              <select
                value={sourcePort ?? ""}
                onChange={(event) => setSourcePort(event.target.value === "" ? null : Number(event.target.value))}
                className="border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                {usableInstances.map((instance) => (
                  <option key={instance.port} value={instance.port}>{instanceLabel(instance)}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">{zh ? "元素范围" : "Element scope"}</span>
              <select
                value={captureMode}
                onChange={(event) => setCaptureMode(event.target.value as CaptureMode)}
                className="border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value="selection">{zh ? "当前选择集" : "Current selection"}</option>
                <option value="types">{zh ? "按元素类型" : "By element type"}</option>
              </select>
            </label>
          </div>
          {captureMode === "types" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ELEMENT_TYPE_OPTIONS.map((type) => {
                const active = selectedTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleType(type)}
                    className={`border px-2 py-1 text-[10px] transition-colors ${active ? "border-teal-500/50 bg-teal-500/15 text-teal-200" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => void runCapture()}
            disabled={!canCapture}
            className="mt-2 flex items-center gap-1.5 bg-teal-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-teal-200 transition-colors hover:bg-teal-600/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera className="h-3.5 w-3.5" />
            {busyAction === "capture" ? (zh ? "采集中..." : "Capturing...") : (zh ? "采集" : "Capture")}
          </button>
        </section>

        <section className="border-b border-zinc-800 py-3">
          <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "比较与回放" : "Compare & Replay"}</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">A</span>
              <select
                value={snapshotA}
                onChange={(event) => {
                  setSnapshotA(event.target.value);
                  setPreview(null);
                  setDiff(null);
                }}
                className="border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value="">{zh ? "选择快照 A" : "Select snapshot A"}</option>
                {snapshots.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">B</span>
              <select
                value={snapshotB}
                onChange={(event) => setSnapshotB(event.target.value)}
                className={`border bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 ${invalidPair ? "border-red-500/60" : "border-zinc-800"}`}
              >
                <option value="">{zh ? "选择快照 B" : "Select snapshot B"}</option>
                {snapshots.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </label>
          </div>
          {invalidPair && (
            <p className="mt-1 text-[10px] text-red-400">{zh ? "A/B 必须是不同快照" : "A/B must be different snapshots"}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runCompare()}
              disabled={!selectedSnapshotA || !selectedSnapshotB || invalidPair || busyAction !== ""}
              className="flex items-center gap-1.5 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitCompare className="h-3.5 w-3.5" />
              {busyAction === "compare" ? (zh ? "比较中..." : "Comparing...") : (zh ? "比较" : "Compare")}
            </button>
            <label className="flex min-w-[180px] flex-col gap-1">
              <span className="text-[10px] text-zinc-500">{zh ? "目标实例" : "Target instance"}</span>
              <select
                value={targetPort ?? ""}
                onChange={(event) => {
                  setTargetPort(event.target.value === "" ? null : Number(event.target.value));
                  setPreview(null);
                }}
                className="border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                {usableInstances.map((instance) => (
                  <option key={instance.port} value={instance.port}>{instanceLabel(instance)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={!selectedSnapshotA || snapshotSourceMissing || targetPort === null || sameSourceTarget || busyAction !== ""}
              className="flex items-center gap-1.5 bg-indigo-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-200 transition-colors hover:bg-indigo-600/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {busyAction === "preview" ? (zh ? "生成预览..." : "Previewing...") : (zh ? "生成预览" : "Preview")}
            </button>
            {preview?.canApply && !sameSourceTarget && (
              <button
                type="button"
                onClick={() => setShowReplayConfirm(true)}
                disabled={busyAction !== ""}
                className="flex items-center gap-1.5 bg-red-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-red-200 transition-colors hover:bg-red-600/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {zh ? "回放" : "Replay"}
              </button>
            )}
          </div>
          {sameSourceTarget && (
            <p className="mt-1 text-[10px] text-amber-400">
              {zh ? "来源与目标相同：只支持预览，不做同工程回放。" : "Source equals target: preview only, no same-project replay."}
            </p>
          )}
          {snapshotSourceMissing && (
            <p className="mt-1 text-[10px] text-red-400">
              {zh ? "快照缺少来源端口：不允许生成回放预览。" : "Snapshot source port is missing: replay preview is not allowed."}
            </p>
          )}
        </section>

        {diff && (
          <section className="border-b border-zinc-800 py-3">
            <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "差异摘要" : "Diff Summary"}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["matched", diff.summary?.matchedCount ?? 0],
                ["identical", diff.summary?.identicalCount ?? 0],
                ["differing", diff.summary?.differingCount ?? 0],
                ["only A", diff.summary?.onlyInACount ?? 0],
                ["only B", diff.summary?.onlyInBCount ?? 0]
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-zinc-900/50 px-2 py-1.5">
                  <dt className="font-mono text-[9px] text-zinc-500">{label}</dt>
                  <dd className="font-mono text-sm text-zinc-100">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {preview && (
          <section className="border-b border-zinc-800 py-3">
            <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "回放预览" : "Replay Preview"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="bg-zinc-900/50 px-2 py-1.5">
                <div className="font-mono text-[9px] text-zinc-500">create</div>
                <div className="font-mono text-sm text-zinc-100">{preview.estimatedCreateCount ?? 0}</div>
              </div>
              <div className="bg-zinc-900/50 px-2 py-1.5">
                <div className="font-mono text-[9px] text-zinc-500">unsupported</div>
                <div className="font-mono text-sm text-zinc-100">{preview.unsupportedElements?.length ?? 0}</div>
              </div>
              <div className="bg-zinc-900/50 px-2 py-1.5">
                <div className="font-mono text-[9px] text-zinc-500">canApply</div>
                <div className={`font-mono text-sm ${preview.canApply ? "text-emerald-400" : "text-red-400"}`}>{String(preview.canApply)}</div>
              </div>
              <div className="min-w-0 bg-zinc-900/50 px-2 py-1.5">
                <div className="font-mono text-[9px] text-zinc-500">expires</div>
                <div className="truncate font-mono text-[10px] text-zinc-200" title={preview.expiresAt}>
                  {preview.expiresAt ? new Date(preview.expiresAt).toLocaleTimeString() : "--"}
                </div>
              </div>
            </div>
          </section>
        )}

        {replayResult && (
          <section className="py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "回放结果" : "Replay Result"}</h4>
              <button
                type="button"
                onClick={() => setReplayResult(null)}
                className="p-1 text-zinc-500 hover:text-zinc-200"
                title={zh ? "关闭结果" : "Close result"}
                aria-label={zh ? "关闭结果" : "Close result"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <pre className="custom-scrollbar max-h-52 overflow-auto bg-black/30 p-2 text-[9px] leading-relaxed text-zinc-400">
              {JSON.stringify(replayResult, null, 2)}
            </pre>
          </section>
        )}
      </div>

      <ConfirmationDialog
        isOpen={showReplayConfirm}
        onClose={() => setShowReplayConfirm(false)}
        onConfirm={() => void applyReplay()}
        onCancel={() => setShowReplayConfirm(false)}
        title={zh ? "确认快照回放" : "Confirm Snapshot Replay"}
        message={zh
          ? `将在目标工程创建 ${preview?.estimatedCreateCount ?? 0} 个元素；执行后会逐个读回校验，失败时按逆创建序清理。`
          : `Create ${preview?.estimatedCreateCount ?? 0} elements in the target project. Each element is read back and verified; failures trigger reverse-order cleanup.`}
        operationType="mutation"
        affectedElementCount={preview?.estimatedCreateCount ?? 0}
        language={lang}
      />
    </div>
  );
}

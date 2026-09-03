import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileJson, RefreshCw } from "lucide-react";

type ElementTypeName = "Wall" | "Column" | "Beam" | "Slab" | "Zone";
type CaptureMode = "selection" | "types" | "all-supported";

type BuildingJsonDocument = {
  documentType?: string;
  schemaVersion?: string;
  exportedAt?: string;
  source?: {
    projectName?: string | null;
    projectPath?: string | null;
    port?: number | null;
  };
  coordinateSystem?: {
    unit?: string;
    space?: string;
    axis?: string;
  };
  capture?: {
    selectionMode?: string;
    failed?: Array<{ sourceGuid?: string; reason?: string }>;
    skipped?: Array<{ sourceGuid?: string; reason?: string }>;
  };
  summary?: {
    elementCount?: number;
    byType?: Record<string, number>;
    byFloor?: Record<string, number>;
    succeededCount?: number;
    failedCount?: number;
    skippedCount?: number;
  };
  integrity?: {
    algorithm?: string;
    hashScope?: string;
    sha256?: string;
    byteCount?: number;
  };
};

const ELEMENT_TYPE_OPTIONS: ElementTypeName[] = ["Wall", "Column", "Beam", "Slab", "Zone"];

function formatCount(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "0";
}

function formatEntries(summary: Record<string, number> | undefined, emptyLabel: string): string {
  if (!summary || Object.keys(summary).length === 0) return emptyLabel;
  return Object.entries(summary)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

async function requestJson(input: string, init?: RequestInit): Promise<any> {
  const response = await fetch(input, init);
  let data: any = null;
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

export default function BuildingJsonPanel({ lang }: { lang: "zh-CN" | "en-US" }) {
  const zh = lang === "zh-CN";
  const [captureMode, setCaptureMode] = useState<CaptureMode>("types");
  const [selectedTypes, setSelectedTypes] = useState<ElementTypeName[]>(["Wall"]);
  const [buildingJson, setBuildingJson] = useState<BuildingJsonDocument | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canExport = !loading && (captureMode !== "types" || selectedTypes.length > 0);
  const summaryItems = useMemo(() => {
    const summary = buildingJson?.summary;
    return [
      { label: "elements", value: formatCount(summary?.elementCount) },
      { label: "succeeded", value: formatCount(summary?.succeededCount) },
      { label: "failed", value: formatCount(summary?.failedCount) },
      { label: "skipped", value: formatCount(summary?.skippedCount) }
    ];
  }, [buildingJson]);

  const toggleType = (type: ElementTypeName) => {
    setSelectedTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type]);
  };

  const exportJson = async () => {
    setLoading(true);
    setError("");
    setWarnings([]);
    try {
      const body = captureMode === "selection"
        ? { selectionMode: "selection" }
        : captureMode === "types"
          ? { selectionMode: "types", requestedTypes: selectedTypes }
          : { selectionMode: "all-supported" };
      const data = await requestJson("/api/building-json/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setBuildingJson(data.buildingJson as BuildingJsonDocument);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    } catch (exportError) {
      setBuildingJson(null);
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!buildingJson) return;
    const blob = new Blob([JSON.stringify(buildingJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mepbridge-building-json-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileJson className="h-4 w-4 shrink-0 text-orange-400" />
          <span className="text-xs font-semibold text-zinc-200">{zh ? "Building JSON" : "Building JSON"}</span>
          {buildingJson && (
            <span className="shrink-0 font-mono text-[10px] text-zinc-500">{buildingJson.schemaVersion ?? "--"}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void exportJson()}
          disabled={!canExport}
          className="flex items-center gap-1.5 bg-orange-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-orange-200 transition-colors hover:bg-orange-600/35 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? (zh ? "导出中..." : "Exporting...") : (zh ? "导出" : "Export")}
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <div className="mb-3 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-red-300">
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-3 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            {warnings.map((warning) => (
              <div key={warning} className="truncate" title={warning}>{warning}</div>
            ))}
          </div>
        )}

        <section className="border-b border-zinc-800 pb-3">
          <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "导出范围" : "Export Scope"}</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">{zh ? "元素范围" : "Element scope"}</span>
              <select
                value={captureMode}
                onChange={(event) => setCaptureMode(event.target.value as CaptureMode)}
                className="border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value="selection">{zh ? "当前选择集" : "Current selection"}</option>
                <option value="types">{zh ? "按元素类型" : "By element type"}</option>
                <option value="all-supported">{zh ? "全部支持类型" : "All supported types"}</option>
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
                    className={`border px-2 py-1 text-[10px] transition-colors ${active ? "border-orange-500/50 bg-orange-500/15 text-orange-200" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {buildingJson ? (
          <>
            <section className="border-b border-zinc-800 py-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "文档信息" : "Document"}</h4>
                <button
                  type="button"
                  onClick={downloadJson}
                  className="flex items-center gap-1.5 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  {zh ? "下载 JSON" : "Download JSON"}
                </button>
              </div>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="bg-zinc-900/50 px-2.5 py-2">
                  <dt className="font-mono text-[9px] text-zinc-500">documentType</dt>
                  <dd className="truncate font-mono text-[10px] text-zinc-200">{buildingJson.documentType ?? "--"}</dd>
                </div>
                <div className="bg-zinc-900/50 px-2.5 py-2">
                  <dt className="font-mono text-[9px] text-zinc-500">schemaVersion</dt>
                  <dd className="font-mono text-[10px] text-zinc-200">{buildingJson.schemaVersion ?? "--"}</dd>
                </div>
                <div className="min-w-0 bg-zinc-900/50 px-2.5 py-2">
                  <dt className="font-mono text-[9px] text-zinc-500">{zh ? "来源" : "source"}</dt>
                  <dd className="truncate text-[10px] text-zinc-200" title={buildingJson.source?.projectPath || undefined}>
                    {buildingJson.source?.projectName || (zh ? "未命名工程" : "Untitled project")}
                    {buildingJson.source?.port !== undefined && buildingJson.source?.port !== null ? ` :${buildingJson.source.port}` : ""}
                  </dd>
                </div>
                <div className="bg-zinc-900/50 px-2.5 py-2">
                  <dt className="font-mono text-[9px] text-zinc-500">{zh ? "单位 / 坐标" : "unit / coordinates"}</dt>
                  <dd className="truncate text-[10px] text-zinc-200">
                    {buildingJson.coordinateSystem?.unit || "--"} · {buildingJson.coordinateSystem?.space || "--"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="border-b border-zinc-800 py-3">
              <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "摘要" : "Summary"}</h4>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {summaryItems.map((item) => (
                  <div key={item.label} className="bg-zinc-900/50 px-2 py-1.5">
                    <dt className="font-mono text-[9px] text-zinc-500">{item.label}</dt>
                    <dd className="font-mono text-sm text-zinc-100">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 space-y-1 text-[10px] text-zinc-500">
                <div className="truncate" title={formatEntries(buildingJson.summary?.byType, "--")}>
                  byType: {formatEntries(buildingJson.summary?.byType, "--")}
                </div>
                <div className="truncate" title={formatEntries(buildingJson.summary?.byFloor, "--")}>
                  byFloor: {formatEntries(buildingJson.summary?.byFloor, "--")}
                </div>
              </div>
            </section>

            <section className="py-3">
              <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "采集与完整性" : "Capture & Integrity"}</h4>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="bg-zinc-900/50 px-2.5 py-2">
                  <div className="font-mono text-[9px] text-zinc-500">capture failed / skipped</div>
                  <div className="font-mono text-sm text-zinc-100">
                    {buildingJson.capture?.failed?.length ?? 0} / {buildingJson.capture?.skipped?.length ?? 0}
                  </div>
                </div>
                <div className="min-w-0 bg-zinc-900/50 px-2.5 py-2">
                  <div className="font-mono text-[9px] text-zinc-500">integrity</div>
                  <div className="flex items-center gap-1 font-mono text-[10px] text-zinc-200">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span className="truncate" title={buildingJson.integrity?.sha256}>
                      {buildingJson.integrity?.sha256 ?? "--"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[9px] text-zinc-500">
                    {buildingJson.integrity?.algorithm ?? "--"} · {buildingJson.integrity?.byteCount ?? 0} bytes
                  </div>
                </div>
              </div>
              {(buildingJson.capture?.failed?.length ?? 0) + (buildingJson.capture?.skipped?.length ?? 0) > 0 && (
                <div className="mt-2 flex items-start gap-1.5 border-l-2 border-amber-500 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {zh
                      ? `采集未完全成功：失败 ${buildingJson.capture?.failed?.length ?? 0}，跳过 ${buildingJson.capture?.skipped?.length ?? 0}。`
                      : `Capture incomplete: ${buildingJson.capture?.failed?.length ?? 0} failed, ${buildingJson.capture?.skipped?.length ?? 0} skipped.`}
                  </span>
                </div>
              )}
            </section>
          </>
        ) : !loading && !error && (
          <p className="py-8 text-center text-xs text-zinc-500">
            {zh ? "尚无 Building JSON 文档" : "No Building JSON document"}
          </p>
        )}
      </div>
    </div>
  );
}

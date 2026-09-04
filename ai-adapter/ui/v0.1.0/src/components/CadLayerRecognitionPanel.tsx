import { useState } from "react";
import { AlertTriangle, Layers, RefreshCw, ShieldAlert } from "lucide-react";

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
    name: string;
    recognition?: {
      category?: string | null;
      confidence?: number;
      matchingRule?: string;
      matchedKeywords?: string[];
      reviewRequired?: boolean;
    };
  }>;
};

function confidenceLabel(value: number | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "--";
}

function categoryLabel(value: string | null | undefined, zh: boolean): string {
  if (value) return value;
  return zh ? "未识别" : "Unrecognized";
}

function categorySummary(byCategory: Record<string, number> | undefined, zh: boolean): string {
  if (!byCategory || Object.keys(byCategory).length === 0) return zh ? "暂无分类" : "No categories";
  return Object.entries(byCategory).map(([key, value]) => `${key}: ${value}`).join(" · ");
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

export default function CadLayerRecognitionPanel({ lang }: { lang: "zh-CN" | "en-US" }) {
  const zh = lang === "zh-CN";
  const [report, setReport] = useState<RecognitionReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const recognizeLayers = async () => {
    setLoading(true);
    setError("");
    setWarnings([]);
    try {
      const data = await requestJson("/api/cad-layers/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      setReport(data.report as RecognitionReport);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    } catch (recognizeError) {
      setReport(null);
      setError(recognizeError instanceof Error ? recognizeError.message : String(recognizeError));
    } finally {
      setLoading(false);
    }
  };

  const summaryItems = [
    { label: "layers", value: report?.summary?.layerCount ?? 0 },
    { label: "recognized", value: report?.summary?.recognizedCount ?? 0 },
    { label: "review", value: report?.summary?.reviewRequiredCount ?? 0 }
  ];

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-lime-400" />
          <span className="text-xs font-semibold text-zinc-200">{zh ? "CAD 图层识别" : "CAD Layers"}</span>
          {report && (
            <span className="shrink-0 font-mono text-[10px] text-zinc-500">{report.schemaVersion ?? "--"}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void recognizeLayers()}
          disabled={loading}
          className="flex items-center gap-1.5 bg-lime-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-lime-200 transition-colors hover:bg-lime-600/35 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? (zh ? "识别中..." : "Recognizing...") : (zh ? "识别" : "Recognize")}
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

        {report ? (
          <>
            <section className="border-b border-zinc-800 pb-3">
              <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "识别摘要" : "Recognition Summary"}</h4>
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

            <section className="py-3">
              <h4 className="text-[11px] font-semibold text-zinc-300">{zh ? "图层结果" : "Layer Results"}</h4>
              {(report.layers?.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500">
                  {zh ? "当前工程没有图层" : "No layers in the current project"}
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {report.layers?.map((layer, index) => {
                    const recognition = layer.recognition;
                    const reviewRequired = recognition?.reviewRequired === true;
                    const lowConfidence = typeof recognition?.confidence === "number"
                      && recognition.confidence < 0.8;
                    return (
                      <div
                        key={`${layer.index ?? index}-${layer.name}`}
                        className={`border px-2.5 py-2 ${reviewRequired ? "border-amber-500/35 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/50"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] text-zinc-100" title={layer.name}>{layer.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 text-[9px] font-semibold ${recognition?.category ? "bg-lime-500/15 text-lime-300" : "bg-zinc-800 text-zinc-400"}`}>
                                {categoryLabel(recognition?.category, zh)}
                              </span>
                              <span className={`font-mono text-[9px] ${lowConfidence ? "text-amber-300" : "text-zinc-400"}`}>
                                {confidenceLabel(recognition?.confidence)}
                              </span>
                            </div>
                          </div>
                          {reviewRequired && (
                            <span className="flex shrink-0 items-center gap-1 bg-amber-500/15 px-1.5 py-1 text-[9px] font-semibold text-amber-300">
                              <ShieldAlert className="h-3 w-3" />
                              {zh ? "待复核" : "Review"}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] text-zinc-500">
                          <span className="truncate font-mono" title={recognition?.matchingRule}>
                            {recognition?.matchingRule || "no-keyword-match"}
                          </span>
                          {(recognition?.matchedKeywords?.length ?? 0) > 0 && (
                            <span className="truncate font-mono">
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
                    ? `有 ${report.summary?.reviewRequiredCount} 个图层需要人工复核。`
                    : `${report.summary?.reviewRequiredCount} layers require review.`}
                </span>
              </div>
            )}
          </>
        ) : !loading && !error && (
          <p className="py-8 text-center text-xs text-zinc-500">
            {zh ? "尚无识别结果" : "No recognition report"}
          </p>
        )}
      </div>
    </div>
  );
}

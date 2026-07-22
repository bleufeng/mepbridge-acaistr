import { useCallback, useEffect, useState } from "react";
import { Boxes, Play, RefreshCw, ShieldCheck } from "lucide-react";

type LocalizedText = {
  "zh-CN": string;
  "en-US": string;
};

type ModuleCommand = {
  name: string;
  displayName: LocalizedText;
  description: LocalizedText;
  category: string;
  commandType: string;
  riskLevel: "read-only" | "low-mutation";
  inputSchema: {
    type: "object";
    required?: string[];
    properties?: Record<string, unknown>;
  };
};

type WorkbenchModule = {
  id: string;
  version: string;
  displayName: LocalizedText;
  description: LocalizedText;
  riskLevel: "read-only" | "low-mutation";
  status: string;
  available: boolean;
  commands: ModuleCommand[];
};

interface ModuleCatalogPanelProps {
  lang: "zh-CN" | "en-US";
}

export default function ModuleCatalogPanel({ lang }: ModuleCatalogPanelProps) {
  const [modules, setModules] = useState<WorkbenchModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runningCommand, setRunningCommand] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const zh = lang === "zh-CN";

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/extensions/catalog");
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const executeCommand = async (command: ModuleCommand) => {
    setRunningCommand(command.name);
    setResult(null);
    setError("");
    try {
      const response = await fetch(
        `/api/extensions/commands/${encodeURIComponent(command.name)}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parameters: {} }),
        },
      );
      const data = await response.json();
      setResult(data);
      if (!response.ok || !data.ok) {
        setError(data.error || `HTTP ${response.status}`);
      }
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : String(executeError));
    } finally {
      setRunningCommand("");
    }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold text-zinc-200">
            {zh ? "审核模块" : "Reviewed Modules"}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">{modules.length}</span>
        </div>
        <button
          type="button"
          onClick={() => void loadModules()}
          className="p-1 text-zinc-500 transition-colors hover:text-sky-300"
          title={zh ? "刷新模块目录" : "Refresh module catalog"}
          aria-label={zh ? "刷新模块目录" : "Refresh module catalog"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <div className="mb-3 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {loading && modules.length === 0 ? (
          <div className="py-10 text-center text-xs text-zinc-500">
            {zh ? "正在读取模块目录..." : "Loading module catalog..."}
          </div>
        ) : modules.length === 0 ? (
          <div className="py-10 text-center text-xs text-zinc-500">
            {zh ? "当前没有已启用模块" : "No reviewed modules are enabled"}
          </div>
        ) : (
          <div className="space-y-3">
            {modules.map((module) => (
              <section
                key={module.id}
                className="border-b border-zinc-800 pb-3 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-100">
                        {module.displayName[lang]}
                      </span>
                      <span className="font-mono text-[9px] text-zinc-600">
                        {module.id} v{module.version}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                      {module.description[lang]}
                    </p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-[9px] ${
                      module.available ? "text-emerald-400" : "text-zinc-600"
                    }`}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {module.available
                      ? (zh ? "已启用" : "Enabled")
                      : (zh ? "不可用" : "Offline")}
                  </span>
                </div>

                <div className="mt-2 space-y-1.5">
                  {module.commands.map((command) => {
                    const hasRequiredParameters = (command.inputSchema.required?.length || 0) > 0;
                    const canRun = module.available &&
                      command.riskLevel === "read-only" &&
                      !hasRequiredParameters;

                    return (
                      <div
                        key={command.name}
                        className="flex items-center justify-between gap-3 bg-zinc-900/50 px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-zinc-300">
                            {command.displayName[lang]}
                          </div>
                          <div className="truncate font-mono text-[9px] text-zinc-600">
                            {command.name}
                          </div>
                        </div>
                        {canRun && (
                          <button
                            type="button"
                            onClick={() => void executeCommand(command)}
                            disabled={runningCommand === command.name}
                            className="flex shrink-0 items-center gap-1 bg-sky-600/20 px-2 py-1 text-[10px] text-sky-300 transition-colors hover:bg-sky-600/35 disabled:cursor-wait disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" />
                            {runningCommand === command.name
                              ? (zh ? "执行中" : "Running")
                              : (zh ? "执行" : "Run")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {result !== null && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="mb-1.5 text-[10px] font-semibold text-zinc-400">
              {zh ? "模块结果" : "Module Result"}
            </div>
            <pre className="custom-scrollbar max-h-52 overflow-auto bg-black/30 p-2 text-[9px] leading-relaxed text-zinc-400">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

export interface JsonViewerProps {
  title: string;
  data: any;
  defaultExpanded?: boolean;
  language?: "zh-CN" | "en-US";
}

const translations = {
  "zh-CN": {
    copied: "已复制",
    copy: "复制",
    collapse: "收起",
    expand: "展开"
  },
  "en-US": {
    copied: "Copied",
    copy: "Copy",
    collapse: "Collapse",
    expand: "Expand"
  }
};

export const JsonViewer: React.FC<JsonViewerProps> = ({
  title,
  data,
  defaultExpanded = false,
  language = "zh-CN"
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isCopied, setIsCopied] = useState(false);
  const t = translations[language];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const renderJsonValue = (value: any, depth: number = 0): React.ReactElement => {
    const indent = depth * 16;

    if (value === null) {
      return <span className="text-slate-500">null</span>;
    }

    if (typeof value === "boolean") {
      return <span className="text-purple-400">{String(value)}</span>;
    }

    if (typeof value === "number") {
      return <span className="text-cyan-400">{value}</span>;
    }

    if (typeof value === "string") {
      return <span className="text-emerald-400">"{value}"</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="text-slate-500">[]</span>;
      }

      return (
        <div>
          <span className="text-slate-500">[</span>
          {value.map((item, index) => (
            <div key={index} style={{ paddingLeft: `${indent + 16}px` }}>
              {renderJsonValue(item, depth + 1)}
              {index < value.length - 1 && <span className="text-slate-500">,</span>}
            </div>
          ))}
          <div style={{ paddingLeft: `${indent}px` }}>
            <span className="text-slate-500">]</span>
          </div>
        </div>
      );
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return <span className="text-slate-500">{"{}"}</span>;
      }

      return (
        <div>
          <span className="text-slate-500">{"{"}</span>
          {keys.map((key, index) => (
            <div key={key} style={{ paddingLeft: `${indent + 16}px` }}>
              <span className="text-blue-400">"{key}"</span>
              <span className="text-slate-500">: </span>
              {renderJsonValue(value[key], depth + 1)}
              {index < keys.length - 1 && <span className="text-slate-500">,</span>}
            </div>
          ))}
          <div style={{ paddingLeft: `${indent}px` }}>
            <span className="text-slate-500">{"}"}</span>
          </div>
        </div>
      );
    }

    return <span className="text-slate-400">{String(value)}</span>;
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-700/50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors flex-1 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-cyan-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <span className="font-medium">{title}</span>
          <span className="text-xs text-slate-500 ml-2">
            {isExpanded ? t.collapse : t.expand}
          </span>
        </button>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-all duration-200 flex items-center gap-2 text-sm"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">{t.copied}</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>{t.copy}</span>
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 overflow-x-auto">
              <pre className="text-xs font-mono leading-relaxed">
                {renderJsonValue(data)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JsonViewer;

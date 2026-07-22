// UserTemplateGroups.tsx
// 右区 Copilot 模式用户模板快捷栏
// 默认显示上一次任务（最近更新的1个），可展开查看全部

import React, { useState, useMemo } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import type { TaskTemplate } from '../userAssets';

interface UserTemplateGroupsProps {
  lang: string;
  userTemplates: TaskTemplate[];
  onReplay: (tpl: TaskTemplate) => void;
}

export const UserTemplateGroups: React.FC<UserTemplateGroupsProps> = ({
  lang,
  userTemplates,
  onReplay,
}) => {
  const zh = lang === "zh-CN";
  const [showAll, setShowAll] = useState(false);

  // 按 updatedAt 降序排列，取最近1个作为"上一次任务"
  const sorted = useMemo(() => {
    return [...userTemplates].sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
  }, [userTemplates]);

  const lastTemplate = sorted[0] || null;
  const restTemplates = sorted.slice(1);

  if (userTemplates.length === 0) {
    return (
      <div className="flex-shrink-0 px-3 py-2 bg-zinc-900/20 border-t border-zinc-800 flex flex-col gap-1.5 select-none">
        <span className="text-[10px] font-mono uppercase text-pink-400/70 tracking-wider flex items-center gap-1">
          <Bookmark className="w-3 h-3" />
          {zh ? "用户模板" : "User Templates"}
        </span>
        <span className="text-[10px] text-zinc-600 italic">
          {zh ? "执行计划后点🔖存为模板创建快捷任务" : "Execute a plan then click 🔖 to save template"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 px-3 py-2 bg-zinc-900/20 border-t border-zinc-800 flex flex-col gap-1.5 select-none">
      {/* 标题行 + 展开箭头（右侧） */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase text-pink-400/70 tracking-wider flex items-center gap-1">
          <Bookmark className="w-3 h-3" />
          {zh ? "用户模板" : "User Templates"}
          <span className="text-zinc-600 normal-case">({userTemplates.length})</span>
        </span>
        {restTemplates.length > 0 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
            title={showAll ? (zh ? "收起" : "Collapse") : (zh ? "展开" : "Expand")}
          >
            <span className="font-mono">{showAll ? (zh ? "收起" : "Collapse") : (zh ? "展开" : "Expand")}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${showAll ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* 上一次任务（默认显示1个） */}
      {lastTemplate && (
        <button
          onClick={() => onReplay(lastTemplate)}
          className="w-full bg-zinc-800 border border-pink-500/30 hover:border-pink-500/50 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none font-mono text-left cursor-pointer transition-colors flex items-center gap-2"
        >
          <span className="text-xs flex-shrink-0">{lastTemplate.icon || "📋"}</span>
          <span className="flex-1 truncate">{lastTemplate.name}</span>
          <span className={`px-1 rounded text-[8px] flex-shrink-0 ${
            lastTemplate.riskLevel === "low-mutation"
              ? "bg-amber-500/10 text-amber-400"
              : "bg-emerald-500/10 text-emerald-400"
          }`}>
            {lastTemplate.riskLevel}
          </span>
        </button>
      )}

      {/* 展开时显示剩余模板 */}
      {showAll && restTemplates.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto custom-scrollbar">
          {restTemplates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => onReplay(tpl)}
              className="w-full bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-pink-500/30 rounded py-1.5 px-2 text-[10px] text-zinc-200 outline-none font-mono text-left cursor-pointer transition-colors flex items-center gap-2"
            >
              <span className="text-xs flex-shrink-0">{tpl.icon || "📋"}</span>
              <span className="flex-1 truncate">{tpl.name}</span>
              <span className={`px-1 rounded text-[8px] flex-shrink-0 ${
                tpl.riskLevel === "low-mutation"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-emerald-500/10 text-emerald-400"
              }`}>
                {tpl.riskLevel}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

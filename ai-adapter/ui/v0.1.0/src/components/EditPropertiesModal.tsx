// EditPropertiesModal.tsx
// 编辑构件属性交互式对话框组件（简化版）
// 只针对建筑构件（墙/楼板/梁/柱/门窗等）的核心属性（尺寸/高度/图层/元素ID等）
// 用 API.GetPropertyValuesOfElements 读取原值，用 EditSelectedElements + propertyGuid 修改

import React, { useState, useEffect } from "react";
import { X, FileEdit, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

interface EditPropertiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: EditParams) => Promise<void>;
  lang: string;
}

interface EditParams {
  propertyGuid: string;    // 属性定义 GUID（用于 EditSelectedElements）
  propertyName: string;    // 属性名（显示用）
  propertyGroup: string;   // 属性组名（显示用）
  valueType: string;       // 属性类型（string/length/integer/real/boolean）
  valueString: string;     // 新值（字符串形式）
}

interface SelectionInfo {
  count: number;
  types: Record<string, number>;
  guids: string[];
}

// 建筑构件类型白名单
const BUILDING_ELEMENT_TYPES = ["Wall", "Column", "Beam", "Slab", "Roof", "Door", "Window", "Opening", "Object", "Lamp"];

// 核心属性组（只显示这些组的属性）
const CORE_GROUPS = ["常规参数", "几何图形", "General", "Geometry"];

// 核心属性名关键词（只显示这些属性）
const CORE_PROP_KEYWORDS = [
  "元素ID", "Element ID",
  "图层", "Layer",
  "高", "Height",
  "宽", "Width",
  "厚", "Thickness",
  "长", "Length",
  "标高", "Level",
  "楼层", "Story",
  "截面", "Section",
  "名称", "Name",
  "备注", "Note",
  "材质", "Material"
];

function isCoreProperty(groupName: string, propName: string): boolean {
  // 必须在核心组内
  const inCoreGroup = CORE_GROUPS.some(g =>
    groupName.toLowerCase().includes(g.toLowerCase())
  );
  if (!inCoreGroup) return false;
  // 属性名匹配核心关键词
  return CORE_PROP_KEYWORDS.some(kw =>
    propName.toLowerCase().includes(kw.toLowerCase())
  );
}

export const EditPropertiesModal: React.FC<EditPropertiesModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang
}) => {
  const [editParams, setEditParams] = useState<EditParams>({
    propertyGuid: "",
    propertyName: "",
    propertyGroup: "",
    valueType: "",
    valueString: ""
  });
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [availableProperties, setAvailableProperties] = useState<Array<{
    guid: string;
    name: string;
    group: string;
    valueType: string;
  }>>([]);
  const [propDefStatus, setPropDefStatus] = useState<string>("");
  const [originalValue, setOriginalValue] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [isLoadingProps, setIsLoadingProps] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditParams({ propertyGuid: "", propertyName: "", propertyGroup: "", valueType: "", valueString: "" });
      setAvailableProperties([]);
      setPropDefStatus("");
      setOriginalValue("");
      loadSelectionInfo();
    }
  }, [isOpen]);

  // 加载选择集信息
  const loadSelectionInfo = async () => {
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
              addOnCommandParameters: { onlyEditable: false, includeAabb: false, includeMepInfo: false }
            }
          }
        })
      });
      const data = await res.json();
      if (data.ok && data.response?.succeeded) {
        const resultData = data.response.result?.addOnCommandResponse || data.response.result;
        const elements = resultData?.elements || [];
        const typeCounts: Record<string, number> = {};
        const guids: string[] = [];
        elements.forEach((el: any) => {
          const type = el.type || el.elementType || "Unknown";
          typeCounts[type] = (typeCounts[type] || 0) + 1;
          if (el.guid) guids.push(el.guid);
        });
        setSelectionInfo({ count: elements.length, types: typeCounts, guids });

        // 检查是否都是建筑构件
        const nonBuilding = Object.keys(typeCounts).filter(t => !BUILDING_ELEMENT_TYPES.includes(t));
        if (nonBuilding.length > 0) {
          setPropDefStatus(lang === "zh-CN"
            ? `包含非建筑构件: ${nonBuilding.join(", ")}（仅支持墙/柱/梁/板/屋顶/门窗）`
            : `Contains non-building elements: ${nonBuilding.join(", ")} (only Wall/Column/Beam/Slab/Roof/Door/Window supported)`);
          return;
        }

        if (guids.length > 0) {
          loadCoreProperties(guids);
        } else {
          setPropDefStatus(lang === "zh-CN" ? "请先选择构件" : "Please select elements first");
        }
      }
    } catch (err) {
      console.error("Failed to load selection info:", err);
    }
  };

  // 加载核心属性定义（MEPBridge GetElementPropertyDefinitions + 过滤）
  const loadCoreProperties = async (guids: string[]) => {
    setIsLoadingProps(true);
    setPropDefStatus(lang === "zh-CN" ? "正在加载属性定义..." : "Loading properties...");
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetElementPropertyDefinitions" },
              addOnCommandParameters: {}
            }
          }
        })
      });
      const data = await res.json();
      if (data.ok && data.response?.succeeded) {
        const resultData = data.response.result?.addOnCommandResponse || data.response.result;
        const allProps = resultData?.properties || [];

        // 过滤：核心组 + 核心属性名 + 可编辑
        const coreProps = allProps
          .filter((p: any) => p.propertyIsEditable !== false)
          .filter((p: any) => isCoreProperty(p.propertyGroupName || "", p.propertyName || ""))
          .map((p: any) => ({
            guid: p.propertyId?.guid || "",
            name: p.propertyName || "",
            group: p.propertyGroupName || "",
            valueType: p.propertyValueType || "string"
          }))
          .filter((p: any) => p.guid && p.name);

        // 按组+名排序
        coreProps.sort((a: any, b: any) =>
          (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name)
        );

        setAvailableProperties(coreProps);
        setPropDefStatus(coreProps.length === 0
          ? (lang === "zh-CN" ? "无可编辑的核心属性" : "No editable core properties")
          : "");
      } else {
        setPropDefStatus(lang === "zh-CN" ? "属性定义加载失败" : "Failed to load properties");
      }
    } catch (err) {
      console.error("Failed to load properties:", err);
      setPropDefStatus(lang === "zh-CN" ? "属性定义加载出错" : "Error loading properties");
    } finally {
      setIsLoadingProps(false);
    }
  };

  // 选中属性后读取当前值（用 API.GetPropertyValuesOfElements）
  const loadCurrentValue = async (propGuid: string) => {
    if (!selectionInfo?.guids?.length || !propGuid) return;
    setOriginalValue("");
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.GetPropertyValuesOfElements",
            parameters: {
              elements: selectionInfo.guids.slice(0, 1).map(g => ({ elementId: { guid: g } })),
              properties: [{ propertyId: { guid: propGuid } }]
            }
          }
        })
      });
      const data = await res.json();
      if (data.ok && data.response?.succeeded) {
        const result = data.response.result;
        const propValues = result?.propertyValuesForElements?.[0]?.propertyValues || [];
        if (propValues.length > 0) {
          const val = propValues[0].propertyValue;
          const displayVal = val?.value !== undefined ? String(val.value) : "";
          setOriginalValue(displayVal);
          setEditParams(prev => ({ ...prev, valueString: displayVal }));
        }
      }
    } catch (err) {
      console.error("Failed to load current value:", err);
    }
  };

  const handleExecute = async () => {
    if (!editParams.propertyGuid || !editParams.valueString) {
      alert(lang === "zh-CN" ? "请选择属性并输入值" : "Please select property and enter value");
      return;
    }
    if (originalValue === editParams.valueString) {
      alert(lang === "zh-CN" ? "新值与原值相同，无需修改" : "New value is same as original");
      return;
    }
    setIsExecuting(true);
    try {
      await onExecute(editParams);
      onClose();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isOpen) return null;

  const t = lang === "zh-CN" ? {
    title: "编辑属性",
    currentSelection: "当前选择",
    elements: "个构件",
    propertyName: "属性名",
    propertyValue: "属性值",
    originalValue: "原值",
    newValue: "新值",
    warning: "此操作将修改 Archicad 模型中选中构件的属性",
    cancel: "取消",
    confirm: "确认执行",
    loading: "加载中...",
    selectProperty: "-- 选择属性 --",
    noChange: "新值与原值相同，无需修改",
    changed: "已修改，点击确认执行",
    supportedTypes: "支持: 墙/柱/梁/板/屋顶/门窗"
  } : {
    title: "Edit Properties",
    currentSelection: "Current Selection",
    elements: "elements",
    propertyName: "Property Name",
    propertyValue: "Property Value",
    originalValue: "Original",
    newValue: "New",
    warning: "This operation will modify properties of selected elements in Archicad",
    cancel: "Cancel",
    confirm: "Confirm",
    loading: "Loading...",
    selectProperty: "-- Select property --",
    noChange: "New value is same as original, no change needed",
    changed: "Modified, click confirm to execute",
    supportedTypes: "Supports: Wall/Column/Beam/Slab/Roof/Door/Window"
  };

  // 按组分组属性
  const groupedProps = availableProperties.reduce((acc, prop) => {
    if (!acc[prop.group]) acc[prop.group] = [];
    acc[prop.group].push(prop);
    return acc;
  }, {} as Record<string, typeof availableProperties>);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <FileEdit className="w-5 h-5 text-amber-400" />
            {t.title}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Current Selection */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
            <div className="text-sm font-semibold text-zinc-300 mb-1">
              📊 {t.currentSelection}: {selectionInfo?.count || 0} {t.elements}
            </div>
            {selectionInfo && selectionInfo.count > 0 && (
              <div className="text-xs text-zinc-400 pl-4">
                └─ {Object.entries(selectionInfo.types).map(([type, count]) => `${type}×${count}`).join(", ")}
              </div>
            )}
            <div className="text-[10px] text-zinc-500 mt-1">{t.supportedTypes}</div>
          </div>

          {/* Property Selection */}
          <div className="space-y-3">
            {/* 步骤 1: 选择属性 */}
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-zinc-300">
                📐 {t.propertyName}
                {availableProperties.length > 0 && (
                  <span className="ml-2 text-xs text-zinc-500">({availableProperties.length})</span>
                )}
              </div>
              {isLoadingProps ? (
                <div className="text-xs text-zinc-500 italic py-2">{t.loading}</div>
              ) : availableProperties.length > 0 ? (
                <select
                  value={editParams.propertyGuid}
                  onChange={(e) => {
                    const selected = availableProperties.find(p => p.guid === e.target.value);
                    if (selected) {
                      setEditParams({
                        propertyGuid: selected.guid,
                        propertyName: selected.name,
                        propertyGroup: selected.group,
                        valueType: selected.valueType,
                        valueString: ""
                      });
                      setOriginalValue("");
                      loadCurrentValue(selected.guid);
                    }
                  }}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500"
                >
                  <option value="">{t.selectProperty}</option>
                  {(Object.entries(groupedProps) as Array<[string, typeof availableProperties]>).sort(([a],[b]) => a.localeCompare(b)).map(([group, props]) => (
                    <optgroup key={group} label={group}>
                      {props.map(p => (
                        <option key={p.guid} value={p.guid}>
                          {p.name} [{p.valueType}]
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-amber-400/80 italic py-2">{propDefStatus}</div>
              )}
            </div>

            {/* 步骤 2: 原值 → 新值 对比 */}
            {editParams.propertyGuid && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-zinc-300">✏️ {t.propertyValue}</div>
                <div className="bg-zinc-800/80 border border-zinc-600 rounded-lg p-3 space-y-2">
                  {/* 原值 */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-zinc-500 uppercase w-12 shrink-0">{t.originalValue}</span>
                    <div className={`flex-1 px-3 py-1.5 rounded text-sm font-mono min-h-[32px] break-all ${
                      originalValue ? "bg-zinc-700/50 text-zinc-300" : "text-zinc-600 italic"
                    }`}>
                      {originalValue || (lang === "zh-CN" ? "（未获取到）" : "(not available)")}
                    </div>
                  </div>
                  {/* 箭头 */}
                  <div className="flex justify-center">
                    <ArrowRight className="w-4 h-4 text-amber-500/60" />
                  </div>
                  {/* 新值 */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-emerald-400/70 uppercase w-12 shrink-0">{t.newValue}</span>
                    <input
                      type="text"
                      value={editParams.valueString}
                      onChange={(e) => setEditParams(prev => ({ ...prev, valueString: e.target.value }))}
                      placeholder={lang === "zh-CN" ? "输入新值" : "Enter new value"}
                      className="flex-1 bg-zinc-700 border border-zinc-500 rounded px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  {/* 变更状态 */}
                  {originalValue && editParams.valueString && (
                    <div className={`text-[11px] text-center py-1 rounded ${
                      originalValue === editParams.valueString
                        ? "text-amber-400/70 bg-amber-900/20"
                        : "text-emerald-400/70 bg-emerald-900/20"
                    }`}>
                      {originalValue === editParams.valueString ? t.noChange : t.changed}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
            ⚠️ {t.warning}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm text-zinc-300 transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting || !editParams.propertyGuid || !editParams.valueString || originalValue === editParams.valueString}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            {isExecuting ? t.loading : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditPropertiesModal;

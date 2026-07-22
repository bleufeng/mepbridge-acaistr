// userAssets.ts —— E.1: 用户自定义能力数据模型
// 严格沿用 types.ts 现有类型，不污染原文件。

import type { OperationPlan } from "./types";

// ============================================================================
// ① 快捷任务模板：一个已固化、可重放的 OperationPlan
// ============================================================================

export type TemplateCategory =
  | "MEPBridge-读取"
  | "MEPBridge-修改"
  | "Water"
  | "Electrical"
  | "Ventilation"
  | "Building"
  | "自定义";

export type RiskLevel = "read" | "low-mutation";

export interface TaskTemplate {
  id: string;                          // uuid，本地生成
  name: string;                        // 用户起名，如"标准水管上移200"
  category: TemplateCategory;          // 对齐 C.1.6 模块切换器的 6 模块 + "自定义"
  icon?: string;                       // emoji，沿用现有按钮风格（如 "↕️"）
  description: string;
  plan: OperationPlan;                 // 完整复用现有结构（title/warning/isMutation/mepCode/steps/parameters）
  placeholders?: Placeholder[];        // 可选：重放时让用户填的参数槽
  riskLevel: RiskLevel;                // 对齐 tool-descriptors.json 的 riskLevel
  createdAt: string;                   // ISO 8601
  updatedAt: string;                   // ISO 8601
  // 元数据增强（optional, 向后兼容）— 用于热度排序和资源管理
  tags?: string[];                     // 用户自定义标签，远期可做多维筛选
  usageCount?: number;                 // 重放次数，用于热度排序
  lastUsedAt?: string;                 // 最近使用时间 ISO 8601
  version?: string;                    // 模板版本号，如 "1.0"
  notes?: string;                      // 用户备注
}

// ============================================================================
// 占位符：模板里 {{dz}} 这类变量，重放时弹窗让用户填
// ============================================================================

export type PlaceholderValidate = "number" | "integer" | "guid-list";

export interface Placeholder {
  key: string;                         // 如 "dz"
  label: string;                       // 如 "Z 轴位移(mm)"
  defaultValue: string;                // 如 "200"
  validate?: PlaceholderValidate;      // 校验类型，复用 D3 safety-check 逻辑
}

// ============================================================================
// ② 自定义 NL 命令：触发短语 → 模板/单步命令
// ============================================================================

export interface CustomNLCommand {
  id: string;
  triggers: string[];                  // ["把管子抬高", "上移水管"]，命中任一即触发
  templateId?: string;                 // 命中后重放此模板（与 singleStep 二选一）
  singleStep?: {                       // 或直接绑一个单步命令（对齐第 11 节 action 驱动）
    action: string;                    // 如 "MoveSelectedElements"，对齐 tool-descriptors 的 commandName
    params: Record<string, unknown>;   // 命令参数
    riskLevel: RiskLevel;
  };
  priority: number;                    // 数字越大越优先，自定义 > LLM 兜底
  enabled: boolean;
  createdAt: string;                   // ISO 8601
  // 元数据增强（optional, 向后兼容）
  description?: string;                // 命令用途说明
  usageCount?: number;                 // 命中次数
}

// ============================================================================
// ③ 导出包：打包前两者
// ============================================================================

export interface UserAssetBundle {
  schemaVersion: string;               // 如 "user-asset-1"
  exportedAt: string;                  // ISO 8601
  appVersion: string;                  // 取自现有 version
  templates: TaskTemplate[];
  commands: CustomNLCommand[];
  notes?: string;
}

// ============================================================================
// 辅助函数（为 E.2-E.7 后续任务提供基础能力）
// ============================================================================

/**
 * 生成简易 UUID（crypto.randomUUID 不可用时回退）
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 回退方案：时间戳 + 随机数
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 从 OperationPlan 的 steps[].params 中扫描 {{xxx}} 占位符并提取为 Placeholder 数组
 * 用于 E.3 "存为模板" 时自动提取占位符
 */
export function extractPlaceholders(plan: OperationPlan): Placeholder[] {
  const placeholderMap = new Map<string, Placeholder>();
  const pattern = /\{\{(\w+)\}\}/g;

  for (const step of plan.steps) {
    if (!step.params) continue;
    for (const value of Object.values(step.params)) {
      if (typeof value !== "string") continue;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) {
        const key = match[1];
        if (!placeholderMap.has(key)) {
          placeholderMap.set(key, {
            key,
            label: key,
            defaultValue: "",
          });
        }
      }
    }
  }

  return Array.from(placeholderMap.values());
}

/**
 * 校验占位符值（为 E.7 安全白名单校验和 E.3 模板重放提供基础）
 * 返回 null 表示通过，返回字符串表示错误信息
 */
export function validatePlaceholderValue(
  placeholder: Placeholder,
  value: string
): string | null {
  if (!placeholder.validate) return null;

  switch (placeholder.validate) {
    case "number":
      if (isNaN(Number(value))) {
        return `${placeholder.label} 必须是数字`;
      }
      return null;
    case "integer":
      if (!/^-?\d+$/.test(value)) {
        return `${placeholder.label} 必须是整数`;
      }
      return null;
    case "guid-list":
      // GUID 格式：8-4-4-4-12 十六进制
      const guids = value.split(",").map(g => g.trim()).filter(g => g.length > 0);
      const guidPattern = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
      for (const guid of guids) {
        if (!guidPattern.test(guid)) {
          return `${placeholder.label} 包含无效 GUID: ${guid}`;
        }
      }
      return null;
    default:
      return null;
  }
}

/**
 * 将模板 plan 中的 {{xxx}} 占位符替换为用户填写的值
 * 用于 E.3/E.4 模板重放
 */
export function fillPlaceholders(
  plan: OperationPlan,
  values: Record<string, string>
): OperationPlan {
  const filledPlan: OperationPlan = {
    ...plan,
    steps: plan.steps.map(step => ({
      ...step,
      params: Object.fromEntries(
        Object.entries(step.params || {}).map(([k, v]) => {
          if (typeof v !== "string") return [k, v];
          let filled = v;
          for (const [key, value] of Object.entries(values)) {
            filled = filled.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
          }
          return [k, filled];
        })
      ),
    })),
  };
  return filledPlan;
}

/**
 * 匹配自定义 NL 命令（为 E.5 提供基础）
 * 返回第一个命中的命令，未命中返回 null
 * 匹配规则：任一 trigger 是输入文本的子串即命中
 */
export function matchCustomCommand(
  text: string,
  commands: CustomNLCommand[]
): CustomNLCommand | null {
  const enabledCommands = commands
    .filter(c => c.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const cmd of enabledCommands) {
    for (const trigger of cmd.triggers) {
      if (text.includes(trigger)) {
        return cmd;
      }
    }
  }
  return null;
}

/**
 * 当前 schema 版本常量
 */
export const USER_ASSET_SCHEMA_VERSION = "user-asset-1";

/**
 * 当前应用版本（从 package.json 读取，这里硬编码避免动态 require）
 */
export const APP_VERSION = "0.1.0";

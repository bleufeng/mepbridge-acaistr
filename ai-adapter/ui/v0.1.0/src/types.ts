export interface ModelObstacle {
  x: number;
  y: number;
  r: number;
  label?: string;
  isUserAdded?: boolean;
}

export interface VerificationParameter {
  item: string;
  expected: string;
  actual: string;
  status: "ok" | "warning" | "error";
}

export interface PlanStep {
  id: string;
  title: string;
  action?: string;
  description: string;
  expectedResult: string;
  params: Record<string, unknown>;
  commandJson?: {
    command: string;
    parameters?: Record<string, unknown>;
  } | null;
  commandNamespace?: string | null;
  commandName?: string | null;
  descriptorName?: string | null;
  riskLevel?: string | null;
  status?: "pending" | "running" | "done" | "error";
}

/**
 * 回放后步骤（post-replay step）
 *
 * 为什么需要独立一层：模板步骤在**采集时**就固化了，而创建类步骤的产物 GUID 只有**回放时**才产生。
 * 于是"把本次新建构件的属性统一设成 X"这类收尾动作无法写成普通步骤：
 *   - 采集时写不出 GUID（元素还不存在）；
 *   - 写成 ${...}/{{...}} 占位符会被 plan-chain 的 Gate1 明确拒绝（防止未解析占位符发给 Archicad）。
 * 因此登记为 postReplayStep：步骤参数里**不含 GUID**，目标元素由回放器在运行时从"本次新建构件"里取。
 */
export interface PostReplayStep {
  id?: string;
  action: string;                       // 如 "EditSelectedElements"
  title: string;
  description?: string;
  params: Record<string, unknown>;      // 不含 GUID 的参数（GUID 运行时注入 elementGuids）
  riskLevel?: string | null;
  target?: {
    source: "createdGuids";             // 目标元素 = 本次回放新建的构件
    types?: string[];                   // 按元素类型限定（如 ["Beam"]）
    actions?: string[];                 // 按来源步骤 action 限定（如 ["CreateBeam"]）
  };
}

/**
 * 模板的统一构件属性（采集侧产物，如「结构功能 = 承重元素」）。
 * 旧模板只有该元数据、没有 postReplaySteps 时，由 resolvePostReplaySteps() 派生回放后步骤。
 */
export interface UnifiedStructuralProperty {
  groupName: string;
  propertyName: string;
  valueString: string;
  appliesTo?: string;
  appliedDuringReplay?: boolean;
  [key: string]: unknown;
}

export interface OperationPlan {
  title: string;
  warning: string | null;
  isMutation: boolean;
  mepCode: string;
  steps: PlanStep[];
  parameters: VerificationParameter[];
  /** 回放后自动执行的收尾步骤（普通步骤全部成功后执行） */
  postReplaySteps?: PostReplayStep[];
  /** 采集侧记录的统一构件属性（回放后步骤的派生来源） */
  unifiedStructuralProperty?: UnifiedStructuralProperty;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai" | "system";
  text: string;
  timestamp: string;
  isMepPlan?: boolean;
  planRef?: OperationPlan;
  // D4 增强：AI 交互详情
  aiDetail?: string;          // AI 解析/思考过程描述
  matchedDescriptor?: string; // 命中的 descriptor 名称
  isLocalMatch?: boolean;     // 是否为本地短路命中
  executionTimeMs?: number;   // 响应时间（毫秒）
  stepsSummary?: string;      // 步骤摘要（如 "ScanStructuralElements → CreatePipe"）
  reasoning?: string;         // V2: LLM CAD-CoT 思考过程（推理过程描述）
  // 模式隔离（2026-07-15）：标记消息属于哪个模式，右区按 mode 过滤显示
  mode?: "base" | "copilot";  // 未标记视为 copilot（向后兼容）
}

export interface LlmConfig {
  provider: string;
  endpoint: string;
  apiKey: string;
  modelName: string;
}

export type ConnectionStatusState = "connected" | "disconnected" | "connecting";
export type ConfirmationGranularityType = "overall" | "smart" | "step-by-step";
export type UiLanguageType = "zh-CN" | "en-US";

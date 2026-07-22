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

export interface OperationPlan {
  title: string;
  warning: string | null;
  isMutation: boolean;
  mepCode: string;
  steps: PlanStep[];
  parameters: VerificationParameter[];
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

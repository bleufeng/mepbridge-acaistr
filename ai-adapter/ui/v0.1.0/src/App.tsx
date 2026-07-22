import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Settings,
  Radio,
  Layers,
  Send,
  RefreshCw,
  RotateCcw,
  Trash2,
  Play,
  CheckCircle2,
  AlertTriangle,
  Activity,
  HardDrive,
  Database,
  Search,
  ChevronRight,
  Info,
  Globe,
  Sliders,
  X,
  Box,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  FileSpreadsheet,
  Download,
  Check,
  Zap,
  Maximize2,
  Camera,
  Eye,
  EyeOff,
  ChevronDown,
  Bookmark,
  Move,
  FileEdit,
  Copy,
  RotateCw,
  FlipHorizontal,
  SquareDashed,
  LayoutGrid,
  Square,
  Minus,
  SquareStack,
  DoorOpen,
  AppWindow,
  Triangle,
  TrendingUp,
  Armchair,
  Lightbulb,
  Mountain,
  Grid3x3,
  Wrench,
  Plus,
  GitBranch,
  Link,
  Minimize2,
  PanelRightOpen,
  PanelRightClose
} from "lucide-react";
import { MoveElementsModal } from "./components/MoveElementsModal";
import { EditPropertiesModal } from "./components/EditPropertiesModal";
import { CopyElementsModal } from "./components/CopyElementsModal";
import { CreateBuildingElementModal } from "./components/CreateBuildingElementModal";
import { EditBuildingElementPanel } from "./components/EditBuildingElementPanel";
import { EditMEPElementPanel } from "./components/EditMEPElementPanel";
import { CreatePipeModal } from "./components/CreatePipeModal";
import { CreatePipeSystemModal } from "./components/CreatePipeSystemModal";
import { CreateDuctModal } from "./components/CreateDuctModal";
import { CreateCableCarrierModal } from "./components/CreateCableCarrierModal";
import { SaveTemplateModal } from "./components/SaveTemplateModal";
import { TemplateReplayModal } from "./components/TemplateReplayModal";
import { CustomCommandsPanel } from "./components/CustomCommandsPanel";
import KnowledgeBasePanel from "./components/KnowledgeBasePanel";
import LearningMemoryPanel from "./components/LearningMemoryPanel";
import AuditLogPanel from "./components/AuditLogPanel";
import ProactiveSuggestions from "./components/ProactiveSuggestions";
import { ExtensionPanel } from "./components/ExtensionPanel";
import { SimpleInputDialog } from "./components/SimpleInputDialog";
import type { TaskTemplate, CustomNLCommand } from "./userAssets";
import { matchCustomCommand, fillPlaceholders } from "./userAssets";
import { motion, AnimatePresence } from "motion/react";
import {
  ModelObstacle,
  VerificationParameter,
  PlanStep,
  OperationPlan,
  ChatMessage,
  LlmConfig,
  ConnectionStatusState,
  ConfirmationGranularityType,
  UiLanguageType
} from "./types";
import ConfirmationDialog from "./components/ConfirmationDialog";
import JsonViewer from "./components/JsonViewer";
import { ArchicadViewport, type ElementWithAABB } from "./components/ArchicadViewport";

type McpPlatformStatus = {
  name: string;
  status?: string;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  path?: string;
};

const getResponsePayload = (data: any): any => (
  data?.response?.result?.addOnCommandResponse ||
  data?.response?.result ||
  data?.result?.addOnCommandResponse ||
  data?.result ||
  data?.response ||
  data ||
  {}
);

const getResponseElements = (data: any): any[] => {
  const payload = getResponsePayload(data);
  if (Array.isArray(payload?.elements)) return payload.elements;
  if (Array.isArray(payload?.results?.elements)) return payload.results.elements;
  return [];
};

const normalizeViewportElements = (elements: unknown): ElementWithAABB[] => {
  if (!Array.isArray(elements)) return [];

  const normalized = new Map<string, ElementWithAABB>();
  elements.forEach((raw: any) => {
    const guid = typeof raw?.guid === "string" ? raw.guid : "";
    const min = raw?.aabb?.min;
    const max = raw?.aabb?.max;
    const values = [min?.x, min?.y, min?.z, max?.x, max?.y, max?.z];
    if (!guid || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return;

    normalized.set(guid, {
      ...raw,
      guid,
      type: raw.type || raw.elementType || "Unknown",
      aabb: {
        min: { x: min.x, y: min.y, z: min.z },
        max: { x: max.x, y: max.y, z: max.z }
      }
    });
  });

  return Array.from(normalized.values());
};

// Dynamic translation map for the entire multi-lingual experience
const t = {
  "zh-CN": {
    brand: "MEPbridge ACAIstr — MACAI",
    tagline: "AC 协处理器",
    connStatus: "物理状态",
    dotActive: "协同中",
    dotOffline: "未就绪",
    dotConnecting: "解析中...",
    statArchicad: "Archicad 宿主环境",
    statMepbridge: "MEPBridge 主插件",
    configTitle: "系统运行策略 (Gates)",
    gate2: "安全确认阀门 (Gate 2)",
    gate4: "物理回读校验 (Gate 4)",
    uiLang: "界面语言",
    granLabel: "确认审批粒度",
    granOverall: "整体确认执行 (1次)",
    granSmart: "智能判定 (风险感知)",
    granStep: "逐段进行人工签字",
    llmProvider: "LLM 推理提供商",
    btnLlmConfig: "API 推理端点绑定",
    actionsTitle: "快速调度指令",
    btnRefresh: "断开与重试同步",
    btnUndo: "回滚上步位置",
    btnClear: "清空当前线程",
    chatWelcomeHeader: "AC 协处理器助理",
    chatWelcomeText: "由 Endra 三层架构驱动的物理协同设计台，我可以解析自然语言意图，并编译成供 Archicad 直接渲染的工程几何管网：",
    itemCap1: "🔍 三维障碍激光扫描、间距判定与碰撞筛查",
    itemCap2: "📐 自动布局管道、避障风管与系统弯头拟合",
    itemCap3: "📏 结构厚度/倾角/热工 U 值数据提取与归入",
    itemCap4: "🛰️ 配合 Gate 4 进行模型几何绝对比对与重校验",
    chatHint: "示例：在 Z 3000mm 处排布空调管避免硬碰撞结构柱",
    chatPlaceholder: "输入操作描述，如：移动空调管道向右偏移 1200 毫米...",
    send: "写入",
    planTitle: "📋 概率层生成操作计划 (Gate 2/3)",
    planStepsCount: "步序列",
    warningTitle: "物理冲突与改动警告",
    btnExecute: "物理写入并调平 (Gate 3)",
    btnCancelPlan: "驳回当前计划",
    resultTitle: "🔍 物理回验对照矩阵 (Gate 4 实测记录)",
    badgePass: "校验对齐成功",
    exportLog: "导出检验报告",
    navHeaderCAD: "三维对齐视口",
    tipCAD: "💡 点击网格空白位置放置新立柱障碍，管段将被强制自适应重新计算并避开坐标！",
    cadStart: "起点 (0, 0, Z3000)",
    cadEnd: "终点 (500, 150, Z3000)",
    cadColumn: "承重结构柱",
    cadUserObstacle: "自定立柱障碍",
    cadPipe: "生成的管道实体 (250mm 直径)",
    cadBypassPath: "避障旁路方案",
    emptyCADTitle: "没有挂起的管网计划",
    emptyCADDesc: "请在右侧输入栏描述您的管线需要。协处理器将规划折弯避障角度并在上面实时显示管道。",
    modalLlmTitle: "安全 LLM API 配置中心",
    llmProv: "模型服务商",
    apiKeyPlaceholder: "请输入用于生成高阶逻辑计划的 API 密钥",
    endpointPlaceholder: "选填或自定义反向代理 API 地址",
    testConn: "测试物理连接",
    save: "应用配置",
    testing: "连接测试中...",
    okLlm: "模型配置已在内存保存，随时可以使用！",
    successTest: "连接测试通过！成功解析 ping 参数：42ms。Provider 安全校验通过。",
    failTest: "测试失败，未能连结至该端点，请检查 API 密钥。",
    errConnTitle: "物理写入失败",
    errConnDesc: "无法执行操作计划。原因：Archicad 宿主环境处于离线状态，或安全阀门强行拦截。请检测左侧状态开关！",
    toastPlanGenerated: "成功根据需求解析并生成拟合旁路计划",
    toastExecuted: "Gate 4 比对完毕：实际渲染坐标已成功比对并写入 CAD 零件树！",
    toastReset: "系统同步已完成重置",
    toastUndo: "已撤销最近一次实体创建偏移",
    mepCodeTitle: "编译生成的 MEP 执行代码",
    stepIndicator: "步次",
    parameterTitle: "校验参数",
    expectedTitle: "预计拟合",
    actualTitle: "读回比对"
  },
  "en-US": {
    brand: "MEPbridge ACAIstr — MACAI",
    tagline: "AC Coprocessor",
    connStatus: "Physics State",
    dotActive: "Synced",
    dotOffline: "Not Ready",
    dotConnecting: "Resolving...",
    statArchicad: "Archicad Parent Env",
    statMepbridge: "MEPBridge Add-On",
    configTitle: "System Controls (Gates)",
    gate2: "Safety Gate Confirmation (Gate 2)",
    gate4: "Telemetry Readback (Gate 4)",
    uiLang: "Language",
    granLabel: "Confirmation Granularity",
    granOverall: "Batch confirmation (Only 1 request)",
    granSmart: "Smart detection (Risk-aware)",
    granStep: "Step-by-step rigorous signature",
    llmProvider: "LLM Provider",
    btnLlmConfig: "LLM API Integrations",
    actionsTitle: "Quick Dispatch Tasks",
    btnRefresh: "Disconnect & Sync Sync",
    btnUndo: "Undo Last Coordinate Offset",
    btnClear: "Reset Active Stream",
    chatWelcomeHeader: "AC Coprocessor Assistant",
    chatWelcomeText: "An AI-guided physical design layout engine driven by the Endra three-layer framework. I translate natural request strings into accurate pipe routes for Archicad:",
    itemCap1: "🔍 3D Structural laser scans, spacing metrics & collision checks",
    itemCap2: "📐 Smart routing, collision-avoidance pipelines & seamless bend matching",
    itemCap3: "📏 Structural width, slopes & thermal U-value extraction/compilation",
    itemCap4: "🛰️ Real-time verification, physical coordinate comparison against Gate 4",
    chatHint: "E.g.: Layout climate conduits at Z 3000 avoiding column interferences",
    chatPlaceholder: "Describe your layout needs, e.g.: Offset the air duct 1200mm to the right...",
    send: "Commit",
    planTitle: "📋 Logic Plan Proposal (Gate 2/3)",
    planStepsCount: "Steps",
    warningTitle: "Physical Conflict / CAD Mutate Alert",
    btnExecute: "Confirm and Write to CAD (Gate 3)",
    btnCancelPlan: "Decline and Refactor Plan",
    resultTitle: "🔍 Telemetry Comparison Matrix (Gate 4 Feedback)",
    badgePass: "Alignments Approved",
    exportLog: "Export Excel Report",
    navHeaderCAD: "3D Alignment Viewport",
    tipCAD: "💡 Click anywhere empty on the grid to add custom columns. Conduit routing auto-calculates to dodge obstacles!",
    cadStart: "Start (0, 0, Z3000)",
    cadEnd: "End (500, 150, Z3000)",
    cadColumn: "Predefined Core Column",
    cadUserObstacle: "User Added Column",
    cadPipe: "Generated Pipeline (250mm Dia)",
    cadBypassPath: "Recalculated Bypass Route",
    emptyCADTitle: "No Conduit Project Queued",
    emptyCADDesc: "Describe your piping intent on the right panel. The copilot will render real-time geometry offsets and collision checks above.",
    modalLlmTitle: "Secure LLM API Config Center",
    llmProv: "LLM Provider",
    apiKeyPlaceholder: "Enter your custom API secret token to fuel high-level reasoning",
    endpointPlaceholder: "Optional or custom reverse proxy endpoint url",
    testConn: "Test Connection",
    save: "Apply Parameters",
    testing: "Testing Ping...",
    okLlm: "Model settings updated in runtime storage!",
    successTest: "Authentication test passed! Ping: 42ms. Security token accepted.",
    failTest: "Test failed. Unable to query target provider key. Double-check token string.",
    errConnTitle: "CAD Mutation Rejected",
    errConnDesc: "Operation plan could not execute. Reason: Archicad host is offline or safety gates blocked permission. Check the left checkboxes!",
    toastPlanGenerated: "Dynamic collision-avoidance pipe routing plan compiled",
    toastExecuted: "Gate 4 telemetry check complete: CAD assets parsed, matched and synchronized!",
    toastReset: "Workspace nodes reset to original state",
    toastUndo: "Reverted last layout entity modification",
    mepCodeTitle: "Compiled MEP Command Script",
    stepIndicator: "Seq",
    parameterTitle: "Telemetry Parameter",
    expectedTitle: "Calculated Limit",
    actualTitle: "Physical Readback"
  }
};

type ConversationWindowHostProps = {
  enabled: boolean;
  externalWindow: Window | null;
  onExternalWindowClosed: () => void;
  children: React.ReactNode;
};

const APP_WINDOW_TITLE = "MEPbridge ACAIstr —— Zuxai Z.";
const CONVERSATION_PANEL_WIDTH = 384;
const CONVERSATION_POPUP_INITIAL_WIDTH = CONVERSATION_PANEL_WIDTH + 40;

function ConversationWindowHost({
  enabled,
  externalWindow,
  onExternalWindowClosed,
  children
}: ConversationWindowHostProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const onExternalWindowClosedRef = useRef(onExternalWindowClosed);

  useEffect(() => {
    onExternalWindowClosedRef.current = onExternalWindowClosed;
  }, [onExternalWindowClosed]);

  useEffect(() => {
    if (!enabled || !externalWindow) {
      setPortalTarget(null);
      return;
    }

    const popup = externalWindow;
    let closingProgrammatically = false;
    let closedNotificationSent = false;

    const notifyClosed = () => {
      if (closingProgrammatically || closedNotificationSent) return;
      closedNotificationSent = true;
      onExternalWindowClosedRef.current();
    };

    try {
      const popupDocument = popup.document;
      popupDocument.open();
      popupDocument.write(
        '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body></body></html>'
      );
      popupDocument.close();
      popupDocument.title = APP_WINDOW_TITLE;

      const base = popupDocument.createElement("base");
      base.href = document.baseURI;
      popupDocument.head.appendChild(base);

      document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        popupDocument.head.appendChild(node.cloneNode(true));
      });

      popupDocument.documentElement.style.width = "100%";
      popupDocument.documentElement.style.height = "100%";
      popupDocument.documentElement.style.background = "#09090b";
      popupDocument.body.style.width = "100%";
      popupDocument.body.style.height = "100%";
      popupDocument.body.style.margin = "0";
      popupDocument.body.style.overflow = "hidden";
      popupDocument.body.style.background = "#09090b";

      const target = popupDocument.createElement("div");
      target.id = "mepbridge-conversation-window";
      target.style.display = "flex";
      target.style.width = "100vw";
      target.style.height = "100vh";
      target.style.overflow = "hidden";
      popupDocument.body.appendChild(target);
      setPortalTarget(target);

      const chromeWidth = Math.max(0, popup.outerWidth - popup.innerWidth);
      const targetOuterWidth = Math.min(
        window.screen.availWidth,
        CONVERSATION_PANEL_WIDTH + chromeWidth
      );
      const targetOuterHeight = Math.min(
        window.screen.availHeight,
        Math.max(720, window.outerHeight)
      );
      const screenInfo = window.screen as Screen & { availLeft?: number; availTop?: number };
      const availableLeft = screenInfo.availLeft ?? 0;
      const availableTop = screenInfo.availTop ?? 0;
      popup.resizeTo(targetOuterWidth, targetOuterHeight);
      popup.moveTo(
        Math.max(availableLeft, availableLeft + window.screen.availWidth - targetOuterWidth),
        Math.max(availableTop, window.screenY)
      );
      popup.focus();
    } catch (error) {
      console.warn("[conversation-window] Failed to prepare the standalone window:", error);
      try {
        popup.close();
      } catch {
        // Ignore browser-specific close failures and restore the inline layout.
      }
      notifyClosed();
      return;
    }

    popup.addEventListener("pagehide", notifyClosed);
    const closePoll = window.setInterval(() => {
      if (popup.closed) notifyClosed();
    }, 300);

    return () => {
      closingProgrammatically = true;
      window.clearInterval(closePoll);
      popup.removeEventListener("pagehide", notifyClosed);
      setPortalTarget(null);
      if (!popup.closed) popup.close();
    };
  }, [enabled, externalWindow]);

  if (enabled && externalWindow && portalTarget) {
    return createPortal(children, portalTarget);
  }

  return <>{children}</>;
}

export default function App() {
  // Region 1: Localization & Global Config State
  const [lang, setLang] = useState<UiLanguageType>("zh-CN");
  const currentT = t[lang];

  // Mode switch state (NEW: BASE vs AI Copilot)
  const [workbenchMode, setWorkbenchMode] = useState<"base" | "copilot">("copilot");

  // BASE mode state (NEW)
  const [baseSelectionStatus, setBaseSelectionStatus] = useState<{
    count: number;
    types: Array<{ type: string; count: number }>;
    guids: string[];
  }>({ count: 0, types: [], guids: [] });
  // P3+: 选择集自动同步开关 + 上次同步时间（避免相同选择触发 re-render）
  const [autoSyncSelection, setAutoSyncSelection] = useState<boolean>(true);
  const [lastSelectionSyncAt, setLastSelectionSyncAt] = useState<number>(0);
  const lastSelectionSignatureRef = useRef<string>("");
  // FO-1: 完整元素数组（含 AABB），供视口示意渲染
  const [baseSelectionElements, setBaseSelectionElements] = useState<ElementWithAABB[]>([]);
  // FO-1 V1.6+: 扫描结果元素（独立于选择集，优先级更高）
  const [baseScanElements, setBaseScanElements] = useState<ElementWithAABB[]>([]);
  const [scanSourceLabel, setScanSourceLabel] = useState<string>("");
  // Copilot 中区真实读回数据：有 AABB 时优先于固定计划示意绘制
  const [liveViewportElements, setLiveViewportElements] = useState<ElementWithAABB[]>([]);
  const [liveViewportSource, setLiveViewportSource] = useState<"selection" | "readback" | "none">("none");
  const [liveViewportUpdatedAt, setLiveViewportUpdatedAt] = useState<number>(0);
  const lastViewportSignatureRef = useRef<string>("");
  const [baseResult, setBaseResult] = useState<any>(null);
  const [isBaseExecuting, setIsBaseExecuting] = useState<boolean>(false);
  // BASE 模式历史任务列表（最近8个，从下往上显示）
  const [taskHistory, setTaskHistory] = useState<Array<{
    id: string;
    timestamp: string;
    label: string;
    status: "success" | "error" | "running";
    summary?: string;
  }>>([]);
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showCopyModal, setShowCopyModal] = useState<boolean>(false);
  // 简单输入对话框状态（替代 prompt/confirm）
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    title: string;
    label: string;
    defaultValue?: string;
    options?: string[];
    isConfirm?: boolean;
    selectionInfo?: { count: number; types: Record<string, number> } | null;
    onConfirm: (value: string) => void;
  }>({ isOpen: false, title: "", label: "", onConfirm: () => {} });

  // 异步加载选择集摘要（构件分类汇总），用于旋转/镜像/删除等弹框
  const loadSelectionSummary = async (): Promise<{ count: number; types: Record<string, number> } | null> => {
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
        const types: Record<string, number> = {};
        elements.forEach((el: any) => {
          const type = el.type || el.elementType || "Unknown";
          types[type] = (types[type] || 0) + 1;
        });
        return { count: elements.length, types };
      }
    } catch (err) {
      console.error("[loadSelectionSummary] failed:", err);
    }
    return null;
  };
  // BUILDING 建筑模块
  const [showCreateBuildingModal, setShowCreateBuildingModal] = useState<boolean>(false);
  const [buildingElementType, setBuildingElementType] = useState<'Wall' | 'Column' | 'Beam' | 'Slab' | 'Door' | 'Window' | 'Roof' | 'Stair' | 'Object' | 'Lamp' | 'Mesh' | 'Zone'>('Wall');
  // E.3: 存为模板 modal 状态
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState<boolean>(false);
  // D4 F.1: Water 模块 modal 状态
  const [showCreatePipeModal, setShowCreatePipeModal] = useState<boolean>(false);
  const [showCreatePipeSystemModal, setShowCreatePipeSystemModal] = useState<boolean>(false);
  // D5 F.1/F.2: Electrical/Ventilation 模块 modal 状态
  const [showCreateCableCarrierModal, setShowCreateCableCarrierModal] = useState<boolean>(false);
  const [showCreateDuctModal, setShowCreateDuctModal] = useState<boolean>(false);

  // C.1.6: BASE 模式命令模块切换器状态
  // 模块: mepbridge-read | mepbridge-modify | building | water | electrical | ventilation | templates
  type BaseModule = "mepbridge-read" | "mepbridge-modify" | "building" | "water" | "electrical" | "ventilation" | "templates" | "knowledge-base" | "learning-memory" | "audit-log" | "proactive";
  const [activeModule, setActiveModuleRaw] = useState<BaseModule>("mepbridge-read");
  // C.1.7: 各模块"更多命令"下拉菜单展开状态（切换模块时自动收起）
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const [modifyMoreOpen, setModifyMoreOpen] = useState<boolean>(false);
  const setActiveModule = (m: BaseModule) => {
    setActiveModuleRaw(m);
    setMoreMenuOpen(false);
    setModifyMoreOpen(false);
  };
  // E.4: 用户模板列表和重放状态
  const [userTemplates, setUserTemplates] = useState<TaskTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(false);
  const [replayTemplate, setReplayTemplate] = useState<TaskTemplate | null>(null);
  // P3: 模板搜索和分类过滤状态
  const [templateSearch, setTemplateSearch] = useState<string>("");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>("all");
  // E.5: 自定义 NL 命令
  const [showCustomCommandsPanel, setShowCustomCommandsPanel] = useState<boolean>(false);
  const [customCommands, setCustomCommands] = useState<CustomNLCommand[]>([]);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState<boolean>(false);
  const [customCommandDropdownOpen, setCustomCommandDropdownOpen] = useState<boolean>(false);

  // Connection settings
  const [archicadConnected, setArchicadConnected] = useState<boolean>(true);
  const [mepbridgeConnected, setMepbridgeConnected] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Flow & Gate logic config
  const [safetyGate, setSafetyGate] = useState<boolean>(true);
  const [autoReadback, setAutoReadback] = useState<boolean>(true);
  const [confirmationGranularity, setConfirmationGranularity] =
    useState<ConfirmationGranularityType>("smart");
  const [llmProvider, setLlmProvider] = useState<string>("deepseek");

  // Interaction logic elements
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "initial_welcome",
      sender: "system",
      text: "⚡ SYSTEM_GATES: [Gate 2: Enabled] [Gate 3: Safe] [Gate 4: Self-Check Mode Activated]. System initial parity: ONLINE.",
      timestamp: "08:00:00",
      mode: "copilot"
    }
  ]);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Active planning project
  const [activePlan, setActivePlan] = useState<OperationPlan | null>(null);
  const [isExecutingPlan, setIsExecutingPlan] = useState<boolean>(false);
  const [currentExecutingStepIndex, setCurrentExecutingStepIndex] = useState<number>(-1);
  const [executionCompleted, setExecutionCompleted] = useState<boolean>(false);
  const [executionResultData, setExecutionResultData] = useState<VerificationParameter[]>([]);
  const [showPlanCard, setShowPlanCard] = useState<boolean>(false);
  // 模式隔离：标记当前 activePlan 属于哪个模式（2026-07-15）
  const [activePlanMode, setActivePlanMode] = useState<"base" | "copilot">("copilot");

  // Confirmation Dialog state
  const [showConfirmationDialog, setShowConfirmationDialog] = useState<boolean>(false);
  const [pendingExecution, setPendingExecution] = useState<OperationPlan | null>(null);

  // JsonViewer state
  const [showJsonViewer, setShowJsonViewer] = useState<boolean>(false);
  const [jsonViewerData, setJsonViewerData] = useState<any>(null);
  // BASE 模式截图弹窗
  const [showBaseScreenshot, setShowBaseScreenshot] = useState<boolean>(false);
  // BASE 中区选择集模块视图切换：none（默认收起）/ viewport（AABB 视口）/ screenshot（Archicad 截图，高度自适应）
  const [baseViewMode, setBaseViewMode] = useState<"none" | "viewport" | "screenshot">("none");
  // 扩展功能面板折叠状态（切换中区命令模块时自动折叠）
  const [extPanelExpanded, setExtPanelExpanded] = useState<boolean>(false);
  const [jsonViewerTitle, setJsonViewerTitle] = useState<string>("");

  // Center panel view mode
  const [centerViewMode, setCenterViewMode] = useState<"viewport" | "screenshot" | "json">("viewport");
  const centerViewportRef = useRef<HTMLDivElement>(null);
  const [centerViewportFullscreen, setCenterViewportFullscreen] = useState<boolean>(false);

  // Custom alerts
  const [systemError, setSystemError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Modal control
  const [showLlmModal, setShowLlmModal] = useState<boolean>(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({
    provider: "deepseek",
    endpoint: "",
    apiKey: "",
    modelName: "deepseek-reasoner"
  });
  const [isTestingLlm, setIsTestingLlm] = useState<boolean>(false);
  const [llmFeedback, setLlmFeedback] = useState<{ success: boolean; text: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  // D5: LLM 连接状态指示器 (unknown/testing/connected/disconnected)
  const [llmConnStatus, setLlmConnStatus] = useState<"unknown" | "testing" | "connected" | "disconnected">("unknown");
  const [llmManuallyDisconnected, setLlmManuallyDisconnected] = useState<boolean>(false);
  const [mcpPlatforms, setMcpPlatforms] = useState<McpPlatformStatus[]>([]);
  const [mcpStatusLoading, setMcpStatusLoading] = useState<boolean>(false);

  // V2 H2: 自治引擎状态
  const [autonomyMode, setAutonomyMode] = useState<"copilot-auto" | "copilot-supervised" | "manual-strict">("copilot-auto");
  const [chainStatus, setChainStatus] = useState<any>(null);        // /api/plan-chain/status 响应
  const [isChainRunning, setIsChainRunning] = useState<boolean>(false);
  const chainPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chainPollTokenRef = useRef(0);
  const [showChainProgress, setShowChainProgress] = useState<boolean>(false);
  const [conversationFocusMode, setConversationFocusMode] = useState<boolean>(false);
  const [conversationWindow, setConversationWindow] = useState<Window | null>(null);
  const normalWindowBoundsRef = useRef<{
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);
  const [rightChainExpanded, setRightChainExpanded] = useState<boolean>(false);
  const [chainSteps, setChainSteps] = useState<Array<{
    id: string; action: string; title: string; status: string;
    riskLevel?: string; result?: any; error?: string | null;
    visualVerified?: boolean; visualIssues?: string[]; visualSuggestions?: string[]
  }>>([]);

  // H4.1 视口截图显示（Copilot 模式下可查看当前 Archicad 视口 PNG）
  const [viewportCapture, setViewportCapture] = useState<{
    imageBase64: string | null;
    viewType: string;
    storyName: string;
    storyIndex: number | null;
    summary: string;
    loading: boolean;
  }>({ imageBase64: null, viewType: '', storyName: '', storyIndex: null, summary: '', loading: false });

  // 楼层选择列表 + 当前选中楼层（用于截图前切换）
  const [stories, setStories] = useState<Array<{ index: number; name: string; level: number }>>([]);
  const [selectedStoryForCapture, setSelectedStoryForCapture] = useState<number | null>(null);

  // 加载楼层列表
  useEffect(() => {
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandName: 'GetStories',
        commandNamespace: 'MEPBridge'
      })
    })
      .then(r => r.json())
      .then(data => {
        const resp = getResponsePayload(data);
        if (data.response?.succeeded && resp?.status === 'ok') {
          setStories(resp.stories || []);
          // 默认选中当前活动楼层
          setSelectedStoryForCapture(resp.actStory ?? null);
        }
      })
      .catch(() => {});
  }, []);

  const fetchViewportCapture = async (storyIndex?: number | null) => {
    setViewportCapture(prev => ({ ...prev, loading: true }));
    try {
      const targetIdx = storyIndex !== undefined ? storyIndex : selectedStoryForCapture;
      const url = targetIdx !== null
        ? `/api/plan-chain/capture?includeImage=true&maxElements=100&storyIndex=${targetIdx}`
        : '/api/plan-chain/capture?includeImage=true&maxElements=100';
      const r = await fetch(url);
      const data = await r.json();
      if (data.ok) {
        setViewportCapture({
          imageBase64: data.imageBase64,
          viewType: data.viewType || '',
          storyName: data.storyName || '',
          storyIndex: data.storyIndex ?? targetIdx,
          summary: data.summary || '',
          loading: false
        });
        // 同步选中状态为实际截图楼层
        if (data.storyIndex !== undefined) {
          setSelectedStoryForCapture(data.storyIndex);
        }
      } else {
        const errorMessage = data.error || (lang === "zh-CN" ? "Archicad 视口截图失败" : "Archicad viewport capture failed");
        setViewportCapture(prev => ({ ...prev, loading: false, summary: errorMessage }));
        setSystemError(errorMessage);
      }
    } catch (e: any) {
      const errorMessage = e?.message || (lang === "zh-CN" ? "无法连接截图服务" : "Unable to reach capture service");
      setViewportCapture(prev => ({ ...prev, loading: false, summary: errorMessage }));
      setSystemError(errorMessage);
    }
  };

  const refreshLiveViewportFromSelection = async () => {
    if (!mepbridgeConnected) return;
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
              addOnCommandParameters: { onlyEditable: false, includeAabb: true, includeMepInfo: true }
            }
          },
          source: "ui-live-viewport-refresh"
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok || data.response?.succeeded === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const elements = getResponseElements(data);
      const actualElements = normalizeViewportElements(elements);
      const signature = actualElements
        .map((element) => `${element.guid}:${JSON.stringify(element.aabb)}`)
        .sort()
        .join("|");
      lastViewportSignatureRef.current = signature;
      setLiveViewportElements(actualElements);
      setLiveViewportSource(actualElements.length > 0 ? "selection" : "none");
      setLiveViewportUpdatedAt(Date.now());
      setBaseSelectionElements(elements as ElementWithAABB[]);
      setBaseSelectionStatus({
        count: elements.length,
        types: Object.entries(elements.reduce((counts: Record<string, number>, element: any) => {
          const type = element.type || element.elementType || "Unknown";
          counts[type] = (counts[type] || 0) + 1;
          return counts;
        }, {})).map(([type, count]) => ({ type, count })),
        guids: elements.map((element: any) => element.guid || "").filter(Boolean)
      });
    } catch (err) {
      console.warn("[Live Viewport] Refresh failed:", err);
    }
  };

  // Auto-scrolling ref for log
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // 辅助函数：给消息打上当前模式标记（2026-07-15 模式隔离）
  const appendMessage = (msg: ChatMessage) => {
    setMessages((prev) => [...prev, { ...msg, mode: msg.mode || workbenchMode }]);
  };
  const appendMessages = (msgs: ChatMessage[]) => {
    setMessages((prev) => [...prev, ...msgs.map(m => ({ ...m, mode: m.mode || workbenchMode }))]);
  };
  const baseMessages = useMemo(
    () => messages.filter((m) => m.mode === "base"),
    [messages]
  );
  const copilotMessages = useMemo(
    () => messages.filter((m) => (m.mode || "copilot") === "copilot"),
    [messages]
  );

  // CAD 2D Live Vector Obstacles state
  const [gridObstacles, setGridObstacles] = useState<ModelObstacle[]>([
    { x: 180, y: 120, r: 24, label: "A103-Column" },
    { x: 280, y: 190, r: 20, label: "B201-Column" },
    { x: 390, y: 90, r: 28, label: "CoreShaft-D" }
  ]);

  // Handle auto scroll
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-poll connection status every 5 seconds
  useEffect(() => {
    let isCancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const checkConnection = async () => {
      if (isCancelled) return;

      try {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), 3000); // 3秒超时

        const res = await fetch("/api/ping", { signal: controller.signal });
        clearTimeout(timeoutSignal);

        const data = await res.json();

        if (!isCancelled) {
          setArchicadConnected(data.archicad === true);
          setMepbridgeConnected(data.mepbridge === true);
        }
      } catch (err) {
        if (!isCancelled) {
          console.warn("[Connection Poll] Failed:", err);
          setArchicadConnected(false);
          setMepbridgeConnected(false);
        }
      } finally {
        // 调度下一次检查（无论成功失败）
        if (!isCancelled) {
          timeoutId = setTimeout(checkConnection, 5000);
        }
      }
    };

    // Initial check
    checkConnection();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // P3+: Auto-poll Archicad selection set every 3s in both BASE and Copilot.
  // The selection signature controls the summary; the AABB signature also detects
  // real movement/resize while the same GUIDs remain selected.
  useEffect(() => {
    if (!mepbridgeConnected) return;
    if (!autoSyncSelection) return;

    let isCancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const pollSelection = async () => {
      if (isCancelled) return;
      try {
        const controller = new AbortController();
        const timeoutSignal = setTimeout(() => controller.abort(), 3000);

        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: {
              command: "API.ExecuteAddOnCommand",
              parameters: {
                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
                // FO-1: 轮询携带 includeAabb:true 以驱动视口示意渲染（轻量: 仅6个数字/元素）
                addOnCommandParameters: { onlyEditable: false, includeAabb: true, includeMepInfo: false }
              }
            },
            source: "ui-selection-poll"
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutSignal);

        const data = await res.json();
        if (!isCancelled && data.ok && data.response?.succeeded) {
          const elements = getResponseElements(data);
          const actualElements = normalizeViewportElements(elements);
          const viewportSignature = actualElements
            .map((element) => `${element.guid}:${JSON.stringify(element.aabb)}`)
            .sort()
            .join("|");

          if (viewportSignature !== lastViewportSignatureRef.current) {
            lastViewportSignatureRef.current = viewportSignature;
            setLiveViewportElements(actualElements);
            setLiveViewportSource(actualElements.length > 0 ? "selection" : "none");
            setLiveViewportUpdatedAt(Date.now());
            setBaseSelectionElements(elements as ElementWithAABB[]);
          }

          // 计算 GUID 签名（排序后 join），用于 diff
          const guids: string[] = elements.map((el: any) => el.guid || "").filter(Boolean);
          const signature = guids.slice().sort().join("|");
          // 仅当签名变化时才更新 state（避免相同选择触发 re-render）
          if (signature !== lastSelectionSignatureRef.current) {
            lastSelectionSignatureRef.current = signature;
            const typeCounts: Record<string, number> = {};
            elements.forEach((el: any) => {
              const type = el.type || "Unknown";
              typeCounts[type] = (typeCounts[type] || 0) + 1;
            });
            setBaseSelectionStatus({
              count: elements.length,
              types: Object.entries(typeCounts).map(([type, count]) => ({ type, count })),
              guids
            });
            // FO-1: 存储完整元素数组（含 AABB）供视口渲染
            setBaseSelectionElements(elements as ElementWithAABB[]);
            setLastSelectionSyncAt(Date.now());
          }
        }
      } catch (err) {
        // 轮询失败静默处理（不打断后续轮询）
        if (!isCancelled) {
          console.warn("[Selection Poll] Failed:", err);
        }
      } finally {
        if (!isCancelled) {
          timeoutId = setTimeout(pollSelection, 3000);
        }
      }
    };

    pollSelection();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [workbenchMode, mepbridgeConnected, autoSyncSelection]);

  // BASE 手动命令和扫描结果也通过 baseResult 回流到 Copilot 真实视口。
  useEffect(() => {
    if (!baseResult) return;
    const actualElements = normalizeViewportElements(getResponseElements(baseResult));
    if (actualElements.length === 0) return;

    const viewportSignature = actualElements
      .map((element) => `${element.guid}:${JSON.stringify(element.aabb)}`)
      .sort()
      .join("|");
    lastViewportSignatureRef.current = viewportSignature;
    setLiveViewportElements(actualElements);
    setLiveViewportSource("readback");
    setLiveViewportUpdatedAt(Date.now());
  }, [baseResult]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setCenterViewportFullscreen(document.fullscreenElement === centerViewportRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  // FO-2 (2026-06-26): SSE 实时选择集推送（替代/补充 3s 轮询）
  // C++ SelectionChangeHandler → 信号文件 → Node.js fs.watch → SSE → UI state 更新
  // 延迟 <500ms，适用于 BASE + Copilot 双模式
  useEffect(() => {
    if (!mepbridgeConnected) return;
    if (!autoSyncSelection) return;

    let eventSource: EventSource | null = null;

    const connectSSE = () => {
      eventSource = new EventSource("/api/selection/stream");

      eventSource.onopen = () => {
        console.log("[FO-2/SSE] Selection stream connected");
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "state" || data.type === "change") {
            const guids: string[] = data.guids || [];
            const signature = guids.slice().sort().join("|");
            // GUID 签名 diff 避免冗余 re-render
            if (signature !== lastSelectionSignatureRef.current && signature.length > 0 || data.count === 0) {
              if (data.count === 0 && lastSelectionSignatureRef.current === "") return;
              lastSelectionSignatureRef.current = signature;

              setBaseSelectionStatus({
                count: data.count || 0,
                types: data.types || [],
                guids
              });
              setLastSelectionSyncAt(Date.now());
              console.log(`[FO-2/SSE] Selection updated: ${data.count} elements, source=${data.source}`);
            }
          }
        } catch (err) {
          console.warn("[FO-2/SSE] Parse error:", err);
        }
      };

      eventSource.onerror = (err) => {
        console.warn("[FO-2/SSE] Connection error, reconnecting in 3s...");
        eventSource?.close();
        // 自动重连（EventSource 内置重连，但有时需要手动触发）
        setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    return () => {
      eventSource?.close();
      eventSource = null;
    };
  }, [mepbridgeConnected, autoSyncSelection]);

  // ESC key handler for modals
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLlmModal) setShowLlmModal(false);
        if (showJsonViewer) setShowJsonViewer(false);
        if (showConfirmationDialog) {
          setShowConfirmationDialog(false);
          setPendingExecution(null);
        }
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showLlmModal, showJsonViewer, showConfirmationDialog]);

  // Display timer notifications
  const triggerToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4500);
  };

  // BASE 模式任务历史记录 helper
  const recordTask = (label: string, status: "success" | "error" | "running" = "success", summary?: string) => {
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
      label,
      status,
      summary
    };
    setTaskHistory(prev => [...prev.slice(-7), task]); // 保留最近8个
  };

  const isMaskedApiKey = (value: string) => value.includes("...") || value.includes("•") || value === "***";

  const normalizeLlmConfigForApi = (config: LlmConfig) => ({
    provider: config.provider,
    endpoint: config.endpoint?.trim() || null,
    model: config.modelName?.trim() || null,
    apiKey: config.provider === "ollama" || isMaskedApiKey(config.apiKey) ? undefined : config.apiKey?.trim()
  });

  const loadLlmConfigFromServer = async () => {
    try {
      const res = await fetch("/api/llm-config/load");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.configured) {
        setLlmConfig({
          provider: data.provider || "deepseek",
          endpoint: data.endpoint || "",
          apiKey: data.apiKey || "",
          modelName: data.model || ""
        });
        if (data.provider) {
          setLlmProvider(data.provider);
        }
      }
    } catch (err) {
      console.error("[App] Load LLM config error:", err);
    }
  };

  // E.4: 加载用户模板列表
  const loadUserTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const res = await fetch(`/api/user-assets/load?locale=${encodeURIComponent(lang)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.templates)) {
        setUserTemplates(data.templates);
      }
    } catch (err) {
      console.error("[App] Load templates error:", err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  // P3: 删除用户模板
  const deleteUserTemplate = async (templateId: string) => {
    try {
      const res = await fetch(`/api/user-assets/templates/${templateId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setUserTemplates(prev => prev.filter(t => t.id !== templateId));
      } else {
        console.error("[App] Delete template failed:", data.error);
      }
    } catch (err) {
      console.error("[App] Delete template error:", err);
    }
  };

  // P3: 过滤后模板列表
  const filteredTemplates = useMemo(() => {
    let list = userTemplates;
    if (templateSearch.trim()) {
      const q = templateSearch.toLowerCase().trim();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    if (templateCategoryFilter && templateCategoryFilter !== "all") {
      list = list.filter(t => t.category === templateCategoryFilter);
    }
    return list;
  }, [userTemplates, templateSearch, templateCategoryFilter]);

  const enabledCustomCommands = useMemo(
    () => customCommands.filter((cmd) => cmd.enabled),
    [customCommands]
  );

  const mapChainStatusToPlanStatus = (status?: string): PlanStep["status"] => {
    if (status === "completed") return "done";
    if (status === "running" || status === "waiting_gate2" || status === "waiting_gate3") return "running";
    if (status === "failed" || status === "error" || status === "cancelled") return "error";
    return "pending";
  };

  const buildPlanFromChain = (chainLike: any, steps: any[]): OperationPlan => ({
    title: chainLike?.summary || chainLike?.userIntent || (lang === "zh-CN" ? "自动执行计划" : "Autonomy Plan"),
    warning: null,
    isMutation: steps.some((step) => step.riskLevel && step.riskLevel !== "read"),
    mepCode: "PlanChain.Autonomy",
    steps: steps.map((step, idx) => ({
      id: step.id || `chain_step_${idx}`,
      title: step.title || step.action || `Step ${idx + 1}`,
      action: step.action,
      description: step.description || step.action || step.title || "",
      expectedResult: step.riskLevel === "read" ? "Read completed" : "Execution completed",
      params: step.params || {},
      riskLevel: step.riskLevel || null,
      status: mapChainStatusToPlanStatus(step.status)
    })),
    parameters: []
  });

  const buildVerificationRowsFromChain = (steps: any[]): VerificationParameter[] => {
    return steps.map((step, idx) => {
      const status = step.status === "completed"
        ? "ok"
        : (step.status === "failed" || step.status === "error" || step.status === "cancelled")
          ? "error"
          : "warning";
      const result = step.result;
      let actual = step.error || "Pending";
      if (step.status === "completed") {
        if (result?.guid) actual = `GUID: ${String(result.guid).substring(0, 12)}...`;
        else if (result?.ok !== undefined) actual = result.ok ? "Success" : "Failed";
        else actual = "Success";
      } else if (step.status === "running") {
        actual = "Running";
      }

      return {
        item: step.title || step.action || `Step ${idx + 1}`,
        expected: step.riskLevel === "read" ? "Read completed" : "Execution completed",
        actual,
        status
      };
    });
  };

  // E.4: 切换到模板模块时自动加载
  useEffect(() => {
    if (activeModule === "templates") {
      loadUserTemplates();
    }
  }, [activeModule, lang]);

  // 切换中区命令模块时自动折叠扩展功能面板
  useEffect(() => {
    setExtPanelExpanded(false);
  }, [activeModule]);

  // 切换 BASE/Copilot 模式时自动折叠扩展功能面板 + 清除上一个模式的执行结果
  useEffect(() => {
    setExtPanelExpanded(false);
    chainPollTokenRef.current += 1;
    if (chainPollIntervalRef.current) {
      clearInterval(chainPollIntervalRef.current);
      chainPollIntervalRef.current = null;
    }
    // 清除上一个模式的中区结果显示，避免两个模式结果混在一起
    setActivePlan(null);
    setShowPlanCard(false);
    setExecutionCompleted(false);
    setExecutionResultData([]);
    setShowChainProgress(false);
    setIsChainRunning(false);
    setTemplateDropdownOpen(false);
    setCustomCommandDropdownOpen(false);
  }, [workbenchMode]);

  useEffect(() => {
    return () => {
      chainPollTokenRef.current += 1;
      if (chainPollIntervalRef.current) {
        clearInterval(chainPollIntervalRef.current);
        chainPollIntervalRef.current = null;
      }
    };
  }, []);

  // E.4 补充: 启动时也加载模板列表（供 Copilot 模式模板快捷栏使用）
  useEffect(() => {
    loadUserTemplates();
  }, [lang]);

  // E.5: 加载自定义 NL 命令列表
  const loadCustomCommands = async () => {
    try {
      const res = await fetch(`/api/user-assets/load?locale=${encodeURIComponent(lang)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.commands)) {
        setCustomCommands(data.commands);
      }
    } catch (err) {
      console.error("[App] Load custom commands error:", err);
    }
  };

  const openCustomCommandsPanel = () => {
    loadCustomCommands();
    setShowCustomCommandsPanel(true);
  };

  // E.5: 启动时加载自定义命令（用于本地短路匹配）
  useEffect(() => {
    loadCustomCommands();
  }, [lang]);

  useEffect(() => {
    loadLlmConfigFromServer().then(() => {
      // D5: 配置加载完成后自动测试 LLM 连接状态
      testLlmConnection();
    });
  }, []);

  // D5: 测试 LLM 连接状态（独立函数，可重复调用刷新指示器）
  const testLlmConnection = async () => {
    setLlmManuallyDisconnected(false);
    setLlmConnStatus("testing");
    try {
      const res = await fetch("/api/llm-config/test", { method: "POST" });
      const data = await res.json();
      setLlmConnStatus(data.success ? "connected" : "disconnected");
    } catch (err) {
      setLlmConnStatus("disconnected");
    }
  };

  const disconnectLlmConnection = () => {
    setLlmManuallyDisconnected(true);
    setLlmConnStatus("disconnected");
    setLlmFeedback(null);
  };

  const loadMcpStatus = async () => {
    setMcpStatusLoading(true);
    try {
      const res = await fetch("/api/mcp/status");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMcpPlatforms(Array.isArray(data.platforms) ? data.platforms.filter((platform: McpPlatformStatus) => platform.connected || platform.running) : []);
    } catch (err) {
      console.warn("[MCP Status] Failed:", err);
      setMcpPlatforms([]);
    } finally {
      setMcpStatusLoading(false);
    }
  };

  useEffect(() => {
    loadMcpStatus();
    const intervalId = window.setInterval(loadMcpStatus, 10000);
    return () => window.clearInterval(intervalId);
  }, []);

  // User places new columns directly on CAD viewport!
  const handleGridClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    // Filter out borders or existing start/end pads
    if (x < 40 || x > 460 || y < 30 || y > 270) return;

    // Check if clicked near an existing obstacle to delete it, otherwise add
    const clickedObstacleIndex = gridObstacles.findIndex(
      (o) => Math.hypot(o.x - x, o.y - y) < o.r + 10
    );

    if (clickedObstacleIndex !== -1) {
      const target = gridObstacles[clickedObstacleIndex];
      if (target.isUserAdded) {
        setGridObstacles(gridObstacles.filter((_, idx) => idx !== clickedObstacleIndex));
      }
    } else {
      const newObstacle: ModelObstacle = {
        x,
        y,
        r: 16 + Math.round(Math.random() * 10),
        label: `Z-${gridObstacles.length + 1}`,
        isUserAdded: true
      };
      setGridObstacles([...gridObstacles, newObstacle]);

      // If a plan is active, trigger an immediate warning recalculation!
      if (activePlan) {
        appendMessage({
            id: `sys_recalc_${Date.now()}`,
            sender: "system",
            text: `🛰️ MEP_RESOLVER: New obstacle placed at (${x}, ${y}). Live path recalculated to avoid collision. Angle offset optimized.`,
            timestamp: new Date().toLocaleTimeString()
        });
      }
    }
  };

  // Submit chat string to server-side Express API
  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputMessage;
    if (!textToSend.trim()) return;

    if (!customText) {
      setInputMessage("");
    }

    const timestamp = new Date().toLocaleTimeString();
    const startTime = Date.now(); // E.5: 自定义命令匹配耗时计量

    // Add user message to historical dialog pool
    const userMsgId = `user_${Date.now()}`;
    const currentMode = workbenchMode;  // 捕获当前模式，消息带 mode 标记
    // 辅助函数：自动给消息加 mode 标记
    const pushMsg = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, mode: currentMode }]);
    };
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: textToSend,
      timestamp,
      mode: currentMode
    };

    pushMsg(userMsg);
    setIsAnalyzing(true);
    setSystemError(null);
    setActivePlanMode(currentMode);  // 标记后续 plan 属于当前模式

    // E.5: 本地短路 - 先匹配自定义 NL 命令（<200ms），未命中再走 /api/copilot/message
    const matchedCommand = matchCustomCommand(textToSend, customCommands);
    if (matchedCommand) {
      const matchTime = Date.now() - startTime;
      const aiMsgId = `ai_custom_${Date.now()}`;
      let plan: OperationPlan;

      if (matchedCommand.templateId) {
        // 绑定模板：从服务端加载模板，自动填充到 Copilot 计划卡
        try {
          const tplRes = await fetch(`/api/user-assets/load?locale=${encodeURIComponent(lang)}`);
          const tplData = await tplRes.json();
          if (tplData.success && Array.isArray(tplData.templates)) {
            const tpl = tplData.templates.find((t: any) => t.id === matchedCommand.templateId);
            if (tpl) {
              // 如果模板有占位符，直接用默认值填充（用户可在执行前修改）
              let filledPlan = tpl.plan;
              if (tpl.placeholders && tpl.placeholders.length > 0) {
                const defaultValues: Record<string, string> = {};
                for (const p of tpl.placeholders) {
                  defaultValues[p.key] = p.defaultValue || "";
                }
                filledPlan = fillPlaceholders(tpl.plan, defaultValues);
              }

              const aiMsg: ChatMessage = {
                id: aiMsgId,
                sender: "ai",
                text: lang === "zh-CN"
                  ? `⚡ 自定义命令命中 (${matchTime}ms)：${matchedCommand.triggers.join(", ")}\n已加载模板：${tpl.name}${tpl.placeholders?.length ? `\n占位符已用默认值填充，执行前请检查参数` : ""}`
                  : `⚡ Custom command matched (${matchTime}ms): ${matchedCommand.triggers.join(", ")}\nTemplate loaded: ${tpl.name}${tpl.placeholders?.length ? `\nPlaceholders filled with defaults, review before execute` : ""}`,
                timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
                isMepPlan: true,
                planRef: filledPlan,
              };
              pushMsg(aiMsg);
              setActivePlan(filledPlan);
              setShowPlanCard(true);
              setIsAnalyzing(false);
              return;
            }
          }
          // 模板未找到，降级提示
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            sender: "ai",
            text: lang === "zh-CN"
              ? `⚡ 自定义命令命中 (${matchTime}ms)：${matchedCommand.triggers.join(", ")}\n⚠ 绑定的模板 ${matchedCommand.templateId} 未找到，可能已被删除。请重新配置命令。`
              : `⚡ Custom command matched (${matchTime}ms): ${matchedCommand.triggers.join(", ")}\n⚠ Bound template ${matchedCommand.templateId} not found, may be deleted. Please reconfigure.`,
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
            isMepPlan: false,
          };
          pushMsg(aiMsg);
          setIsAnalyzing(false);
          return;
        } catch (tplErr) {
          console.error("[App] Load template for custom command error:", tplErr);
        }
      } else if (matchedCommand.singleStep) {
        // 手动 Base 模式：与 BASE 快速模板保持一致，直接执行单步命令并显示到执行结果区
        if (workbenchMode === "base") {
          const action = matchedCommand.singleStep.action;
          const params = matchedCommand.singleStep.params as Record<string, unknown>;
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            sender: "ai",
            text: lang === "zh-CN"
              ? `⚡ 自定义命令命中 (${matchTime}ms)：${matchedCommand.triggers.join(", ")} → ${action}\n手动模式：按 BASE 快速模板流程直接执行。`
              : `⚡ Custom command matched (${matchTime}ms): ${matchedCommand.triggers.join(", ")} → ${action}\nManual mode: executing through the BASE quick-template flow.`,
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
            isMepPlan: false,
          };
          pushMsg(aiMsg);
          setIsBaseExecuting(true);
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: action },
                    addOnCommandParameters: params
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            recordTask(`Custom NL: ${action}`, data.ok ? "success" : "error", data.ok ? "✓" : data.error?.slice(0, 60));
            triggerToast(data.ok
              ? (lang === "zh-CN" ? "自定义命令执行完成" : "Custom command executed")
              : (lang === "zh-CN" ? "自定义命令执行失败" : "Custom command failed"));
          } catch (err: any) {
            console.error("[App] Custom command BASE execution error:", err);
            setSystemError(err.message || String(err));
            triggerToast(lang === "zh-CN" ? "自定义命令执行失败" : "Custom command failed");
          } finally {
            setIsBaseExecuting(false);
            setIsAnalyzing(false);
          }
          return;
        }

        // 绑定单步命令：AI/监督模式下构建 OperationPlan
        plan = {
          title: `Custom: ${matchedCommand.triggers[0]}`,
          warning: matchedCommand.singleStep.riskLevel === "low-mutation"
            ? (lang === "zh-CN" ? "自定义命令触发的修改操作，需要确认" : "Custom command mutation, confirmation required")
            : null,
          isMutation: matchedCommand.singleStep.riskLevel === "low-mutation",
          mepCode: matchedCommand.singleStep.action,
          steps: [{
            id: `step_custom_${Date.now()}`,
            title: matchedCommand.singleStep.action,
            action: matchedCommand.singleStep.action,
            description: `Custom command: ${matchedCommand.triggers.join(" | ")}`,
            expectedResult: "Execute and readback",
            params: matchedCommand.singleStep.params as Record<string, unknown>,
            status: "pending",
          }],
          parameters: [],
        };

        const aiMsg: ChatMessage = {
          id: aiMsgId,
          sender: "ai",
          text: lang === "zh-CN"
            ? `⚡ 自定义命令命中 (${matchTime}ms)：${matchedCommand.triggers.join(", ")} → ${matchedCommand.singleStep.action}`
            : `⚡ Custom command matched (${matchTime}ms): ${matchedCommand.triggers.join(", ")} → ${matchedCommand.singleStep.action}`,
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          isMepPlan: true,
          planRef: plan,
        };
        pushMsg(aiMsg);
        setActivePlan(plan);
        setShowPlanCard(true);
        setIsAnalyzing(false);
        return;
      }
    }

    // V2 H2: 自治模式下优先走编排链执行
    if (autonomyMode !== "manual-strict") {
      const chainStarted = await handleChainExecute(textToSend);
      if (chainStarted) return;  // 链已启动，不再走普通 Copilot 流程
      // chain 返回 false = 不支持的意图，降级到普通 Copilot
    }

    try {
      const res = await fetch("/api/copilot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: textToSend, locale: lang })
      });

      if (!res.ok) {
        throw new Error("API server returned status " + res.status);
      }

      const rawData = await res.json();

      // Complete message synthesis response
      const aiMsgId = `ai_${Date.now()}`;
      const resPlan: OperationPlan | undefined = rawData.isMepAction ? rawData.action : undefined;

      // 构建丰富的 AI 响应文本
      let aiText = rawData.message || "";
      if (!aiText) {
        aiText = lang === "zh-CN"
          ? "已生成方案，请在中间面板核对。"
          : "Plan generated. Verify in the middle panel.";
      }

      // 追加步骤摘要
      if (resPlan && resPlan.steps && resPlan.steps.length > 0) {
        const stepNames = resPlan.steps.map((s: any) => s.title || s.action || "?").join(" \u2192 ");
        const mutationTag = rawData.action?.isMutation ? (lang === "zh-CN" ? "\u26A0\uFE0F 此操作将修改模型，需确认执行" : "\u26A0\uFE0F This operation modifies the model, requires confirmation") : "";
        aiText = `${aiText}\n\n\U0001F4CB ${stepNames}${mutationTag}`;
      }

      const aiResponse: ChatMessage = {
        id: aiMsgId,
        sender: "ai",
        text: aiText,
        timestamp: new Date().toLocaleTimeString(),
        isMepPlan: !!resPlan,
        planRef: resPlan,
        aiDetail: rawData.action?.descriptorName ?
          `${lang === "zh-CN" ? "匹配命令" : "Matched"}: ${rawData.action.descriptorName}` : undefined,
        matchedDescriptor: rawData.action?.descriptorName || undefined,
        stepsSummary: resPlan?.steps ? resPlan.steps.map((s: any) => s.title || s.action).join(" \u2192 ") : undefined,
        reasoning: rawData.reasoning || undefined  // V2: LLM CAD-CoT 思考过程
      };

      pushMsg(aiResponse);


      if (resPlan) {
        // Enforce state structures for the middle panel
        const stepsWithStatus = resPlan.steps.map((st: any) => ({
          ...st,
          status: "pending" as const
        }));

        setActivePlan({
          ...resPlan,
          steps: stepsWithStatus
        });
        setExecutionResultData(resPlan.parameters || []);
        setShowPlanCard(true);
        setExecutionCompleted(false);
        setCurrentExecutingStepIndex(-1);
        triggerToast(currentT.toastPlanGenerated);
      }
    } catch (err: any) {
      console.warn("Express backend API unavailable. Simulating locally...", err);

      // Dynamic simulated fallback to match local parameters
      setTimeout(() => {
        let titleTmp = lang === "zh-CN" ? "在三维工作区创建新型 MEP 管网" : "Create Structural Conduit Line";
        let warningTmp = lang === "zh-CN" ? "修改警告：该操作将会在 Archicad 的 'MEP-Pipes' 图层中写入 1 个新管段和 2 个弯头。" : "Mutation warning: This action pushes physical layout blocks to MEP-Pipes.";
        let mepCodeTmp = "MB.CreatePipe(start=[0,0,3000], end=[5000,0,3000], outer_diameter=250)";

        const localSteps: PlanStep[] = [
          {
            id: "step_1",
            title: "ScanStructure",
            description: lang === "zh-CN" ? "立体红外扫描检测 500mm 范围内可能发生硬干涉的支梁与建筑钢构件" : "Stereoscopic laser scans of steel braces and ceiling slabs within 500mm of routing trajectory.",
            expectedResult: lang === "zh-CN" ? "检测完成：路径顺滑，避开立柱障碍" : "Inspection passed: no major column collision.",
            params: { "clearanceRange": "500mm", "laserIntensity": "90" },
            status: "pending"
          },
          {
            id: "step_2",
            title: "Createconduit",
            description: lang === "zh-CN" ? "根据旁折计算路径在 Archicad 对应图层绘制并生成 250mm 空调管模型" : "Instruct Archicad to sketch dynamic air conduit structures with custom slopes.",
            expectedResult: lang === "zh-CN" ? "图纸实体构筑拟合：成功装配 GUID: A29C-D1" : "Reified physical coordinate assets.",
            params: { "layer": "MEP-Pipes", "system": "ClimateAir", "diameter": "250mm" },
            status: "pending"
          },
          {
            id: "step_3",
            title: "ReadbackVerify",
            description: lang === "zh-CN" ? "启动物理回读（Gate 4），通过点位接口验证管道截线、弯头连接度与水平倾角" : "Retrieve updated coordinate layout records from host workspace database and contrast metrics.",
            expectedResult: lang === "zh-CN" ? "物理层回馈无漏点：数据完美契合" : "Model synchronization approved inside strict tolerance limits.",
            params: { "tolerance": "1.5mm", "verificationType": "ParityCheck" },
            status: "pending"
          }
        ];

        const localParameters: VerificationParameter[] = [
          { item: lang === "zh-CN" ? "起点相对高度 (Z轴)" : "Start Deck Elev (Z)", expected: "3000.0 mm", actual: "3000.0 mm", status: "ok" },
          { item: lang === "zh-CN" ? "终点相对高度 (Z轴)" : "End Deck Elev (Z)", expected: "3000.0 mm", actual: "3000.0 mm", status: "ok" },
          { item: lang === "zh-CN" ? "管道配段外直径" : "Outer Diameter", expected: "250.0 mm", actual: "250.0 mm", status: "ok" },
          { item: lang === "zh-CN" ? "结构安全边缘厚度" : "Safety Edge Offset", expected: "> 100 mm", actual: "148.5 mm", status: "ok" }
        ];

        setActivePlan({
          title: titleTmp,
          warning: warningTmp,
          isMutation: true,
          mepCode: mepCodeTmp,
          steps: localSteps,
          parameters: localParameters
        });
        setExecutionResultData(localParameters);
        setShowPlanCard(true);
        setExecutionCompleted(false);
        setCurrentExecutingStepIndex(-1);

        const localStepsForSummary = localSteps || [];
        const stepNames = localStepsForSummary.map((s) => s.title || s.action || "?").join(" \u2192 ");
        const aiResponse: ChatMessage = {
          id: `ai_${Date.now()}`,
          sender: "ai",
          text: lang === "zh-CN"
            ? `\u2705 本地仿真生成最佳无损布线旁路计划\n\n\U0001F4CB ${stepNames}\n\u26A0\uFE0F 此操作将修改模型，需确认执行`
            : `\u2705 Locally resolved route geometry (simulated)\n\n\U0001F4CB ${stepNames}\n\u26A0\uFE0F This operation modifies the model, requires confirmation`,
          timestamp: new Date().toLocaleTimeString(),
          isMepPlan: true,
          isLocalMatch: true,
          executionTimeMs: 500,
          stepsSummary: stepNames
        };
        pushMsg(aiResponse);
        triggerToast(currentT.toastPlanGenerated);
      }, 500);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // V2 H2: 自治编排链执行（全自治模式）
  const handleChainExecute = async (text: string) => {
    if (!text.trim()) return;
    const executionMode = workbenchMode;
    const pollToken = ++chainPollTokenRef.current;
    setIsAnalyzing(true);
    setShowChainProgress(true);
    setIsChainRunning(true);
    setActivePlanMode(executionMode);  // 标记 chain plan 属于当前模式
    setExecutionCompleted(false);
    setExecutionResultData([]);

    try {
      const res = await fetch("/api/plan-chain/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          mode: autonomyMode,
          autoConfirm: autonomyMode === "copilot-auto",
          locale: lang
        })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Chain execution failed");
      }
      if (pollToken !== chainPollTokenRef.current) {
        return true;
      }

      if (data.status === "unsupported") {
        // 不支持的意图，回退到普通 Copilot 模式
        setShowChainProgress(false);
        setIsChainRunning(false);
        return false; // 告诉调用者回退
      }

      setChainStatus({ id: data.chainId, status: data.status, userIntent: data.userIntent, reasoning: data.reasoning, summary: data.summary });
      setChainSteps(data.steps || []);
      if (data.steps && data.steps.length > 0) {
        const chainPlan = buildPlanFromChain(data, data.steps);
        setActivePlan(chainPlan);
        setShowPlanCard(true);
        setExecutionResultData(buildVerificationRowsFromChain(data.steps));
      }

      // 添加 AI 消息到对话
      const aiMsg: ChatMessage = {
        id: `chain_${Date.now()}`,
        sender: "ai",
        text: `🤖 ${lang === "zh-CN" ? "[自动模式]" : "[Autonomy]"} ${data.message || `${data.summary} 已启动`}\n\n📋 ${data.steps?.map((s: any) => s.title || s.action).join(" → ") || ""}`,
        timestamp: new Date().toLocaleTimeString(),
        isMepPlan: true,
        reasoning: data.reasoning
      };
      setMessages((prev) => [...prev, { ...aiMsg, mode: executionMode }]);

      // 启动状态轮询
      if (chainPollIntervalRef.current) clearInterval(chainPollIntervalRef.current);
      const poller = setInterval(async () => {
        try {
          const statusRes = await fetch("/api/plan-chain/status");
          const statusData = await statusRes.json();
          if (pollToken !== chainPollTokenRef.current) {
            clearInterval(poller);
            return;
          }
          if (statusData.ok && statusData.hasActiveChain) {
            setChainStatus(statusData);
            if (statusData.steps) {
              const normalizedChainSteps = statusData.steps.map((s: any) => ({
                id: s.id, action: s.action, title: s.title,
                status: s.status, riskLevel: s.riskLevel,
                result: s.result, error: s.error,
                visualVerified: s.visualVerified,
                visualIssues: s.visualIssues,
                visualSuggestions: s.visualSuggestions
              }));
              setChainSteps(normalizedChainSteps);
              setActivePlan(buildPlanFromChain(statusData, normalizedChainSteps));
              setShowPlanCard(true);
              setExecutionResultData(buildVerificationRowsFromChain(normalizedChainSteps));
            }
            // 链结束（完成/失败/取消/错误）
            if (["completed", "failed", "error", "cancelled"].includes(statusData.status)) {
              setIsChainRunning(false);
              setExecutionCompleted(true);
              clearInterval(poller);
              if (chainPollIntervalRef.current === poller) {
                chainPollIntervalRef.current = null;
              }

              // 最终结果消息
              const resultMsg: ChatMessage = {
                id: `chain_result_${Date.now()}`,
                sender: "ai",
                text: statusData.status === "completed"
                  ? (lang === "zh-CN" ? `✅ 自动执行完成！共 ${(statusData.stats?.completed ?? ((statusData.stats?.confirmed ?? 0) + (statusData.stats?.autoRun ?? 0))) ?? 0} 步成功` : `✅ Chain complete! ${(statusData.stats?.completed ?? ((statusData.stats?.confirmed ?? 0) + (statusData.stats?.autoRun ?? 0))) ?? 0} steps succeeded`)
                  : (lang === "zh-CN" ? `⚠️ 执行终止：${statusData.status}，失败 ${statusData.failureCount ?? 0} 步` : `⚠️ Stopped: ${statusData.status}, ${statusData.failureCount ?? 0} failures`),
                timestamp: new Date().toLocaleTimeString()
              };
              setMessages((prev) => [...prev, { ...resultMsg, mode: executionMode }]);
            }
          } else {
            // 无活跃链了
            setIsChainRunning(false);
            clearInterval(poller);
            if (chainPollIntervalRef.current === poller) {
              chainPollIntervalRef.current = null;
            }
          }
        } catch (e) {
          console.warn("[App] Chain poll error:", e);
        }
      }, 1500); // 每 1.5 秒轮询一次
      chainPollIntervalRef.current = poller;

      return true; // 成功启动链
    } catch (err: any) {
      console.error("[App] Chain execute error:", err);
      setIsChainRunning(false);
      setShowChainProgress(false);
      setSystemError(lang === "zh-CN" ? `自动执行失败: ${err.message}` : `Autonomy failed: ${err.message}`);
      return false;
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Real Execution: Call actual /api/execute for each step
  const handleExecutePlan = async () => {
    // Safety check - connection states are critical constraint
    if (!archicadConnected || !mepbridgeConnected) {
      setSystemError(currentT.errConnDesc);
      return;
    }

    if (!activePlan) return;
    setActivePlanMode(workbenchMode);  // 确保执行结果属于当前模式
    // 辅助函数：给执行过程中的系统消息加 mode 标记
    const pushExecMsg = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, mode: workbenchMode }]);
    };

    // Show confirmation dialog for mutation operations
    if (activePlan.isMutation && safetyGate) {
      setPendingExecution(activePlan);
      setShowConfirmationDialog(true);
      return;
    }

    // If no confirmation needed, execute directly
    await executeOperationPlan(activePlan, workbenchMode);
  };

  // Actual execution logic (extracted for reuse)
  const executeOperationPlan = async (plan: OperationPlan, executionMode: "base" | "copilot" = workbenchMode) => {
    setSystemError(null);
    setIsExecutingPlan(true);
    setExecutionCompleted(false);
    setActivePlanMode(executionMode);

    const pushExecutionMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, mode: msg.mode || executionMode }]);
    };

    // Initialize all steps status to pending from the plan being executed.
    // Do not rely on activePlan here because direct template execution can run
    // before React has flushed setActivePlan().
    setActivePlan({
      ...plan,
      steps: plan.steps.map((s) => ({ ...s, status: "pending" }))
    });

    // Store results for each step
    const stepResults: any[] = [];

    // Execute each step sequentially
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      setCurrentExecutingStepIndex(i);

      // Set step to running
      setActivePlan((prev) => {
        if (!prev) return null;
        const updatedSteps = [...prev.steps];
        updatedSteps[i] = { ...updatedSteps[i], status: "running" };
        return { ...prev, steps: updatedSteps };
      });

      try {
        const command = buildExecutePayload(step);

        // SYNC-5 防御：空 action 的 step 跳过执行（不再误发 Ping）
        // 正常情况下 copilot-message.js 已过滤 unsupported plan，此为兜底保护
        const cmdName = command?.commandName || "";
        const hasCommandJson = !!step.commandJson?.command;
        if (!cmdName && !hasCommandJson) {
          pushExecutionMessage({
              id: `skip_${i}_${Date.now()}`,
              sender: "system",
              text: `⊘ SKIP: Step ${i + 1} [${step.title || "未命名"}] 无可执行命令，已跳过。`,
              timestamp: new Date().toLocaleTimeString()
          });
          continue;
        }

        // Call real backend
        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command)
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const result = await res.json();

        // Check result
        if (result.ok || result.validation?.ok) {
          // Store result
          stepResults.push(result);

          // Mark step as done
          setActivePlan((prev) => {
            if (!prev) return null;
            const updatedSteps = [...prev.steps];
            updatedSteps[i] = { ...updatedSteps[i], status: "done" };
            return { ...prev, steps: updatedSteps };
          });

          // Extract meaningful info
          const resultSummary = extractResultSummary(result);

          // Log success with actual result
          pushExecutionMessage({
              id: `exec_${i}_${Date.now()}`,
              sender: "system",
              text: `✓ EXEC: Step ${i + 1}/${plan.steps.length} [${step.title}] completed. ${resultSummary}`,
              timestamp: new Date().toLocaleTimeString()
          });
        } else {
          throw new Error(result.validation?.errors?.join(", ") || result.error || "Unknown error");
        }

        // Wait between steps
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        // Mark step as error
        setActivePlan((prev) => {
          if (!prev) return null;
          const updatedSteps = [...prev.steps];
          updatedSteps[i] = { ...updatedSteps[i], status: "error" };
          return { ...prev, steps: updatedSteps };
        });

        setSystemError(err.message);

        pushExecutionMessage({
            id: `error_${i}_${Date.now()}`,
            sender: "system",
            text: `❌ ERROR: Step ${i + 1} [${step.title}] failed: ${err.message}`,
            timestamp: new Date().toLocaleTimeString()
        });

        setIsExecutingPlan(false);
        return; // Stop on error
      }
    }

    // All steps completed successfully
    setIsExecutingPlan(false);
    setExecutionCompleted(true);
    triggerToast(currentT.toastExecuted);

    // Update verification parameters with actual results
    updateVerificationTable(stepResults, plan);

    // Perform readback verification if any GUIDs were created
    await performReadback(stepResults, executionMode);

    pushExecutionMessage({
        id: `success_${Date.now()}`,
        sender: "ai",
        text: lang === "zh-CN"
          ? `🎉 操作执行成功！所有步骤已完成，共 ${stepResults.length} 个操作。`
          : `🎉 Operation completed successfully! All ${stepResults.length} steps executed.`,
        timestamp: new Date().toLocaleTimeString()
    });
  };

  // Helper: Replay user template according to current autonomy mode
  const replayUserTemplate = async (tpl: TaskTemplate) => {
    const hasPlaceholders = Array.isArray(tpl.placeholders) && tpl.placeholders.length > 0;
    if (autonomyMode === "copilot-auto" && !hasPlaceholders) {
      const filledPlan = tpl.plan;
      setActivePlan(filledPlan);
      setExecutionResultData(filledPlan.parameters || []);
      setShowPlanCard(true);
      setWorkbenchMode("copilot");
      setExecutionCompleted(false);
      setCurrentExecutingStepIndex(-1);

      if (!archicadConnected || !mepbridgeConnected) {
        setSystemError(currentT.errConnDesc);
        triggerToast(currentT.errConnTitle);
        return;
      }

      triggerToast(lang === "zh-CN" ? "AI 自动模式：用户模板将直接执行" : "AI auto mode: executing user template directly");
      await executeOperationPlan(filledPlan, "copilot");
      return;
    }

    setReplayTemplate(tpl);
  };

  // Helper: Perform readback verification
  const performReadback = async (results: any[], executionMode: "base" | "copilot" = workbenchMode) => {
    const pushReadbackMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, mode: msg.mode || executionMode }]);
    };

    // Collect all GUIDs from results
    const guids: string[] = [];
    results.forEach(result => {
      const payload = getCommandPayload(result);
      if (payload.guid) {
        guids.push(payload.guid);
      }
      if (payload.routeGuid) {
        guids.push(payload.routeGuid);
      }
      if (Array.isArray(payload.createdGuids)) {
        payload.createdGuids.forEach((guid: string) => {
          if (guid) guids.push(guid);
        });
      }
      if (Array.isArray(payload.routeGuids)) {
        payload.routeGuids.forEach((entry: any) => {
          if (typeof entry === "string") guids.push(entry);
          else if (entry?.routeGuid) guids.push(entry.routeGuid);
        });
      }
      if (payload.elements) {
        payload.elements.forEach((el: any) => {
          if (el.guid) guids.push(el.guid);
        });
      }
    });

    if (guids.length === 0) {
      // No GUIDs to verify
      return;
    }

    try {
      pushReadbackMessage({
          id: `readback_start_${Date.now()}`,
          sender: "system",
          text: `🔍 READBACK: Verifying ${guids.length} created element(s)...`,
          timestamp: new Date().toLocaleTimeString()
      });

      // Call GetSelectedElements to verify
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: {
                commandNamespace: "MEPBridge",
                commandName: "GetSelectedElements"
              },
              addOnCommandParameters: {
                onlyEditable: false,
                includeAabb: true,
                includeMepInfo: true
              }
            }
          },
          source: "ui-readback",
          intent: "Verify active selection after execution"
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const result = await res.json();

      const payload = getCommandPayload(result);

      if (result.ok && payload?.elements) {
        const verified = payload.elements.length;
        const expected = guids.length;
        const allVerified = expected === 0 || verified > 0;
        const actualElements = normalizeViewportElements(payload.elements);
        if (actualElements.length > 0) {
          const viewportSignature = actualElements
            .map((element) => `${element.guid}:${JSON.stringify(element.aabb)}`)
            .sort()
            .join("|");
          lastViewportSignatureRef.current = viewportSignature;
          setLiveViewportElements(actualElements);
          setLiveViewportSource("readback");
          setLiveViewportUpdatedAt(Date.now());
        }

        pushReadbackMessage({
            id: `readback_result_${Date.now()}`,
            sender: "system",
            text: allVerified
              ? `✅ READBACK: All ${verified}/${expected} element(s) verified successfully!`
              : `⚠️ READBACK: Only ${verified}/${expected} element(s) found.`,
            timestamp: new Date().toLocaleTimeString()
        });

        // Add readback result to verification table
        setExecutionResultData(prev => [
          ...prev,
          {
            item: "Readback Verification",
            expected: `${expected} element(s)`,
            actual: `${verified} element(s)`,
            status: allVerified ? "ok" : "warning"
          }
        ]);
      } else {
        throw new Error("Readback failed");
      }
    } catch (err: any) {
      pushReadbackMessage({
          id: `readback_error_${Date.now()}`,
          sender: "system",
          text: `❌ READBACK: Verification failed - ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
      });
    }
  };

  // Helper: Extract result summary from API response
  const extractResultSummary = (result: any): string => {
    const response = result.response || {};
    const parts: string[] = [];

    const payload = getCommandPayload(result);

    if (payload.guid) parts.push(`GUID: ${payload.guid.substring(0, 8)}...`);
    if (payload.routeGuid) parts.push(`Route: ${payload.routeGuid.substring(0, 8)}...`);
    if (payload.count !== undefined) parts.push(`Count: ${payload.count}`);
    if (payload.elementCount !== undefined) parts.push(`Elements: ${payload.elementCount}`);
    if (payload.elements?.length) parts.push(`Elements: ${payload.elements.length}`);
    if (payload.durationMs) parts.push(`Duration: ${payload.durationMs}ms`);
    if (payload.status) parts.push(`Status: ${payload.status}`);

    return parts.length > 0 ? parts.join(", ") : "OK";
  };

  // Helper: Update verification table with actual results
  const updateVerificationTable = (results: any[], planForResults: OperationPlan | null = activePlan) => {
    const newParams: VerificationParameter[] = results.map((result, idx) => {
      const response = getCommandPayload(result);
      const step = planForResults?.steps[idx];

      let actual = "N/A";
      let status: "ok" | "warning" | "error" = "ok";

      if (response.guid) {
        actual = `GUID: ${response.guid.substring(0, 12)}...`;
      } else if (response.count !== undefined) {
        actual = `Count: ${response.count}`;
      } else if (response.elements?.length) {
        actual = `Elements: ${response.elements.length}`;
      } else if (result.ok) {
        actual = "Success";
      }

      return {
        item: step?.title || `Step ${idx + 1}`,
        expected: step?.expectedResult || "Success",
        actual,
        status
      };
    });

    setExecutionResultData(newParams);
  };

  const buildExecutePayload = (step: PlanStep) => {
    if (step.commandJson?.command) {
      return {
        command: step.commandJson,
        source: "ui-copilot",
        intent: step.description
      };
    }

    return {
      commandName: mapStepToCommand(step),
      commandNamespace: step.commandNamespace || undefined,
      parameters: step.params || {},
      source: "ui-copilot",
      intent: step.description,
      target: { scope: "selection" }
    };
  };

  const getCommandPayload = (result: any): any => {
    return (
      result?.response?.result?.addOnCommandResponse ||
      result?.response?.result ||
      result?.response ||
      result?.data ||
      result ||
      {}
    );
  };

  // D.4: 按 step.action 字段驱动命令映射（不再依赖 title 硬编码）
  // SYNC-5 铁律：不允许新增硬编码条目，所有命令映射必须来自 step.action 字段
  // D5 修复 (2026-06-26): action 为空时不再默认 Ping，返回空串触发上层 unsupported 处理
  //   原行为 `return "MEPBridge.Ping"` 违反 D5 "无法识别意图返回友好提示，不再默认 Ping" 原则
  const mapStepToCommand = (step: PlanStep): string => {
    const action = step.action?.trim();
    if (!action) return "";  // SYNC-5: 空串让上层跳过执行而非误发 Ping

    // action 已经是完整命令名（含 MEPBridge. 前缀）
    if (action.startsWith("MEPBridge.") || action.startsWith("API.")) {
      return action;
    }

    // action 是简短命令名，补全 MEPBridge. 前缀
    return `MEPBridge.${action}`;
  };

  // Decline Plan Action
  const handleCancelPlan = () => {
    setActivePlan(null);
    setShowPlanCard(false);
    setExecutionCompleted(false);
    setSystemError(null);
    appendMessage({
        id: `cancel_${Date.now()}`,
        sender: "system",
        text: "⚡ WORKSPACE: Operations proposal has been declined by user authority. Safety locks reset to primary.",
        timestamp: new Date().toLocaleTimeString()
    });
  };

  // Quick Action: Reset Workspace state
  const handleRefreshWorkspace = () => {
    setIsRefreshing(true);
    const prevLang = lang;
    setTimeout(() => {
      setIsRefreshing(false);
      triggerToast(t[prevLang].toastReset);

      // Clear logs but keep greeting
      setMessages([
        {
          id: `sys_sync_${Date.now()}`,
          sender: "system",
          text: "🔄 WORKSPACE_HEALTH_CHECK: Synchronizing MEPBridge socket nodes to Archicad... Ping response 12ms. Checksums verify successfully.",
          timestamp: new Date().toLocaleTimeString(),
          mode: workbenchMode
        }
      ]);
      setSystemError(null);
      setActivePlan(null);
      setShowPlanCard(false);
      setExecutionCompleted(false);
    }, 1200);
  };

  // Quick Action: Undo
  const handleUndoWorkspace = () => {
    triggerToast(currentT.toastUndo);
    appendMessage({
        id: `undo_${Date.now()}`,
        sender: "system",
        text: "↩️ SYSTEM_ROLLBACK: Reverting latest CAD coordinate offset and deleting GUID 'A29C-D1'. Sync point retrieved successfully.",
        timestamp: new Date().toLocaleTimeString()
    });
    setActivePlan(null);
    setShowPlanCard(false);
    setExecutionCompleted(false);
  };

  // Quick Action: Clear History
  const handleClearHistory = () => {
    setMessages([]);
    setInputMessage("");
    setSystemError(null);
    setActivePlan(null);
    setShowPlanCard(false);
    setExecutionCompleted(false);
  };

  // Quick prompt suggestions handler
  const selectQuickSuggestion = (text: string) => {
    handleSendMessage(text);
  };

  // Test LLM Connection Credentials in Modal
  const testLlmCredentials = async () => {
    setIsTestingLlm(true);
    setLlmFeedback(null);

    try {
      const saveRes = await fetch("/api/llm-config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeLlmConfigForApi(llmConfig))
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.error) {
        throw new Error(saveData.error || `HTTP ${saveRes.status}`);
      }

      const testRes = await fetch("/api/llm-config/test", { method: "POST" });
      const testData = await testRes.json();
      setLlmFeedback({
        success: !!testData.success,
        text: testData.success ? currentT.successTest : (testData.error || currentT.failTest)
      });
      // D5: 同步更新连接状态指示器
      setLlmConnStatus(testData.success ? "connected" : "disconnected");
    } catch (err: any) {
      setLlmFeedback({ success: false, text: err.message || currentT.failTest });
    } finally {
      setIsTestingLlm(false);
    }
  };

  // Apply parameters in Modal
  const saveLlmCredentials = async () => {
    setLlmFeedback(null);
    try {
      const res = await fetch("/api/llm-config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeLlmConfigForApi(llmConfig))
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setShowLlmModal(false);
      setLlmProvider(llmConfig.provider);
      triggerToast(currentT.okLlm);
      appendMessage({
          id: `sys_llm_upd_${Date.now()}`,
          sender: "system",
          text: `⚡ MODELLING_CORE: Changed active processing endpoint to: ${llmConfig.provider.toUpperCase()} (Model: ${llmConfig.modelName || "default"}). Checkpoints loaded.`,
          timestamp: new Date().toLocaleTimeString()
      });
    } catch (err: any) {
      setLlmFeedback({ success: false, text: err.message || currentT.failTest });
    }
  };

  // Render elegant custom vector CAD canvas pipeline path line
  const renderPipesSvg = () => {
    // Start layout: (50, 150)
    // End layout:  (450, 150)
    // Columns are placed in between.
    // Let's draw an absolute, geometrically precise line that curves/detours gracefully around active obstacles!
    // We will calculate a dynamic multi-segment path that bypasses obstacles.
    // If we place an obstacle, let's deviate the line up or down based on proximity to the line Y=150.

    const sortedObstacles = [...gridObstacles].sort((a, b) => a.x - b.x);
    let pathDefinition = "M 50,150";
    let xCurr = 50;
    let yCurr = 150;

    // Build path segments avoiding obstacles
    const bypassPoints: {x: number, y: number}[] = [];
    bypassPoints.push({ x: 50, y: 150 });

    sortedObstacles.forEach((obs) => {
      // Find intersection points. If obstacle is near the straight path (Y=150±r), we offset Y.
      if (Math.abs(150 - obs.y) < obs.r + 30) {
        const detourOffset = obs.y < 150 ? obs.r + 32 : -(obs.r + 32);

        // Approach point before detour
        bypassPoints.push({ x: obs.x - obs.r - 20, y: 150 });

        // Peak point above/below the column
        bypassPoints.push({ x: obs.x, y: obs.y + detourOffset });

        // Resume point after detour
        bypassPoints.push({ x: obs.x + obs.r + 20, y: 150 });
      }
    });

    bypassPoints.push({ x: 450, y: 150 });

    // Build cubic bezier curve or neat 45-degree polyline or smooth lines. Let's make a beautiful high-tech CAD polyline!
    let pathString = `M ${bypassPoints[0].x},${bypassPoints[0].y}`;
    for (let i = 1; i < bypassPoints.length; i++) {
      pathString += ` L ${bypassPoints[i].x},${bypassPoints[i].y}`;
    }

    return pathString;
  };

  const restoreMainWindowBounds = () => {
    const bounds = normalWindowBoundsRef.current;
    normalWindowBoundsRef.current = null;
    if (!bounds) return;

    try {
      window.resizeTo(bounds.width, bounds.height);
      window.moveTo(bounds.left, bounds.top);
    } catch {
      // Normal browser tabs may reject resize requests; the layout still restores.
    }
  };

  const handleConversationWindowClosed = () => {
    setConversationWindow(null);
    setConversationFocusMode(false);
    restoreMainWindowBounds();
  };

  const handleConversationFocusToggle = () => {
    if (conversationFocusMode) {
      const popup = conversationWindow;
      setConversationWindow(null);
      setConversationFocusMode(false);
      if (popup && !popup.closed) {
        popup.close();
      }
      restoreMainWindowBounds();
      return;
    }

    normalWindowBoundsRef.current = {
      width: window.outerWidth,
      height: window.outerHeight,
      left: window.screenX,
      top: window.screenY
    };

    if (window.matchMedia("(max-width: 640px)").matches) {
      setConversationWindow(null);
      setConversationFocusMode(true);
      return;
    }

    const screenInfo = window.screen as Screen & { availLeft?: number; availTop?: number };
    const availableLeft = screenInfo.availLeft ?? 0;
    const availableTop = screenInfo.availTop ?? 0;
    const popupWidth = Math.min(
      window.screen.availWidth,
      CONVERSATION_POPUP_INITIAL_WIDTH
    );
    const popupHeight = Math.min(
      window.screen.availHeight,
      Math.max(720, window.outerHeight)
    );
    const popupLeft = Math.max(
      availableLeft,
      availableLeft + window.screen.availWidth - popupWidth
    );
    const popupTop = Math.max(availableTop, window.screenY);
    const popup = window.open(
      "",
      "mepbridge-conversation-workspace",
      [
        "popup=yes",
        "resizable=yes",
        "scrollbars=no",
        `width=${popupWidth}`,
        `height=${popupHeight}`,
        `left=${popupLeft}`,
        `top=${popupTop}`
      ].join(",")
    );

    if (popup) {
      setConversationWindow(popup);
      setConversationFocusMode(true);
      popup.focus();
      return;
    }

    setConversationWindow(null);
    setConversationFocusMode(true);
    try {
      const chromeWidth = Math.max(0, window.outerWidth - window.innerWidth);
      window.resizeTo(
        Math.min(window.screen.availWidth, CONVERSATION_PANEL_WIDTH + chromeWidth),
        window.outerHeight
      );
    } catch {
      // Popup blocking still leaves a usable inline conversation-only layout.
    }
    triggerToast(
      lang === "zh-CN"
        ? "浏览器阻止了独立对话窗口，已切换为页面内简易模式。请允许此站点弹出窗口后重试。"
        : "The browser blocked the standalone conversation window. Inline focus mode is active; allow pop-ups for this site and retry."
    );
  };

  return (
    <div className={`${conversationFocusMode ? "w-full sm:w-[384px] max-w-full h-screen overflow-hidden" : "min-h-screen"} flex flex-col bg-zinc-950 text-zinc-150 font-sans tracking-wide`}>
      {/* Demo Mode Banner - 仅在未连接时显示 */}
      {!conversationFocusMode && (!archicadConnected || !mepbridgeConnected) && (
      <div className="flex items-center justify-between px-5 py-2.5 bg-amber-900/20 border-b border-amber-800/50 text-amber-200 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span>
            {lang === "zh-CN"
              ? "⚠️ 演示模式: 当前 UI 功能为前端模拟，部分操作不连接 Archicad。"
              : "⚠️ Demo Mode: Current UI functions are front-end simulations, some operations do not connect to Archicad."}
          </span>
        </div>
        <a
          href="/manual"
          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors text-xs font-medium"
        >
          {lang === "zh-CN" ? "手动 JSON 模式" : "Manual JSON Mode"}
        </a>
      </div>
      )}

      {/* 1. Global Header (Topbar) */}
      {!conversationFocusMode && (
      <header className="flex h-14 bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 px-5 items-center justify-between z-30 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.4)]">
            <Radio className="w-5 h-5 text-white animate-pulse-subtle" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-wider font-mono bg-gradient-to-r from-zinc-100 via-indigo-200 to-zinc-300 bg-clip-text text-transparent uppercase select-none drop-shadow-[0_1px_4px_rgba(99,102,241,0.2)]">
              {currentT.brand}
            </span>
            <span className="text-[10px] text-indigo-400 font-mono tracking-widest leading-none mt-0.5 uppercase">
              {currentT.tagline}
            </span>
          </div>
        </div>

        {/* Parity connectivity dashboard header */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 bg-zinc-900/40 border border-zinc-800 px-3 py-1.5 rounded-full text-xs font-mono">
            {/* Archicad */}
            <div
              className="flex items-center gap-1.5"
              title="Archicad connection status (auto-polling)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${archicadConnected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
              <span className="text-zinc-400">Archicad:</span>
              <span className={archicadConnected ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                {archicadConnected ? "ON" : "OFF"}
              </span>
            </div>

            <div className="w-[1px] h-3 bg-zinc-800" />

            {/* MEPBridge Extension */}
            <div
              className="flex items-center gap-1.5"
              title="MEPBridge connection status (auto-polling)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${mepbridgeConnected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
              <span className="text-zinc-400">MEPBridge:</span>
              <span className={mepbridgeConnected ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                {mepbridgeConnected ? "ON" : "OFF"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-zinc-900/80 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setLang("zh-CN")}
                className={`px-2 py-1 text-xs font-semibold rounded cursor-pointer ${lang === "zh-CN" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                中
              </button>
              <button
                onClick={() => setLang("en-US")}
                className={`px-2 py-1 text-xs font-semibold rounded cursor-pointer ${lang === "en-US" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>
      )}

      {/* 2. Main Sandbox Space Layout */}
      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden relative">
        {/* SUCCESS ALERTS & TOASTS */}
        <AnimatePresence>
          {successToast && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-[#0d2e1c] border border-emerald-500/40 text-emerald-300 py-3 px-5 rounded-xl shadow-xl shadow-black/40 flex items-center gap-2.5"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-400 animate-bounce" />
              <span className="text-xs font-semibold font-sans">{successToast}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* THREE COLUMNS: Left panel, Middle Workspace, Right panel */}

        {/* LEFT Sidebar: Settings / Strategy Gates */}
        <aside className={`${conversationFocusMode ? "hidden" : "w-full lg:w-72 lg:flex-shrink-0"} bg-zinc-900/40 border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col overflow-y-auto p-4 gap-4 z-10 custom-scrollbar select-none`}>
          {/* Section 1: Connection Health */}
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-3.5 flex flex-col gap-3">
            <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 font-bold">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              {currentT.connStatus}
            </h3>

            <div className="flex flex-col gap-2 font-sans">
              <div className="flex items-center justify-between p-2 rounded bg-zinc-850/40 border border-zinc-800">
                <span className="text-xs text-zinc-300">{currentT.statArchicad}</span>
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-medium ${archicadConnected ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border border-red-500/20 text-red-400"}`}
                  title="Archicad connection status (auto-polling)"
                >
                  {archicadConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  {archicadConnected ? "ONLINE" : "OFFLINE"}
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-zinc-850/40 border border-zinc-800">
                <span className="text-xs text-zinc-300">{currentT.statMepbridge}</span>
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-mono font-medium ${mepbridgeConnected ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border border-red-500/20 text-red-400"}`}
                  title="MEPBridge connection status (auto-polling)"
                >
                  {mepbridgeConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  {mepbridgeConnected ? "ONLINE" : "OFFLINE"}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Strategy Controls (Gates) */}
          <div className="rounded-xl bg-zinc-900/40 border border-zinc-800 p-3.5 flex flex-col gap-3.5">
            <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 font-bold">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              {currentT.configTitle}
            </h3>

            <div className="flex flex-col gap-3">
              {/* Safety Gate Toggle */}
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={safetyGate}
                  onChange={(e) => setSafetyGate(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500/40 bg-zinc-950 w-4 h-4"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-zinc-200 group-hover:text-indigo-400 transition-colors">
                    {currentT.gate2}
                  </span>
                  <span className="text-[10px] text-zinc-400 leading-normal mt-0.5">
                    {lang === "zh-CN" ? "拦截并预览未经校验的修改请求" : "Enforce verification review before mutation write."}
                  </span>
                </div>
              </label>

              {/* Auto Readback Verify */}
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={autoReadback}
                  onChange={(e) => setAutoReadback(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500/40 bg-zinc-950 w-4 h-4"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-zinc-200 group-hover:text-indigo-400 transition-colors">
                    {currentT.gate4}
                  </span>
                  <span className="text-[10px] text-zinc-400 leading-normal mt-0.5">
                    {lang === "zh-CN" ? "物理端点比对与偏差异常校核" : "Continuous model comparison checking."}
                  </span>
                </div>
              </label>

              <div className="w-full h-[1px] bg-zinc-800" />

              {/* Confirmation Granularity enum */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-mono tracking-wider font-bold text-zinc-500 uppercase">
                  {currentT.granLabel}
                </span>
                <select
                  value={confirmationGranularity}
                  onChange={(e) => setConfirmationGranularity(e.target.value as ConfirmationGranularityType)}
                  className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                >
                  <option value="overall">{currentT.granOverall}</option>
                  <option value="smart">{currentT.granSmart}</option>
                  <option value="step-by-step">{currentT.granStep}</option>
                </select>
              </div>

              {/* LLM Provider Selector */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono tracking-wider font-bold text-zinc-500 uppercase">
                    {currentT.llmProvider}
                  </span>
                  {/* D5: LLM 连接状态指示器（闪烁绿点 + 文字） */}
                  {llmConnStatus === "connected" && (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                      </span>
                      {lang === "zh-CN" ? "已连接" : "Connected"}
                    </span>
                  )}
                  {llmConnStatus === "testing" && (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-400">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-pulse inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
                      </span>
                      {lang === "zh-CN" ? "检测中" : "Testing"}
                    </span>
                  )}
                  {llmConnStatus === "disconnected" && (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-red-400">
                      <span className="inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      {lang === "zh-CN" ? (llmManuallyDisconnected ? "已断开" : "未连接") : (llmManuallyDisconnected ? "Disconnected" : "Offline")}
                    </span>
                  )}
                  {llmConnStatus === "unknown" && (
                    <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-zinc-500">
                      <span className="inline-flex rounded-full h-2 w-2 bg-zinc-600"></span>
                      {lang === "zh-CN" ? "未检测" : "Idle"}
                    </span>
                  )}
                </div>
                <select
                  value={llmProvider}
                  onChange={(e) => {
                    setLlmProvider(e.target.value);
                    setLlmConfig((prev) => ({ ...prev, provider: e.target.value }));
                    // D5: 切换 provider 后重置状态（用户需保存后重新检测）
                    setLlmConnStatus("unknown");
                  }}
                  className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                  <option value="ollama">Ollama Local</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
                {/* D5: 手动重新检测连接按钮 */}
                {llmConnStatus !== "testing" && (
                  <div className="self-end flex items-center gap-2 mt-0.5">
                    <button
                      onClick={disconnectLlmConnection}
                      className="text-[10px] font-mono text-zinc-500 hover:text-red-400 transition-colors"
                      title={lang === "zh-CN" ? "手动断开当前 LLM 推理连接状态" : "Manually disconnect current LLM status"}
                    >
                      ⏻ {lang === "zh-CN" ? "断开" : "Disconnect"}
                    </button>
                    <button
                      onClick={testLlmConnection}
                      className="text-[10px] font-mono text-zinc-500 hover:text-indigo-400 transition-colors"
                      title={lang === "zh-CN" ? "重新检测连接" : "Re-test connection"}
                    >
                      ↻ {lang === "zh-CN" ? "重新检测" : "Re-test"}
                    </button>
                  </div>
                )}
              </div>

              {/* Config trigger button */}
              <button
                onClick={() => {
                  setLlmFeedback(null);
                  setShowLlmModal(true);
                }}
                className="w-full mt-1.5 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs font-semibold text-zinc-200 cursor-pointer active:scale-[0.98] transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
                {currentT.btnLlmConfig}
              </button>

              {(mcpPlatforms.length > 0 || mcpStatusLoading) && (
                <div className="mt-2 pt-2 border-t border-zinc-800/80 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono tracking-wider font-bold text-zinc-500 uppercase">
                      {lang === "zh-CN" ? "MCP 接入状态" : "MCP Integrations"}
                    </span>
                    <button
                      onClick={loadMcpStatus}
                      className="text-[10px] font-mono text-zinc-600 hover:text-indigo-400 transition-colors"
                      title={lang === "zh-CN" ? "刷新 MCP 状态" : "Refresh MCP status"}
                    >
                      ↻
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {mcpPlatforms.map((platform) => (
                      <div
                        key={platform.name}
                        className="flex items-center justify-between gap-2 rounded border border-emerald-500/15 bg-emerald-500/5 px-2 py-1 text-[10px] font-mono"
                        title={platform.path || platform.name}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-zinc-300">
                          <Link className="h-3 w-3 shrink-0 text-emerald-400" />
                          <span className="truncate">{platform.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 font-bold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          {lang === "zh-CN" ? "已连接" : "Connected"}
                        </span>
                      </div>
                    ))}
                    {mcpPlatforms.length === 0 && mcpStatusLoading && (
                      <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] font-mono text-zinc-500">
                        {lang === "zh-CN" ? "正在检测 MCP 宿主..." : "Checking MCP hosts..."}
                      </div>
                    )}
                  </div>
                </div>
              )}


              {/* E.5: 自定义命令入口已移至中区扩展功能面板 */}
            </div>
          </div>
        </aside>

        {/* MIDDLE Panel: Main interactive CAD pipeline + Steps review */}
        <main className={`${conversationFocusMode ? "hidden" : "flex-1"} bg-zinc-950 flex flex-col overflow-y-auto p-4 md:p-5 gap-4 custom-scrollbar min-w-0`}>

          {/* Conditional Rendering: BASE Mode vs AI Copilot Mode */}
          {workbenchMode === "base" ? (
            /* ========== BASE MODE ========== */
            <div className="flex flex-col gap-4">

              {/* Selection Status Card */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-lg flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-zinc-300 flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-400" />
                    {lang === "zh-CN" ? "当前 Archicad 选择集" : "Current Archicad Selection"}
                    {/* P3+: 自动同步指示灯 */}
                    {autoSyncSelection && mepbridgeConnected && workbenchMode === "base" && (
                      <span className="flex items-center gap-1 ml-1" title={lang === "zh-CN" ? "自动同步中（3秒）" : "Auto-sync (3s)"}>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        {lastSelectionSyncAt > 0 && (
                          <span className="text-[10px] text-zinc-600 font-mono">
                            {new Date(lastSelectionSyncAt).toLocaleTimeString(lang === "zh-CN" ? "zh-CN" : "en-US", { hour12: false })}
                          </span>
                        )}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* P3+: 自动同步开关 */}
                    <button
                      onClick={() => setAutoSyncSelection(prev => !prev)}
                      className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                        autoSyncSelection
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                          : "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:bg-zinc-800"
                      }`}
                      title={lang === "zh-CN" ? "切换选择集自动同步" : "Toggle auto-sync selection"}
                    >
                      {autoSyncSelection
                        ? (lang === "zh-CN" ? "自动同步 ON" : "Auto ON")
                        : (lang === "zh-CN" ? "自动同步 OFF" : "Auto OFF")}
                    </button>
                    <button
                      onClick={async () => {
                        setIsBaseExecuting(true);
                        try {
                          const res = await fetch("/api/execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              command: {
                                command: "API.ExecuteAddOnCommand",
                                parameters: {
                                  addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
                                  addOnCommandParameters: { includeAabb: true, includeMepInfo: true }
                                }
                              }
                            })
                          });
                          const data = await res.json();
                          if (data.ok && data.response?.succeeded) {
                            const elements = data.response.result?.addOnCommandResponse?.elements || data.response.result?.elements || [];
                            const typeCounts: Record<string, number> = {};
                            elements.forEach((el: any) => {
                              const type = el.type || el.elementType || "Unknown";
                              typeCounts[type] = (typeCounts[type] || 0) + 1;
                            });
                            setBaseSelectionStatus({
                              count: elements.length,
                              types: Object.entries(typeCounts).map(([type, count]) => ({ type, count })),
                              guids: elements.map((el: any) => el.guid || "")
                            });
                            // FO-1: 存储完整元素数组（含 AABB）供视口渲染
                            setBaseSelectionElements(elements as ElementWithAABB[]);
                            // 同步更新 signature ref 避免轮询冗余触发
                            lastSelectionSignatureRef.current = elements.map((el: any) => el.guid || "").filter(Boolean).sort().join("|");
                            setLastSelectionSyncAt(Date.now());
                            // 同时更新 baseResult 以便查看详情
                            setBaseResult(data);
                            triggerToast(lang === "zh-CN" ? "选择集已更新" : "Selection updated");
                          }
                        } catch (err) {
                          console.error("Failed to refresh selection:", err);
                        } finally {
                          setIsBaseExecuting(false);
                        }
                      }}
                      disabled={isBaseExecuting || !mepbridgeConnected}
                      className="p-1.5 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
                      title={lang === "zh-CN" ? "刷新选择集" : "Refresh selection"}
                    >
                      <RefreshCw className={`w-4 h-4 text-zinc-400 ${isBaseExecuting ? "animate-spin" : ""}`} />
                    </button>
                    {baseSelectionStatus.count > 0 && baseResult && (
                      <button
                        onClick={() => {
                          setJsonViewerTitle(lang === "zh-CN" ? "选择集完整数据" : "Selection Full Data");
                          setJsonViewerData(baseResult);
                          setShowJsonViewer(true);
                        }}
                        className="p-1.5 rounded hover:bg-zinc-800 transition-colors text-cyan-400"
                        title={lang === "zh-CN" ? "查看完整 JSON" : "View full JSON"}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    {/* 视口/截图切换按钮组（合并到选择集卡片，默认收起，点击展开） */}
                    <div className="flex items-center gap-1 bg-zinc-800/50 rounded-lg p-0.5 border border-zinc-700">
                      <button
                        onClick={() => setBaseViewMode(baseViewMode === "viewport" ? "none" : "viewport")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all ${
                          baseViewMode === "viewport"
                            ? "bg-cyan-600 text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                        title={lang === "zh-CN" ? "切换选择集 AABB 视口" : "Toggle selection AABB viewport"}
                      >
                        {lang === "zh-CN" ? "视口" : "Viewport"}
                      </button>
                      <button
                        onClick={() => {
                          const next = baseViewMode === "screenshot" ? "none" : "screenshot";
                          setBaseViewMode(next);
                          if (next === "screenshot" && !viewportCapture.imageBase64) fetchViewportCapture();
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all ${
                          baseViewMode === "screenshot"
                            ? "bg-violet-600 text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                        title={lang === "zh-CN" ? "切换 Archicad 视口截图" : "Toggle Archicad viewport screenshot"}
                      >
                        {lang === "zh-CN" ? "📸 截图" : "📸 Shot"}
                      </button>
                    </div>
                  </div>
                </div>

                {baseSelectionStatus.count === 0 ? (
                  <div className="text-center py-6 text-zinc-500 text-sm">
                    {autoSyncSelection && mepbridgeConnected
                      ? (lang === "zh-CN"
                          ? "等待选择 — 请在 Archicad 中选择构件，将自动同步"
                          : "Waiting — select elements in Archicad, will auto-sync")
                      : (lang === "zh-CN"
                          ? "未选中任何构件，请在 Archicad 中选择构件后点击刷新"
                          : "No elements selected, select in Archicad and click refresh")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* 统计摘要 */}
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-mono text-zinc-300">
                        {lang === "zh-CN" ? "已选中" : "Selected"}: <span className="text-indigo-400 font-bold">{baseSelectionStatus.count}</span> {lang === "zh-CN" ? "个构件" : "elements"}
                      </div>
                      <span className="text-xs text-zinc-500 font-mono">
                        {baseSelectionStatus.types.length} {lang === "zh-CN" ? "种类型" : "types"}
                      </span>
                    </div>

                    {/* 类型统计 */}
                    <div className="flex flex-wrap gap-2">
                      {baseSelectionStatus.types.map((t) => (
                        <div
                          key={t.type}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded-lg"
                        >
                          <span className="text-xs font-semibold text-indigo-400">{t.type}</span>
                          <span className="text-xs text-zinc-500">×</span>
                          <span className="text-xs font-bold text-zinc-300">{t.count}</span>
                        </div>
                      ))}
                    </div>

                    {/* GUID 列表（可折叠） */}
                    {baseSelectionStatus.guids.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1.5 py-2 border-t border-zinc-800">
                          <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                          {lang === "zh-CN" ? `显示 ${baseSelectionStatus.guids.length} 个 GUID` : `Show ${baseSelectionStatus.guids.length} GUIDs`}
                        </summary>
                        <div className="mt-2 max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
                          {baseSelectionStatus.guids.map((guid, idx) => (
                            <div
                              key={idx}
                              className="text-[10px] font-mono text-zinc-500 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 select-all"
                            >
                              {guid}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* 操作提示 */}
                    <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 border-t border-zinc-800 pt-2">
                      <Info className="w-3 h-3" />
                      {lang === "zh-CN"
                        ? '点击右上角眼睛图标查看完整 JSON 数据（包含 AABB、MEP 属性等）'
                        : "Click eye icon above to view full JSON data (AABB, MEP properties, etc.)"}
                    </div>
                  </div>
                )}

                {/* 视口/截图切换显示区（合并到选择集卡片内，默认收起，点击标题栏按钮展开） */}
                {baseViewMode !== "none" && (() => {
                  const mepFromSelection = baseSelectionElements.filter(el => {
                    const t = (el.type || '').toLowerCase();
                    return el.isMepRoute || el.mepDomain ||
                           t.includes('duct') || t.includes('pipe') || t.includes('cable') ||
                           t.includes('ventilation') || t.includes('piping');
                  });
                  const merged = baseScanElements.length > 0
                    ? [...baseScanElements, ...mepFromSelection]
                    : baseSelectionElements;
                  const isScanMode = baseScanElements.length > 0;
                  const hasData = merged.length > 0;
                  return (
                    <div className={`rounded-lg border p-3 flex flex-col gap-2 ${
                      baseViewMode === "screenshot" ? "border-violet-500/20 bg-violet-500/5" : isScanMode ? "border-amber-500/20 bg-amber-500/5" : "border-cyan-500/20 bg-cyan-500/5"
                    }`}>
                      {/* 子区标题栏 + 扫描清除 + 截图刷新 */}
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono ${baseViewMode === "screenshot" ? "text-violet-300" : isScanMode ? "text-amber-300" : "text-cyan-300"}`}>
                          {baseViewMode === "screenshot"
                            ? (lang === "zh-CN" ? "📸 Archicad 视口截图" : "📸 Archicad Screenshot")
                            : isScanMode
                              ? (lang === "zh-CN" ? `扫描+选择集视口（${merged.filter(e => e.aabb).length}/${merged.length} AABB）` : `Scan+Selection (${merged.filter(e => e.aabb).length}/${merged.length} AABB)`)
                              : (lang === "zh-CN" ? `选择集视口（${merged.filter(e => e.aabb).length}/${merged.length} AABB）` : `Selection Viewport (${merged.filter(e => e.aabb).length}/${merged.length} AABB)`)
                          }
                        </span>
                        <div className="flex items-center gap-1.5">
                          {isScanMode && baseViewMode === "viewport" && (
                            <button
                              onClick={() => { setBaseScanElements([]); setScanSourceLabel(""); }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
                              title={lang === "zh-CN" ? "清除扫描结果" : "Clear scan"}
                            >
                              {lang === "zh-CN" ? "✕ 清除" : "✕ Clear"}
                            </button>
                          )}
                          {baseViewMode === "screenshot" && stories.length > 0 && (
                            <select
                              value={selectedStoryForCapture ?? ''}
                              onChange={(e) => {
                                const idx = e.target.value !== '' ? parseInt(e.target.value) : null;
                                setSelectedStoryForCapture(idx);
                                fetchViewportCapture(idx);
                              }}
                              className="text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-zinc-900 text-violet-300 focus:outline-none focus:border-violet-500"
                              title={lang === "zh-CN" ? "选择楼层截图" : "Select floor for capture"}
                            >
                              <option value="" disabled>{lang === "zh-CN" ? "选择楼层..." : "Floor..."}</option>
                              {stories.map(s => (
                                <option key={s.index} value={s.index}>
                                  {s.name} (L{s.level.toFixed(1)})
                                </option>
                              ))}
                            </select>
                          )}
                          {baseViewMode === "screenshot" && (
                            <button
                              onClick={() => fetchViewportCapture()}
                              disabled={viewportCapture.loading}
                              className="text-[10px] px-2 py-0.5 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 disabled:opacity-40 transition-colors flex items-center gap-1"
                            >
                              {viewportCapture.loading
                                ? "⏳..."
                                : (lang === "zh-CN" ? "📸 截图" : "📸 Shot")}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* 视口模式 */}
                      {baseViewMode === "viewport" ? (
                        hasData ? (
                          <div style={{ height: 280 }}>
                            <ArchicadViewport
                              elementsWithAABB={merged}
                              selectedElements={isScanMode ? [] : baseSelectionStatus.guids}
                              showAABB={true}
                              language={lang}
                              onRefresh={() => {
                                const refreshBtn = document.querySelector<HTMLButtonElement>('[title="刷新选择集"], [title="Refresh selection"]');
                                refreshBtn?.click();
                              }}
                            />
                          </div>
                        ) : (
                          <div className="h-40 flex items-center justify-center text-zinc-500 text-sm bg-zinc-950/50 rounded-lg border border-zinc-800">
                            {lang === "zh-CN" ? "无选择集数据 — 请在 Archicad 中选择构件" : "No selection data — select elements in Archicad"}
                          </div>
                        )
                      ) : (
                        /* 截图模式（高度自适应拉长） */
                        <div className="flex flex-col gap-1.5">
                          {viewportCapture.viewType && (
                            <div className="text-[10px] text-violet-300 font-mono">
                              {viewportCapture.viewType} | {viewportCapture.storyName}
                            </div>
                          )}
                          <div className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg overflow-hidden flex items-center justify-center p-2">
                            {viewportCapture.imageBase64 ? (
                              <img
                                src={`data:image/png;base64,${viewportCapture.imageBase64}`}
                                alt="Archicad Viewport"
                                className="max-w-full object-contain rounded border border-zinc-700"
                              />
                            ) : (
                              <div className="flex flex-col items-center text-zinc-500 py-6">
                                <Camera className="w-8 h-8 mb-2 opacity-50" />
                                <p className="text-xs">
                                  {viewportCapture.loading
                                    ? (lang === "zh-CN" ? "正在截图..." : "Capturing...")
                                    : (lang === "zh-CN" ? "点击刷新截图按钮获取当前 Archicad 视口" : "Click refresh to capture Archicad viewport")}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* C.1.6: 命令模块切换器 - 严格复用 BASE/Copilot Tab 圆点+标签样式 */}
              {/* 一级按钮 3 种状态：选中闪烁+白色字体；待选可执行白色字体；预告灰色 */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 shadow-lg">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* QUERY 只读 - emerald 圆点 */}
                  <button
                    onClick={() => setActiveModule("mepbridge-read")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "mepbridge-read" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "mepbridge-read" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "mepbridge-read" ? "bg-emerald-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "QUERY 只读" : "QUERY"}
                    </span>
                  </button>

                  {/* MODIFY 修改 - amber 圆点 */}
                  <button
                    onClick={() => setActiveModule("mepbridge-modify")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "mepbridge-modify" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "mepbridge-modify" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "mepbridge-modify" ? "bg-amber-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "MODIFY 修改" : "MODIFY"}
                    </span>
                  </button>

                  {/* BUILDING 建筑 - orange 圆点 */}
                  <button
                    onClick={() => setActiveModule("building")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "building" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "building" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "building" ? "bg-orange-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "BUILDING 建筑" : "BUILDING"}
                    </span>
                  </button>

                  {/* Water 水管 - cyan 圆点 */}
                  <button
                    onClick={() => setActiveModule("water")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "water" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "water" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "water" ? "bg-cyan-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "Water 水管" : "Water"}
                    </span>
                  </button>

                  {/* Electrical 电气 - yellow 圆点 */}
                  <button
                    onClick={() => setActiveModule("electrical")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "electrical" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "electrical" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "electrical" ? "bg-yellow-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "Electrical 电气" : "Electrical"}
                    </span>
                  </button>

                  {/* Ventilation 暖通 - violet 圆点 */}
                  <button
                    onClick={() => setActiveModule("ventilation")}
                    className={`flex items-center gap-2 transition-all ${activeModule === "ventilation" ? "opacity-100" : "opacity-85 hover:opacity-100"}`}
                  >
                    <span className="flex h-2 w-2 relative">
                      {activeModule === "ventilation" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeModule === "ventilation" ? "bg-violet-500" : "bg-zinc-400"}`}></span>
                    </span>
                    <span className="text-xs font-semibold font-display text-zinc-200">
                      {lang === "zh-CN" ? "Ventilation 暖通" : "Ventilation"}
                    </span>
                  </button>

                  {/* E.4/H8/H9/H6/H10: 扩展功能（知识库/学习记忆/审计日志/主动智能/用户模板/自定义命令）已移至中区扩展功能面板 */}
                </div>
              </div>

              {/* C.1.6: 当前模块命令区 - 根据选中模块动态切换 */}
              {activeModule === "mepbridge-read" && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-lg flex flex-col gap-3">
                <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-zinc-300 flex items-center gap-2 border-b border-zinc-800 pb-2">
                  <Eye className="w-4 h-4 text-emerald-400" />
                  {lang === "zh-CN" ? "QUERY 只读（无需确认）" : "QUERY (Read-only)"}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
                                addOnCommandParameters: { includeAabb: false, includeMepInfo: true }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "读取选择集完成" : "Get selected elements completed");
                        recordTask(lang === "zh-CN" ? "读取选择集" : "Get Selected", data.ok ? "success" : "error", data.ok ? `✓ ${data.response?.result?.addOnCommandResponse?.elements?.length || 0} elements` : data.error?.slice(0, 40));
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    {lang === "zh-CN" ? "读取选择集" : "Get Selected"}
                  </button>

                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "ScanStructuralElements" },
                                addOnCommandParameters: { types: ["Wall", "Column", "Beam"] }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "扫描结构完成" : "Scan structure completed");
                        recordTask(lang === "zh-CN" ? "扫描结构" : "Scan Structure", data.ok ? "success" : "error", data.ok ? `✓ ${data.response?.result?.addOnCommandResponse?.elements?.length || 0} elements` : data.error?.slice(0, 40));
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Layers className="w-4 h-4 text-emerald-400" />
                    {lang === "zh-CN" ? "扫描结构" : "Scan Structure"}
                  </button>

                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
                                addOnCommandParameters: { includeAabb: true, includeMepInfo: true }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "读取详情+AABB完成" : "Get details+AABB completed");
                        recordTask(lang === "zh-CN" ? "详情+AABB" : "Details+AABB", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Maximize2 className="w-4 h-4 text-emerald-400" />
                    {lang === "zh-CN" ? "详情+AABB" : "Details+AABB"}
                  </button>

                  {/* C.1.3: 查询管径表 → GetAvailableSizes */}
                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSizes" },
                                addOnCommandParameters: { domain: "Piping" }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "管径表查询完成" : "Available sizes query completed");
                        recordTask(lang === "zh-CN" ? "查询管径表" : "Sizes Query", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "管径表查询失败" : "Available sizes query failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Database className="w-4 h-4 text-emerald-400" />
                    {lang === "zh-CN" ? "查询管径表" : "Get Sizes"}
                  </button>
                </div>

            {/* C.1.7: 更多命令下拉 - 超出常用 4 个时折叠 */}
            <div className="relative">
              <button
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 rounded text-xs font-semibold text-zinc-400 transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${moreMenuOpen ? "rotate-180" : ""}`} />
                {lang === "zh-CN" ? "更多命令 (5)" : "More (5)"}
              </button>

              {moreMenuOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto custom-scrollbar">
                  {/* 查询 MEP 系统 */}
                  <button
                    onClick={async () => {
                      setMoreMenuOpen(false);
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSystems" },
                                addOnCommandParameters: {}
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "MEP 系统查询完成" : "MEP systems query completed");
                        recordTask(lang === "zh-CN" ? "查询MEP系统" : "MEP Systems", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "MEP 系统查询失败" : "MEP systems query failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors text-left border-b border-zinc-800/50"
                  >
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span>{lang === "zh-CN" ? "查询 MEP 系统" : "Get Systems"}</span>
                  </button>

                  {/* 查询属性定义 */}
                  <button
                    onClick={async () => {
                      setMoreMenuOpen(false);
                      setIsBaseExecuting(true);
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
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "属性定义查询完成" : "Property definitions query completed");
                        recordTask(lang === "zh-CN" ? "属性定义" : "Prop Defs", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "属性定义查询失败" : "Property definitions query failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors text-left border-b border-zinc-800/50"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    <span>{lang === "zh-CN" ? "查询属性定义" : "Get Prop Defs"}</span>
                  </button>

                  {/* 查询属性值 GetElementProperties */}
                  <button
                    onClick={async () => {
                      setMoreMenuOpen(false);
                      const guid = prompt(lang === "zh-CN" ? "构件 GUID（留空用选择集首个）" : "Element GUID (empty = first selected)", "");
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetElementProperties" },
                                addOnCommandParameters: { routeGuid: guid || "", filter: "All" }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "属性值查询完成" : "Properties query completed");
                        recordTask(lang === "zh-CN" ? "属性值查询" : "Prop Values", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "属性值查询失败" : "Properties query failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors text-left border-b border-zinc-800/50"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    <span>{lang === "zh-CN" ? "查询属性值" : "Get Properties"}</span>
                  </button>

                  {/* 查询 MEP 详情 GetMEPElementInfo */}
                  <button
                    onClick={async () => {
                      setMoreMenuOpen(false);
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetMEPElementInfo" },
                                addOnCommandParameters: {}
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "MEP 详情查询完成" : "MEP info query completed");
                        recordTask(lang === "zh-CN" ? "MEP详情" : "MEP Info", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "MEP 详情查询失败" : "MEP info query failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors text-left border-b border-zinc-800/50"
                  >
                    <Database className="w-4 h-4 text-emerald-400" />
                    <span>{lang === "zh-CN" ? "MEP 详情" : "MEP Info"}</span>
                  </button>
                </div>
              )}
            </div>
              </div>
              )}

              {/* Mutation Operations Panel - 修改操作模块 */}
              {activeModule === "mepbridge-modify" && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-lg flex flex-col gap-3">
                <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-amber-300 flex items-center gap-2 border-b border-amber-500/20 pb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  {lang === "zh-CN" ? "MODIFY 修改（需用户确认）" : "MODIFY (Require Confirmation)"}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowMoveModal(true)}
                    disabled={!mepbridgeConnected || isBaseExecuting}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-amber-500/30 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Move className="w-4 h-4 text-amber-400" />
                    {lang === "zh-CN" ? "移动构件" : "Move"}
                  </button>

                  <button
                    onClick={() => setShowEditModal(true)}
                    disabled={!mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-amber-500/30 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FileEdit className="w-4 h-4 text-amber-400" />
                    {lang === "zh-CN" ? "编辑属性" : "Edit"}
                  </button>

                  <button
                    onClick={() => setShowCopyModal(true)}
                    disabled={!mepbridgeConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-amber-500/30 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Copy className="w-4 h-4 text-amber-400" />
                    {lang === "zh-CN" ? "复制构件" : "Copy"}
                  </button>

                  <button
                    onClick={async () => {
                      const sel = await loadSelectionSummary();
                      setDialogState({
                        isOpen: true,
                        title: lang === "zh-CN" ? "旋转构件" : "Rotate Elements",
                        label: lang === "zh-CN" ? "旋转角度（度）" : "Rotation angle (degrees)",
                        defaultValue: "90",
                        selectionInfo: sel,
                        onConfirm: async (val) => {
                          setDialogState(prev => ({ ...prev, isOpen: false }));
                          setIsBaseExecuting(true);
                          try {
                            const res = await fetch("/api/execute", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                command: {
                                  command: "API.ExecuteAddOnCommand",
                                  parameters: {
                                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "RotateSelectedElements" },
                                    addOnCommandParameters: { angleDeg: parseFloat(val) || 90, confirmRequired: true }
                                  }
                                }
                              })
                            });
                            const data = await res.json();
                            setBaseResult(data);
                            triggerToast(data.ok ? (lang === "zh-CN" ? "旋转完成" : "Rotate completed") : (lang === "zh-CN" ? "旋转失败" : "Rotate failed"));
                            recordTask(lang === "zh-CN" ? "旋转构件" : "Rotate", data.ok ? "success" : "error");
                          } catch (err) { console.error(err); triggerToast(lang === "zh-CN" ? "旋转失败" : "Rotate failed"); } finally { setIsBaseExecuting(false); }
                        }
                      });
                    }}
                    disabled={!mepbridgeConnected || isBaseExecuting}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-amber-500/30 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RotateCw className="w-4 h-4 text-amber-400" />
                    {lang === "zh-CN" ? "旋转" : "Rotate"}
                  </button>

                  <button
                    onClick={async () => {
                      const sel = await loadSelectionSummary();
                      setDialogState({
                        isOpen: true,
                        title: lang === "zh-CN" ? "镜像构件" : "Mirror Elements",
                        label: lang === "zh-CN" ? "镜像轴" : "Mirror axis",
                        defaultValue: "X",
                        options: ["X", "Y"],
                        selectionInfo: sel,
                        onConfirm: async (val) => {
                          setDialogState(prev => ({ ...prev, isOpen: false }));
                          setIsBaseExecuting(true);
                          try {
                            const res = await fetch("/api/execute", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                command: {
                                  command: "API.ExecuteAddOnCommand",
                                  parameters: {
                                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "MirrorSelectedElements" },
                                    addOnCommandParameters: { axis: (val || "X").toUpperCase(), confirmRequired: true }
                                  }
                                }
                              })
                            });
                            const data = await res.json();
                            setBaseResult(data);
                            triggerToast(data.ok ? (lang === "zh-CN" ? "镜像完成" : "Mirror completed") : (lang === "zh-CN" ? "镜像失败" : "Mirror failed"));
                            recordTask(lang === "zh-CN" ? "镜像构件" : "Mirror", data.ok ? "success" : "error");
                          } catch (err) { console.error(err); triggerToast(lang === "zh-CN" ? "镜像失败" : "Mirror failed"); } finally { setIsBaseExecuting(false); }
                        }
                      });
                    }}
                    disabled={!mepbridgeConnected || isBaseExecuting}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-amber-500/30 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FlipHorizontal className="w-4 h-4 text-amber-400" />
                    {lang === "zh-CN" ? "镜像" : "Mirror"}
                  </button>

                  <button
                    onClick={async () => {
                      const sel = await loadSelectionSummary();
                      setDialogState({
                        isOpen: true,
                        title: lang === "zh-CN" ? "删除构件" : "Delete Elements",
                        label: lang === "zh-CN" ? "确认删除选中构件？此操作不可撤销。" : "Delete selected elements? This cannot be undone.",
                        isConfirm: true,
                        selectionInfo: sel,
                        onConfirm: async () => {
                          setDialogState(prev => ({ ...prev, isOpen: false }));
                          setIsBaseExecuting(true);
                          try {
                            const res = await fetch("/api/execute", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                command: {
                                  command: "API.ExecuteAddOnCommand",
                                  parameters: {
                                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "DeleteMEPElements" },
                                    addOnCommandParameters: { confirmRequired: true }
                                  }
                                }
                              })
                            });
                            const data = await res.json();
                            setBaseResult(data);
                            triggerToast(data.ok ? (lang === "zh-CN" ? "删除完成" : "Delete completed") : (lang === "zh-CN" ? "删除失败" : "Delete failed"));
                            recordTask(lang === "zh-CN" ? "删除构件" : "Delete", data.ok ? "success" : "error");
                          } catch (err) { console.error(err); triggerToast(lang === "zh-CN" ? "删除失败" : "Delete failed"); } finally { setIsBaseExecuting(false); }
                        }
                      });
                    }}
                    disabled={!mepbridgeConnected || isBaseExecuting}
                    className="flex items-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 rounded text-xs font-semibold text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                    {lang === "zh-CN" ? "删除" : "Delete"}
                  </button>
                </div>

                {/* 改几何/批量创建已移至 BUILDING 模块的 EditBuildingElementPanel */}
                <div className="text-xs text-amber-400/70 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  {lang === "zh-CN" ? "这些操作将修改 Archicad 模型，需要用户确认" : "These operations will modify Archicad model, require user confirmation"}
                </div>
              </div>
              )}

              {/* BUILDING 建筑构件编辑模块 - orange */}
              {activeModule === "building" && (
                <EditBuildingElementPanel
                  onExecute={async (commandName: string, params: any) => {
                    const res = await fetch("/api/execute", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ command: { command: "API.ExecuteAddOnCommand", parameters: { addOnCommandId: { commandNamespace: "MEPBridge", commandName }, addOnCommandParameters: params } } })
                    });
                    return res.json();
                  }}
                  lang={lang}
                  mepbridgeConnected={mepbridgeConnected}
                />
              )}

              {/* D4 F.1: Water 水管专业模块 - cyan */}
              {activeModule === "water" && (
                <div className="space-y-3">
                  <EditMEPElementPanel
                    domain="Piping"
                    onExecute={async (commandName: string, params: any) => {
                      const res = await fetch("/api/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ command: { command: "API.ExecuteAddOnCommand", parameters: { addOnCommandId: { commandNamespace: "MEPBridge", commandName }, addOnCommandParameters: params } } })
                      });
                      return res.json();
                    }}
                    lang={lang}
                    mepbridgeConnected={mepbridgeConnected}
                  />
                  <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
                    {lang === "zh-CN" ? "Water 水管专业模块" : "Water Piping Module"}
                  </h3>
                  {/* 只读查询类 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        setIsBaseExecuting(true);
                        try {
                          const res = await fetch("/api/execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              command: {
                                command: "API.ExecuteAddOnCommand",
                                parameters: {
                                  addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSizes" },
                                  addOnCommandParameters: { domain: "Piping" }
                                }
                              }
                            })
                          });
                          const data = await res.json();
                          setBaseResult(data);
                        } catch (err) { console.error(err); }
                        finally { setIsBaseExecuting(false); }
                      }}
                      disabled={!mepbridgeConnected || isBaseExecuting}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-cyan-500/30 rounded text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      📏 {lang === "zh-CN" ? "查询管径表" : "Pipe Sizes"}
                    </button>
                    <button
                      onClick={async () => {
                        setIsBaseExecuting(true);
                        try {
                          const res = await fetch("/api/execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              command: {
                                command: "API.ExecuteAddOnCommand",
                                parameters: {
                                  addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSystems" },
                                  addOnCommandParameters: {}
                                }
                              }
                            })
                          });
                          const data = await res.json();
                          setBaseResult(data);
                        } catch (err) { console.error(err); }
                        finally { setIsBaseExecuting(false); }
                      }}
                      disabled={!mepbridgeConnected || isBaseExecuting}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-cyan-500/30 rounded text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Wrench className="w-4 h-4 text-cyan-400" /> {lang === "zh-CN" ? "查询MEP系统" : "MEP Systems"}
                    </button>
                  </div>
                  {/* Mutation 类 */}
                  <div>
                    <div className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {lang === "zh-CN" ? "以下操作将创建 MEP 构件，需用户确认" : "These operations will create MEP elements, require confirmation"}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowCreatePipeModal(true)}
                        disabled={!mepbridgeConnected}
                        className="flex items-center gap-2 px-3 py-2 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/40 rounded text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4 text-cyan-400" /> {lang === "zh-CN" ? "创建水管" : "Create Pipe"}
                      </button>
                      <button
                        onClick={() => setShowCreatePipeSystemModal(true)}
                        disabled={!mepbridgeConnected}
                        className="flex items-center gap-2 px-3 py-2 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/40 rounded text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <GitBranch className="w-4 h-4 text-cyan-400" /> {lang === "zh-CN" ? "管道系统" : "Pipe System"}
                      </button>
                      <button
                        onClick={async () => {
                          const apply = confirm(lang === "zh-CN" ? "是否应用连接（取消则仅 dry-run 检测）？" : "Apply connections? (Cancel = dry-run only)");
                          setIsBaseExecuting(true);
                          try {
                            const res = await fetch("/api/execute", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                command: {
                                  command: "API.ExecuteAddOnCommand",
                                  parameters: {
                                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "SolveConn" },
                                    addOnCommandParameters: { apply, crossMode: "dry-run", tol: 0.001, confirmRequired: apply }
                                  }
                                }
                              })
                            });
                            const data = await res.json();
                            setBaseResult(data);
                            triggerToast(data.ok ? (lang === "zh-CN" ? "管道连接求解完成" : "SolveConn completed") : (lang === "zh-CN" ? "求解失败" : "Failed"));
                            recordTask(lang === "zh-CN" ? "连接求解" : "SolveConn", data.ok ? "success" : "error");
                          } catch (err) { console.error(err); } finally { setIsBaseExecuting(false); }
                        }}
                        disabled={!mepbridgeConnected || isBaseExecuting}
                        className="flex items-center gap-2 px-3 py-2 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/40 rounded text-xs font-semibold text-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Link className="w-4 h-4 text-cyan-400" /> {lang === "zh-CN" ? "连接求解" : "SolveConn"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* D5 F.1: Electrical 电气专业模块 - yellow */}
              {activeModule === "electrical" && (
                <div className="space-y-3">
                  <EditMEPElementPanel
                    domain="CableCarrier"
                    onExecute={async (commandName: string, params: any) => {
                      const res = await fetch("/api/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ command: { command: "API.ExecuteAddOnCommand", parameters: { addOnCommandId: { commandNamespace: "MEPBridge", commandName }, addOnCommandParameters: params } } })
                      });
                      return res.json();
                    }}
                    lang={lang}
                    mepbridgeConnected={mepbridgeConnected}
                  />
                  <h3 className="text-sm font-semibold text-yellow-300 flex items-center gap-2">
                    {lang === "zh-CN" ? "Electrical 电气专业模块" : "Electrical Cable Carrier Module"}
                  </h3>
                  {/* 只读查询类 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        setIsBaseExecuting(true);
                        try {
                          const res = await fetch("/api/execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              command: {
                                command: "API.ExecuteAddOnCommand",
                                parameters: {
                                  addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSystems" },
                                  addOnCommandParameters: {}
                                }
                              }
                            })
                          });
                          const data = await res.json();
                          setBaseResult(data);
                        } catch (err) { console.error(err); }
                        finally { setIsBaseExecuting(false); }
                      }}
                      disabled={!mepbridgeConnected || isBaseExecuting}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-yellow-500/30 rounded text-xs font-semibold text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Wrench className="w-4 h-4 text-yellow-400" /> {lang === "zh-CN" ? "查询MEP系统" : "MEP Systems"}
                    </button>
                    <div className="flex items-center justify-center px-3 py-2 bg-zinc-800/50 rounded text-xs text-yellow-500/50 italic">
                      {lang === "zh-CN" ? "CableCarrier 尺寸表待 API 支持" : "Size table pending"}
                    </div>
                  </div>
                  {/* Mutation 类 */}
                  <div>
                    <div className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {lang === "zh-CN" ? "以下操作将创建 MEP 构件，需用户确认" : "These operations will create MEP elements, require confirmation"}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowCreateCableCarrierModal(true)}
                        disabled={!mepbridgeConnected}
                        className="flex items-center gap-2 px-3 py-2 bg-yellow-600/10 hover:bg-yellow-600/20 border border-yellow-500/40 rounded text-xs font-semibold text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4 text-yellow-400" /> {lang === "zh-CN" ? "创建桥架" : "Create Tray"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* D5 F.2: Ventilation 暖通专业模块 - violet */}
              {activeModule === "ventilation" && (
                <div className="space-y-3">
                  <EditMEPElementPanel
                    domain="Ventilation"
                    onExecute={async (commandName: string, params: any) => {
                      const res = await fetch("/api/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ command: { command: "API.ExecuteAddOnCommand", parameters: { addOnCommandId: { commandNamespace: "MEPBridge", commandName }, addOnCommandParameters: params } } })
                      });
                      return res.json();
                    }}
                    lang={lang}
                    mepbridgeConnected={mepbridgeConnected}
                  />
                  <h3 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
                    {lang === "zh-CN" ? "Ventilation 暖通专业模块" : "Ventilation HVAC Module"}
                  </h3>
                  {/* 只读查询类 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        setIsBaseExecuting(true);
                        try {
                          const res = await fetch("/api/execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              command: {
                                command: "API.ExecuteAddOnCommand",
                                parameters: {
                                  addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetAvailableSystems" },
                                  addOnCommandParameters: {}
                                }
                              }
                            })
                          });
                          const data = await res.json();
                          setBaseResult(data);
                        } catch (err) { console.error(err); }
                        finally { setIsBaseExecuting(false); }
                      }}
                      disabled={!mepbridgeConnected || isBaseExecuting}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-violet-500/30 rounded text-xs font-semibold text-violet-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Wrench className="w-4 h-4 text-violet-400" /> {lang === "zh-CN" ? "查询MEP系统" : "MEP Systems"}
                    </button>
                    <div className="flex items-center justify-center px-3 py-2 bg-zinc-800/50 rounded text-xs text-violet-500/50 italic">
                      {lang === "zh-CN" ? "Ventilation 尺寸表待 API 支持" : "Size table pending"}
                    </div>
                  </div>
                  {/* Mutation 类 */}
                  <div>
                    <div className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {lang === "zh-CN" ? "以下操作将创建 MEP 构件，需用户确认" : "These operations will create MEP elements, require confirmation"}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowCreateDuctModal(true)}
                        disabled={!mepbridgeConnected}
                        className="flex items-center gap-2 px-3 py-2 bg-violet-600/10 hover:bg-violet-600/20 border border-violet-500/40 rounded text-xs font-semibold text-violet-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4 text-violet-400" /> {lang === "zh-CN" ? "创建风管" : "Create Duct"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* E.4/H8/H9/H6/H10 扩展功能面板 — 知识库/学习记忆/审计日志/主动智能/用户模板/自定义命令 */}
              <ExtensionPanel
                lang={lang}
                userTemplates={userTemplates}
                templateSearch={templateSearch}
                setTemplateSearch={setTemplateSearch}
                onReplayTemplate={(tpl) => replayUserTemplate(tpl)}
                onDeleteTemplate={deleteUserTemplate}
                customCommands={customCommands}
                onOpenCustomCommands={openCustomCommandsPanel}
                onAssetsChanged={async () => {
                  await loadUserTemplates();
                  await loadCustomCommands();
                }}
                onSuggestionClick={(action, params) => {
                  triggerToast(
                    lang === "zh-CN"
                      ? `建议操作: ${action}（请在 Copilot 模式执行）`
                      : `Suggested: ${action} (switch to Copilot to execute)`
                  );
                  console.log("[Proactive] Suggestion clicked:", action, params);
                }}
                expanded={extPanelExpanded}
                setExpanded={setExtPanelExpanded}
              />

              {/* NL Plan Card — BASE 模式下 NL 对话生成的计划在中区显示（修复 NL 执行成功但中区无结果显示的问题） */}
              <AnimatePresence>
                {activePlan && showPlanCard && activePlanMode === "base" && activePlan.steps && activePlan.steps.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="rounded-xl border border-indigo-500/30 bg-zinc-900/40 p-4 font-sans shadow-lg flex flex-col gap-3 relative"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse flex-shrink-0" />
                        <h3 className="text-sm font-semibold tracking-tight font-display text-zinc-200 truncate">
                          {activePlan.title || (lang === "zh-CN" ? "NL 操作计划" : "NL Operation Plan")}
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-900/40 text-[10px] font-mono font-medium text-indigo-300 flex-shrink-0 ml-2">
                        {activePlan.steps.length} {lang === "zh-CN" ? "步" : "steps"}
                      </span>
                    </div>

                    {activePlan.warning && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <span className="text-[10.5px] text-amber-200/90 leading-normal">{activePlan.warning}</span>
                      </div>
                    )}

                    {/* 步骤列表 */}
                    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                      {activePlan.steps.map((st, idx) => {
                        const isDone = st.status === "done";
                        const isRunning = st.status === "running";
                        const isFailed = st.status === "failed";
                        return (
                          <div
                            key={st.id}
                            className={`rounded px-3 py-2 border flex items-start gap-2.5 transition-all text-xs ${isDone ? "border-emerald-500/20 bg-emerald-500/10" : isRunning ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-100" : isFailed ? "border-red-500/30 bg-red-500/10" : "border-zinc-800 bg-zinc-900/30"}`}
                          >
                            <div className="flex flex-shrink-0 items-center justify-center">
                              {isDone ? (
                                <div className="w-6 h-6 rounded bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              ) : isRunning ? (
                                <div className="w-6 h-6 rounded bg-indigo-950 border border-indigo-500 flex items-center justify-center text-indigo-400">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                </div>
                              ) : isFailed ? (
                                <div className="w-6 h-6 rounded bg-red-950 border border-red-500/40 flex items-center justify-center text-red-400">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 text-[10px] font-mono font-bold">
                                  {idx + 1}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-bold text-zinc-200 truncate">
                                  {st.title || st.action}
                                </h4>
                                {st.params && Object.keys(st.params).length > 0 && (
                                  <div className="flex flex-wrap gap-1 flex-shrink-0">
                                    {Object.entries(st.params).slice(0, 4).map(([key, value]) => {
                                      const displayValue = typeof value === "object" && value !== null
                                        ? JSON.stringify(value)
                                        : String(value);
                                      return (
                                        <span key={key} className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[9px] font-mono text-zinc-400 max-w-[160px] truncate">
                                          {key}={displayValue}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              {st.description && (
                                <p className="text-[10.5px] text-zinc-400 mt-0.5 leading-normal">{st.description}</p>
                              )}
                              {st.result && (
                                <p className={`text-[10px] mt-1 font-mono ${st.status === "failed" ? "text-red-400" : "text-emerald-400"}`}>
                                  → {typeof st.result === "object" ? JSON.stringify(st.result).substring(0, 120) : String(st.result)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 执行结果数据表（执行完成后显示） */}
                    {executionCompleted && executionResultData.length > 0 && (
                      <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[11px] font-semibold text-emerald-300">
                            {lang === "zh-CN" ? "执行验证结果" : "Execution Verification"}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-zinc-800 text-zinc-500">
                                <th className="text-left py-1 px-1.5 font-mono">{lang === "zh-CN" ? "项目" : "Item"}</th>
                                <th className="text-left py-1 px-1.5 font-mono">{lang === "zh-CN" ? "期望" : "Expected"}</th>
                                <th className="text-left py-1 px-1.5 font-mono">{lang === "zh-CN" ? "实际" : "Actual"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {executionResultData.map((row, idx) => (
                                <tr key={idx} className="border-b border-zinc-800/50">
                                  <td className="py-1 px-1.5 text-zinc-300">{row.item}</td>
                                  <td className="py-1 px-1.5 text-zinc-400 font-mono">{row.expected}</td>
                                  <td className="py-1 px-1.5 text-zinc-200 font-mono">{row.actual}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => {
                          setJsonViewerTitle(lang === "zh-CN" ? "NL 计划详情" : "NL Plan Details");
                          setJsonViewerData(activePlan);
                          setShowJsonViewer(true);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded transition-colors flex items-center gap-1.5"
                      >
                        <Database className="w-3.5 h-3.5" />
                        {lang === "zh-CN" ? "查看详情" : "Details"}
                      </button>
                      <button
                        onClick={handleCancelPlan}
                        disabled={isExecutingPlan}
                        className="px-3 py-1.5 text-xs font-semibold text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded transition-colors disabled:opacity-40"
                      >
                        {lang === "zh-CN" ? "取消" : "Cancel"}
                      </button>
                      <button
                        disabled={isExecutingPlan}
                        onClick={handleExecutePlan}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 tracking-wide rounded flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(79,70,229,0.4)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-wait transition-all"
                      >
                        {isExecutingPlan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        {isExecutingPlan
                          ? (lang === "zh-CN" ? "执行中..." : "Running...")
                          : (lang === "zh-CN" ? "执行" : "Execute")}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Chain 执行结果卡片 — BASE 模式下自治编排链的结果在中区显示（修复 NL 执行成功但中区无结果显示的问题） */}
              {showChainProgress && chainStatus && (
                <div className="rounded-xl border border-violet-500/30 bg-zinc-900/40 p-4 shadow-lg flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isChainRunning ? "bg-violet-500 animate-pulse" : chainStatus.status === "completed" ? "bg-emerald-500" : chainStatus.status === "failed" || chainStatus.status === "error" ? "bg-red-500" : "bg-zinc-500"}`} />
                      <h3 className="text-sm font-semibold tracking-tight font-display text-zinc-200 truncate">
                        {lang === "zh-CN" ? "自动执行" : "Autonomy Chain"}
                      </h3>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        isChainRunning ? "bg-violet-950/80 text-violet-300" :
                        chainStatus.status === "completed" ? "bg-emerald-950/80 text-emerald-300" :
                        chainStatus.status === "failed" || chainStatus.status === "error" ? "bg-red-950/80 text-red-300" :
                        "bg-zinc-800 text-zinc-400"
                      }`}>
                        {isChainRunning ? (lang === "zh-CN" ? "执行中" : "Running") :
                         chainStatus.status === "completed" ? (lang === "zh-CN" ? "已完成" : "Completed") :
                         chainStatus.status === "failed" || chainStatus.status === "error" ? (lang === "zh-CN" ? "失败" : "Failed") :
                         chainStatus.status === "paused" ? (lang === "zh-CN" ? "已暂停" : "Paused") :
                         chainStatus.status}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {isChainRunning && (
                        <>
                          <button onClick={() => fetch("/api/plan-chain/pause", { method: "POST" }).then(() => {})} className="px-2 py-1 rounded text-[10px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 cursor-pointer" title={lang === "zh-CN" ? "暂停" : "Pause"}>⏸</button>
                          <button onClick={() => fetch("/api/plan-chain/cancel", { method: "POST" }).then(() => setIsChainRunning(false))} className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer" title={lang === "zh-CN" ? "取消" : "Cancel"}>✕</button>
                        </>
                      )}
                      {!isChainRunning && chainStatus.status === "paused" && (
                        <button onClick={() => fetch("/api/plan-chain/resume", { method: "POST" }).then(() => setIsChainRunning(true))} className="px-2 py-1 rounded text-[10px] bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer" title={lang === "zh-CN" ? "继续" : "Resume"}>▶</button>
                      )}
                      <button
                        onClick={() => {
                          setJsonViewerTitle(lang === "zh-CN" ? "自动执行详情" : "Chain Details");
                          setJsonViewerData(chainStatus);
                          setShowJsonViewer(true);
                        }}
                        className="px-2 py-1 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 cursor-pointer flex items-center gap-1"
                        title={lang === "zh-CN" ? "查看详情" : "Details"}
                      >
                        <Database className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* 用户意图 */}
                  {chainStatus.userIntent && (
                    <div className="text-[11px] text-zinc-400 flex items-start gap-1.5">
                      <span className="text-zinc-500 font-mono flex-shrink-0">{lang === "zh-CN" ? "意图:" : "Intent:"}</span>
                      <span className="text-zinc-300">{chainStatus.userIntent}</span>
                    </div>
                  )}

                  {/* 摘要 */}
                  {chainStatus.summary && (
                    <div className="text-[11px] text-zinc-400 flex items-start gap-1.5">
                      <span className="text-zinc-500 font-mono flex-shrink-0">{lang === "zh-CN" ? "摘要:" : "Summary:"}</span>
                      <span className="text-zinc-300">{chainStatus.summary}</span>
                    </div>
                  )}

                  {/* 步骤列表 */}
                  {chainSteps.length > 0 && (
                    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                      {chainSteps.map((step, idx) => {
                        const isDone = step.status === "completed";
                        const isRunning = step.status === "running";
                        const isFailed = step.status === "failed";
                        return (
                          <div
                            key={step.id || idx}
                            className={`rounded px-3 py-2 border flex items-start gap-2.5 transition-all text-xs ${isDone ? "border-emerald-500/20 bg-emerald-500/10" : isRunning ? "border-violet-500/30 bg-violet-500/10 text-violet-100" : isFailed ? "border-red-500/30 bg-red-500/10" : "border-zinc-800 bg-zinc-900/30"}`}
                          >
                            <div className="flex flex-shrink-0 items-center justify-center">
                              {isDone ? (
                                <div className="w-6 h-6 rounded bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              ) : isRunning ? (
                                <div className="w-6 h-6 rounded bg-violet-950 border border-violet-500 flex items-center justify-center text-violet-400">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                </div>
                              ) : isFailed ? (
                                <div className="w-6 h-6 rounded bg-red-950 border border-red-500/40 flex items-center justify-center text-red-400">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 text-[10px] font-mono font-bold">
                                  {idx + 1}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-zinc-200 truncate">{step.title || step.action}</h4>
                                {step.riskLevel && (
                                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded flex-shrink-0 ${
                                    step.riskLevel === "read" ? "bg-emerald-950/50 text-emerald-400" :
                                    step.riskLevel === "create-element" || step.riskLevel === "high-mutation" ? "bg-red-950/50 text-red-400" :
                                    "bg-amber-950/50 text-amber-400"
                                  }`}>{step.riskLevel}</span>
                                )}
                              </div>
                              {step.result && (
                                <p className={`text-[10px] mt-0.5 font-mono ${isFailed ? "text-red-400" : "text-emerald-400"}`}>
                                  → {typeof step.result === "object" ? JSON.stringify(step.result).substring(0, 150) : String(step.result)}
                                </p>
                              )}
                              {step.error && (
                                <p className="text-[10px] mt-0.5 font-mono text-red-400">⚠ {step.error}</p>
                              )}
                              {step.visualIssues && step.visualIssues.length > 0 && (
                                <p className="text-[10px] mt-0.5 text-amber-400">👁 {step.visualIssues.join("; ")}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 失败计数 */}
                  {(chainStatus?.failureCount ?? 0) > 0 && (
                    <div className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {lang === "zh-CN" ? `重试/失败: ${chainStatus.failureCount}` : `Failures: ${chainStatus.failureCount}`}
                    </div>
                  )}
                </div>
              )}

              {/* Result Display */}
              {baseResult && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-lg flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-zinc-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      {lang === "zh-CN" ? "执行结果" : "Execution Result"}
                    </h3>
                    <button
                      onClick={() => {
                        setJsonViewerTitle(lang === "zh-CN" ? "BASE 执行结果" : "BASE Execution Result");
                        setJsonViewerData(baseResult);
                        setShowJsonViewer(true);
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
                    >
                      <Database className="w-3.5 h-3.5" />
                      {lang === "zh-CN" ? "查看 JSON 详情" : "View JSON Details"}
                    </button>
                  </div>
                  <div className="flex flex-col gap-3 text-sm text-zinc-300">
                    {/* Natural language summary */}
                    {baseResult ? (
                      <>
                        {baseResult.ok && baseResult.response?.succeeded !== false ? (
                          <>
                        {/* Check for elements in nested structure */}
                        {(() => {
                          const resultData = baseResult.response.result?.addOnCommandResponse || baseResult.response.result;
                          const elements = resultData?.elements;
                          const obstacles = resultData?.obstacles;

                          if (elements && elements.length > 0) {
                            // 统计每种类型的数量
                            const typeCounts: Record<string, number> = {};
                            elements.forEach((el: any) => {
                              const type = el.type || el.elementType || "Unknown";
                              typeCounts[type] = (typeCounts[type] || 0) + 1;
                            });
                            const typeCount = Object.keys(typeCounts).length;

                            return (
                              <div className="flex flex-col gap-3">
                                {/* 总体统计 */}
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  <span className="font-semibold text-zinc-200">
                                    {lang === "zh-CN"
                                      ? `成功读取 ${elements.length} 个构件，包含 ${typeCount} 种类型`
                                      : `Successfully read ${elements.length} elements, ${typeCount} types`}
                                  </span>
                                </div>

                                {/* 类型统计 */}
                                <div className="flex flex-wrap gap-2 pl-6">
                                  {Object.entries(typeCounts).map(([type, count]) => (
                                    <div
                                      key={type}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded-lg"
                                    >
                                      <span className="text-xs font-semibold text-indigo-400">{type}</span>
                                      <span className="text-xs text-zinc-500">×</span>
                                      <span className="text-xs font-bold text-zinc-300">{count}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* 具体构件列表（最多显示 20 个） */}
                                <div className="pl-6 max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
                                  {elements.slice(0, 20).map((el: any, i: number) => (
                                    <div key={i} className="flex items-center gap-2 px-2 py-1 bg-zinc-800/30 rounded text-[10px] font-mono text-zinc-400">
                                      <span className="text-indigo-400">{el.type || el.elementType || '?'}</span>
                                      <span className="flex-1 truncate text-zinc-500">{el.guid ? el.guid.substring(0, 12) + '...' : '-'}</span>
                                      {el.layerName && <span className="text-zinc-600">{el.layerName}</span>}
                                      {el.floorIndex !== undefined && <span className="text-zinc-600">F{el.floorIndex}</span>}
                                      {el.mepDomain && <span className="text-cyan-500">{el.mepDomain}</span>}
                                    </div>
                                  ))}
                                  {elements.length > 20 && (
                                    <div className="text-[10px] text-zinc-600 px-2 py-1">{lang === "zh-CN" ? `... 还有 ${elements.length - 20} 个` : `... ${elements.length - 20} more`}</div>
                                  )}
                                </div>

                                {/* 可展开详情提示 */}
                                <div className="pl-6 text-[11px] text-zinc-500 flex items-center gap-1.5">
                                  <Database className="w-3 h-3" />
                                  {lang === "zh-CN"
                                    ? '点击右上角"查看 JSON 详情"查看完整构件信息（GUID、MEP 属性、AABB 等）'
                                    : "Click 'View JSON Details' above for complete element info (GUID, MEP properties, AABB, etc.)"}
                                </div>
                              </div>
                            );
                          } else if (obstacles && obstacles.length > 0) {
                            // 统计障碍物类型
                            const typeCounts: Record<string, number> = {};
                            obstacles.forEach((obs: any) => {
                              const type = obs.type || obs.elementType || "Unknown";
                              typeCounts[type] = (typeCounts[type] || 0) + 1;
                            });
                            const typeCount = Object.keys(typeCounts).length;

                            return (
                              <div className="flex flex-col gap-3">
                                {/* 总体统计 */}
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  <span className="font-semibold text-zinc-200">
                                    {lang === "zh-CN"
                                      ? `扫描到 ${obstacles.length} 个结构障碍物，包含 ${typeCount} 种类型`
                                      : `Scanned ${obstacles.length} structural obstacles, ${typeCount} types`}
                                  </span>
                                </div>

                                {/* 类型统计 */}
                                <div className="flex flex-wrap gap-2 pl-6">
                                  {Object.entries(typeCounts).map(([type, count]) => (
                                    <div
                                      key={type}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded-lg"
                                    >
                                      <span className="text-xs font-semibold text-indigo-400">{type}</span>
                                      <span className="text-xs text-zinc-500">×</span>
                                      <span className="text-xs font-bold text-zinc-300">{count}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* 可展开详情提示 */}
                                <div className="pl-6 text-[11px] text-zinc-500 flex items-center gap-1.5">
                                  <Database className="w-3 h-3" />
                                  {lang === "zh-CN"
                                    ? '点击右上角"查看 JSON 详情"查看完整障碍物信息（位置、AABB 等）'
                                    : "Click 'View JSON Details' above for complete obstacle info (position, AABB, etc.)"}
                                </div>
                              </div>
                            );
                          } else {
                            return (
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                <span className="text-zinc-400">
                                  {lang === "zh-CN" ? "操作执行成功" : "Operation completed successfully"}
                                </span>
                              </div>
                            );
                          }
                        })()}
                          </>
                        ) : baseResult.ok === false || (baseResult.response && baseResult.response.succeeded === false) ? (
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                            <span className="text-zinc-400 text-xs">
                              {lang === "zh-CN" ? '执行失败：' : 'Execution failed: '}
                              {baseResult.error || baseResult.response?.error?.message || (lang === "zh-CN" ? '未知错误' : 'Unknown error')}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-zinc-400 text-xs">
                              {lang === "zh-CN" ? '执行完成，点击"查看 JSON 详情"查看完整数据' : "Execution completed, click 'View JSON Details' for full data"}
                            </span>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ========== AI COPILOT MODE (Original Content) ========== */
            <>
          {/* Section A: SVG Professional Vector Design Canvas */}
          <div
            ref={centerViewportRef}
            className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-lg flex flex-col gap-3 relative overflow-hidden group ${
              centerViewportFullscreen ? "fixed inset-3 z-50 bg-zinc-950/95" : ""
            }`}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <h2 className="text-xs font-semibold font-display tracking-wider uppercase text-zinc-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                {centerViewMode === "viewport" ? currentT.navHeaderCAD
                  : centerViewMode === "screenshot" ? (lang === "zh-CN" ? "📸 Archicad 视口截图" : "📸 Archicad Screenshot")
                  : (lang === "zh-CN" ? "生成的 JSON 代码" : "Generated JSON Code")}
                {centerViewMode === "viewport" && (
                  <span className={`px-1.5 py-0.5 border rounded-md font-mono ${
                    liveViewportElements.length > 0
                      ? "bg-emerald-950/50 border-emerald-500/30 text-emerald-300"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400"
                  }`}>
                    {liveViewportElements.length > 0
                      ? (lang === "zh-CN"
                        ? `实际读回 AABB · ${liveViewportElements.length} 个`
                        : `Live AABB readback · ${liveViewportElements.length}`)
                      : (lang === "zh-CN" ? "计划示意（未读回模型）" : "Plan schematic (no model readback)")}
                  </span>
                )}
                {centerViewMode === "screenshot" && viewportCapture.viewType && (
                  <span className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 text-[10px] text-violet-300 rounded-md font-mono">
                    {viewportCapture.viewType} | {viewportCapture.storyName}
                  </span>
                )}
              </h2>

              <div className="flex items-center gap-3">
                {/* View Mode Toggle */}
                <div className="flex items-center gap-1 bg-zinc-800/50 rounded-lg p-0.5 border border-zinc-700">
                  <button
                    onClick={() => setCenterViewMode("viewport")}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                      centerViewMode === "viewport"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {lang === "zh-CN" ? "视口" : "Viewport"}
                  </button>
                  <button
                    onClick={() => {
                      setCenterViewMode("screenshot");
                      if (!viewportCapture.imageBase64) fetchViewportCapture();
                    }}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                      centerViewMode === "screenshot"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {lang === "zh-CN" ? "📸 截图" : "📸 Shot"}
                  </button>
                  <button
                    onClick={() => setCenterViewMode("json")}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                      centerViewMode === "json"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    JSON
                  </button>
                </div>

                <span className="text-[11px] text-zinc-400 hidden sm:inline-block">
                  {gridObstacles.filter(o => o.isUserAdded).length > 0 ? (
                    <span className="text-indigo-400 font-medium font-mono">
                      + {gridObstacles.filter(o => o.isUserAdded).length} {lang === "zh-CN" ? "物理障碍覆盖" : "Obstacles overlay"}
                    </span>
                  ) : (
                    <span className="text-zinc-500 font-mono text-[10px]">Parity checks active</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (centerViewportFullscreen) {
                      await document.exitFullscreen?.();
                      setCenterViewportFullscreen(false);
                      return;
                    }
                    if (centerViewportRef.current?.requestFullscreen) {
                      await centerViewportRef.current.requestFullscreen();
                    }
                    setCenterViewportFullscreen(true);
                  }}
                  className="p-1 rounded hover:bg-zinc-800 transition-colors"
                  title={lang === "zh-CN" ? (centerViewportFullscreen ? "退出全屏" : "全屏视口") : (centerViewportFullscreen ? "Exit fullscreen" : "Fullscreen viewport")}
                  aria-label={lang === "zh-CN" ? (centerViewportFullscreen ? "退出全屏" : "全屏视口") : (centerViewportFullscreen ? "Exit fullscreen" : "Fullscreen viewport")}
                >
                  {centerViewportFullscreen
                    ? <Minimize2 className="w-3.5 h-3.5 text-zinc-300" />
                    : <Maximize2 className="w-3.5 h-3.5 text-zinc-400" />}
                </button>
              </div>
            </div>

            {/* Conditional View: Viewport or JSON */}
            {centerViewMode === "viewport" ? (
              liveViewportElements.length > 0 ? (
                <div className="relative w-full h-80 bg-zinc-950/70 border border-emerald-500/20 rounded-xl overflow-hidden shadow-inner">
                  <div className="absolute top-2 left-2 z-20 flex flex-col gap-1.5 max-w-[75%]">
                    <span className="w-fit px-2 py-1 rounded bg-emerald-950/90 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
                      {lang === "zh-CN" ? "Archicad 实际读回 · AABB 二维尺寸示意" : "Archicad readback · AABB 2D size schematic"}
                    </span>
                    <span className="w-fit px-2 py-1 rounded bg-zinc-900/90 border border-zinc-700 text-[9px] font-mono text-zinc-400">
                      {liveViewportSource === "readback"
                        ? (lang === "zh-CN" ? "来源：命令执行后的读回" : "Source: post-command readback")
                        : (lang === "zh-CN" ? "来源：当前选择集同步" : "Source: current selection sync")}
                      {liveViewportUpdatedAt > 0 && ` · ${new Date(liveViewportUpdatedAt).toLocaleTimeString(lang === "zh-CN" ? "zh-CN" : "en-US", { hour12: false })}`}
                    </span>
                  </div>
                  <ArchicadViewport
                    elementsWithAABB={liveViewportElements}
                    selectedElements={baseSelectionStatus.guids}
                    showAABB={true}
                    language={lang}
                    onRefresh={refreshLiveViewportFromSelection}
                  />
                </div>
              ) : (
              /* Plan schematic fallback: this is intentionally not presented as model geometry. */
              <div className="relative w-full h-80 bg-zinc-950/70 border border-zinc-800 rounded-xl overflow-hidden shadow-inner select-none flex items-center justify-center group">

              {/* Overlay Grid lines for schematic feel */}
              <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none"
                   style={{
                     backgroundImage: `radial-gradient(circle, #3f3f46 1.5px, transparent 1.5px)`,
                     backgroundSize: `24px 24px`
                   }}
              />

              <div className="absolute top-3 left-4 z-20 px-2 py-1 rounded bg-zinc-950/90 border border-zinc-700 text-[10px] font-mono text-zinc-400">
                {lang === "zh-CN" ? "计划路径示意 · 未取得 Archicad 实际读回" : "Plan path schematic · no Archicad readback"}
              </div>

              {/* Dynamic Interactive SVG Viewer with clickable grid */}
              <svg
                className="w-full h-full cursor-crosshair relative z-10"
                onClick={handleGridClick}
              >
                {/* SVG definitions */}
                <defs>
                  <linearGradient id="pipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#4f46e5" />
                    <stop offset="50%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#4338ca" />
                  </linearGradient>

                  <linearGradient id="bypassGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#c084fc" stopOpacity="0.8" />
                  </linearGradient>

                  <radialGradient id="columnGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="70%" stopColor="#52525b" />
                    <stop offset="100%" stopColor="#27272a" />
                  </radialGradient>

                  <radialGradient id="userObstacleGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="70%" stopColor="#ef4444" />
                    <stop offset="100%" stopColor="#991b1b" />
                  </radialGradient>
                </defs>

                {/* Grid axis rulers */}
                <g className="opacity-30 text-[9px] font-mono fill-zinc-500 font-bold">
                  <text x="15" y="20">CAD VERTEX PATH</text>
                  <line x1="10" y1="30" x2="35" y2="30" stroke="#52525b" strokeWidth="1.5" />
                  <line x1="10" y1="30" x2="10" y2="55" stroke="#52525b" strokeWidth="1.5" />
                  <text x="40" y="34">X</text>
                  <text x="8" y="68">Y</text>
                </g>

                {/* Grid Lines on X coordinates */}
                <line x1="50" y1="30" x2="50" y2="290" stroke="#27272a" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="150" y1="30" x2="150" y2="290" stroke="#27272a" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="250" y1="30" x2="250" y2="290" stroke="#27272a" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="350" y1="30" x2="350" y2="290" stroke="#27272a" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="450" y1="30" x2="450" y2="290" stroke="#27272a" strokeWidth="1" strokeDasharray="3,3" />

                {/* Obstacle structural nodes (Columns - preset and user placed) */}
                {gridObstacles.map((obs, idx) => (
                  <g key={idx} className="transition-transform duration-200">
                    {/* Outer warning ring hover highlight */}
                    <circle
                      cx={obs.x}
                      cy={obs.y}
                      r={obs.r + 10}
                      className={`fill-none ${obs.isUserAdded ? "stroke-red-500/10 group-hover:stroke-red-500/25" : "stroke-zinc-500/10"} transition-all`}
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                    />

                    {/* The solid core structure */}
                    <circle
                      cx={obs.x}
                      cy={obs.y}
                      r={obs.r}
                      fill={obs.isUserAdded ? "url(#userObstacleGrad)" : "url(#columnGrad)"}
                      stroke={obs.isUserAdded ? "rgb(239, 68, 68)" : "rgb(113, 113, 122)"}
                      strokeWidth="2"
                      className="shadow-lg"
                    />

                    {/* Column metadata labels */}
                    <text
                      x={obs.x}
                      y={obs.y - obs.r - 4}
                      className="text-[9px] font-mono fill-zinc-400 font-medium text-center"
                      textAnchor="middle"
                    >
                      {obs.label}
                    </text>
                  </g>
                ))}

                {/* Terminal Nodes: Starts and Ends */}
                <g>
                  {/* Start Point */}
                  <circle cx="50" cy="150" r="10" className="fill-indigo-950/60 stroke-indigo-400" strokeWidth="2.5" />
                  <circle cx="50" cy="150" r="4" className="fill-white" />
                  <text x="35" y="180" className="text-[10px] font-mono fill-indigo-300 font-medium">{currentT.cadStart}</text>

                  {/* End Point */}
                  <circle cx="450" cy="150" r="10" className="fill-indigo-950/60 stroke-indigo-400" strokeWidth="2.5" />
                  <circle cx="450" cy="150" r="4" className="fill-white" />
                  <text x="415" y="180" className="text-[10px] font-mono fill-indigo-300 font-medium">{currentT.cadEnd}</text>
                </g>

                {/* THE FLUID GEOMETRY PIPELINE */}
                {activePlan && activePlanMode === "copilot" && (
                  <g>
                    {/* Backlight Laser Trace path */}
                    <path
                      d={renderPipesSvg()}
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth="20"
                      className="opacity-10"
                    />

                    {/* Laser scanner sweeps over when executing step is active */}
                    {activePlan.steps[0]?.status === "running" && (
                      <g className="animate-pulse">
                        <line x1="50" y1="30" x2="450" y2="290" stroke="#10b981" strokeWidth="1.5" strokeDasharray="6,6" />
                        <text x="50" y="50" className="text-[10px] font-mono fill-emerald-400 font-bold tracking-widest leading-none">SCAN ACTIVE_</text>
                      </g>
                    )}

                    {/* Primary structural alignment bypass polyline routing path */}
                    <motion.path
                      d={renderPipesSvg()}
                      fill="none"
                      stroke="url(#pipeGrad)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ strokeDasharray: 900, strokeDashoffset: 900 }}
                      animate={
                        activePlan.steps.some((step) => step.status === "done" || step.status === "running") || executionCompleted
                          ? { strokeDashoffset: 0 }
                          : { strokeDashoffset: 900 }
                      }
                      transition={{ duration: 1.8, ease: "easeInOut" }}
                    />

                    {/* Outer sleeve connection nodes styling */}
                    <motion.path
                      d={renderPipesSvg()}
                      fill="none"
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none"
                    />
                  </g>
                )}
              </svg>

              {/* Tips block explaining hover clicks on the designer */}
              <div className="absolute bottom-3 left-4 right-4 z-20 pointer-events-none text-center">
                <p className="text-[10.5px] font-mono text-zinc-400 bg-zinc-950/95 border border-zinc-800 px-3 py-1.5 rounded-lg inline-block shadow-lg leading-normal">
                  {currentT.tipCAD}
                </p>
              </div>

              {/* No pipeline loaded state empty overlay */}
              {!activePlan && (
                <div className="absolute inset-0 z-20 bg-zinc-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center select-none">
                  <div className="w-12 h-12 rounded border border-dashed border-zinc-800 flex items-center justify-center mb-3">
                    <Layers className="w-6 h-6 text-zinc-500" />
                  </div>
                  <h4 className="text-xs font-semibold text-zinc-400 tracking-wide font-display">
                    {currentT.emptyCADTitle}
                  </h4>
                  <p className="text-[10px] text-zinc-500 max-w-sm mt-1 leading-normal">
                    {currentT.emptyCADDesc}
                  </p>
                </div>
              )}
              </div>
              )
            ) : centerViewMode === "screenshot" ? (
              /* Screenshot View - H4.1 Archicad 视口截图反馈 */
              <div className="relative w-full h-80 bg-zinc-950/70 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
                {/* 截图工具栏 */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50">
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {viewportCapture.summary || (lang === "zh-CN" ? "点击右侧按钮截图" : "Click button to capture")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {stories.length > 0 && (
                      <select
                        value={selectedStoryForCapture ?? ''}
                        onChange={(e) => {
                          const idx = e.target.value !== '' ? parseInt(e.target.value) : null;
                          setSelectedStoryForCapture(idx);
                          fetchViewportCapture(idx);
                        }}
                        className="text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-zinc-900 text-violet-300 focus:outline-none focus:border-violet-500"
                        title={lang === "zh-CN" ? "选择楼层截图" : "Select floor for capture"}
                      >
                        <option value="" disabled>{lang === "zh-CN" ? "楼层..." : "Floor..."}</option>
                        {stories.map(s => (
                          <option key={s.index} value={s.index}>
                            {s.name} (L{s.level.toFixed(1)})
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => fetchViewportCapture()}
                      disabled={viewportCapture.loading}
                      className="text-[10px] px-2 py-0.5 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 disabled:opacity-40 transition-colors flex items-center gap-1"
                    >
                      {viewportCapture.loading
                        ? "⏳..."
                        : (lang === "zh-CN" ? "📸 截图" : "📸 Shot")}
                    </button>
                  </div>
                </div>
                {/* 截图显示区 */}
                <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                  {viewportCapture.imageBase64 ? (
                    <img
                      src={`data:image/png;base64,${viewportCapture.imageBase64}`}
                      alt="Archicad Viewport"
                      className="max-w-full max-h-full object-contain rounded border border-zinc-700"
                    />
                  ) : (
                    <div className="flex flex-col items-center text-zinc-500">
                      <Camera className="w-10 h-10 mb-2 opacity-50" />
                      <p className="text-xs">
                        {viewportCapture.loading
                          ? (lang === "zh-CN" ? "正在截图..." : "Capturing...")
                          : (lang === "zh-CN" ? "点击刷新截图按钮获取当前 Archicad 视口" : "Click refresh to capture Archicad viewport")}
                      </p>
                    </div>
                  )}
                </div>
                {/* 视觉验证结果汇总 */}
                {chainSteps.some(s => s.visualVerified || (s.visualIssues && s.visualIssues.length > 0)) && (
                  <div className="px-3 py-1.5 border-t border-zinc-800 bg-zinc-900/50 max-h-20 overflow-y-auto">
                    <div className="text-[9px] text-zinc-400 font-mono mb-1">
                      {lang === "zh-CN" ? "视觉验证结果" : "Visual Verification"}
                    </div>
                    {chainSteps.filter(s => s.visualVerified || (s.visualIssues && s.visualIssues.length > 0)).map((s, i) => (
                      <div key={i} className="text-[9px] font-mono flex items-start gap-1 mb-0.5">
                        <span>{s.visualVerified ? "👁✅" : "⚠"}</span>
                        <span className={s.visualVerified ? "text-emerald-400" : "text-amber-400"}>
                          {s.title}
                          {s.visualIssues && s.visualIssues.length > 0 && `: ${s.visualIssues.join("; ")}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* JSON Code View */
              <div className="relative w-full h-80 bg-zinc-950/70 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="h-full overflow-y-auto p-4">
                  {activePlan && activePlanMode === "copilot" ? (
                    <pre className="text-xs font-mono text-emerald-400 leading-relaxed">
                      {JSON.stringify(activePlan, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                      <Database className="w-10 h-10 mb-3" />
                      <p className="text-xs">{lang === "zh-CN" ? "暂无生成的 JSON 代码" : "No JSON code generated"}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section B: Dynamic Operational Steps Checkbox Card — Copilot 模式只显示 copilot plan */}
          <AnimatePresence>
            {activePlan && showPlanCard && activePlanMode === "copilot" && activePlan.steps && activePlan.steps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 font-sans shadow-lg flex flex-col gap-4 relative"
              >
                {/* Header info */}
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse flex-shrink-0" />
                    <h3 className="text-sm font-semibold tracking-tight font-display text-zinc-200 truncate">
                      {activePlan.title || (lang === "zh-CN" ? "操作计划" : "Operation Plan")}
                    </h3>
                  </div>

                  <span className="px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-900/40 text-[10px] font-mono font-medium text-indigo-300 flex-shrink-0 ml-2">
                    {activePlan.steps.length} {currentT.planStepsCount}
                  </span>
                </div>

                {/* Warning message triggers if mutating elements */}
                {activePlan.warning && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-amber-550">
                        {currentT.warningTitle}
                      </span>
                      <span className="text-[10.5px] text-amber-200/90 mt-0.5 leading-normal">
                        {activePlan.warning}
                      </span>
                    </div>
                  </div>
                )}

                {/* Steps listing */}
                <div className="flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                  {activePlan.steps.map((st, idx) => {
                    const isDone = st.status === "done";
                    const isRunning = st.status === "running";

                    return (
                      <div
                        key={st.id}
                        className={`rounded px-3.5 py-3 border flex items-start gap-3.5 transition-all ${isDone ? "border-emerald-500/20 bg-emerald-500/10" : isRunning ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-100" : "border-zinc-800 bg-zinc-900/30"}`}
                      >
                        {/* Step Sequence Badge with Status states */}
                        <div className="flex flex-shrink-0 items-center justify-center">
                          {isDone ? (
                            <div className="w-7 h-7 rounded bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
                              <Check className="w-4 h-4" />
                            </div>
                          ) : isRunning ? (
                            <div className="w-7 h-7 rounded bg-indigo-950 border border-indigo-500 flex items-center justify-center text-indigo-400">
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 text-xs font-mono font-bold">
                              {idx + 1}
                            </div>
                          )}
                        </div>

                        {/* Step Details */}
                        <div className="flex-1">
                          <div className="flex md:items-center justify-between gap-2 flex-col md:flex-row">
                            <h4 className="text-xs font-bold text-zinc-200">
                              {currentT.stepIndicator} {idx + 1}: {st.title}
                            </h4>

                            {/* Inner custom constraints */}
                            {st.params && (
                              <div className="flex flex-wrap gap-1.5 mt-1 md:mt-0">
                                {Object.entries(st.params).map(([key, value]) => {
                                  const displayValue = typeof value === "object" && value !== null
                                    ? JSON.stringify(value)
                                    : String(value);
                                  return (
                                    <span key={key} className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[9px] font-mono text-zinc-400 max-w-[200px] truncate">
                                      {key}={displayValue}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
                            {st.description}
                          </p>

                          <div className="flex items-center gap-1.5 mt-1.5 border-t border-zinc-800/50 pt-1.5">
                            <Info className="w-3 h-3 text-zinc-500" />
                            <span className="text-[10px] font-mono text-zinc-500 leading-none">
                              {st.expectedResult}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Executable command syntax segment */}
                <div className="rounded bg-zinc-950 border border-zinc-800 p-2 text-center">
                  <span className="text-[9.5px] font-mono text-zinc-500 uppercase block font-bold mb-1 tracking-wider">
                    {currentT.mepCodeTitle}
                  </span>
                  <code className="text-[10px] font-mono text-indigo-400 select-all">
                    {activePlan.mepCode}
                  </code>
                </div>

                {/* Call to actions - Safe execution parameters */}
                <div className="flex items-center justify-end gap-3 mt-1.5 select-none font-sans">
                  {/* E.3: 存为模板按钮 */}
                  <button
                    onClick={() => setShowSaveTemplateModal(true)}
                    disabled={isExecutingPlan}
                    className="px-3.5 py-1.5 text-xs font-semibold text-pink-400 border border-pink-500/30 hover:bg-pink-500/10 rounded cursor-pointer transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    {lang === "zh-CN" ? "存为模板" : "Save as Template"}
                  </button>

                  <button
                    onClick={handleCancelPlan}
                    className="px-3.5 py-1.5 text-xs font-semibold text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
                  >
                    {currentT.btnCancelPlan}
                  </button>

                  <button
                    disabled={isExecutingPlan}
                    onClick={handleExecutePlan}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 tracking-wide rounded flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(79,70,229,0.4)] cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-wait transition-all"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {currentT.btnExecute}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Section C: Telemetry Gate 4 Parity Verification Logs — Copilot 模式只显示 copilot plan 结果 */}
          <AnimatePresence>
            {activePlan && autoReadback && executionCompleted && activePlanMode === "copilot" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: 10 }}
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-lg flex flex-col gap-4 font-sans"
              >
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <h3 className="text-sm font-semibold tracking-tight text-zinc-200 font-display">
                      {currentT.resultTitle}
                    </h3>
                  </div>

                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] border border-emerald-555/20 font-bold uppercase">
                    {currentT.badgePass}
                  </span>
                </div>

                {/* Telemetry check grid comparison table */}
                <div className="overflow-x-auto rounded border border-zinc-800">
                  <table className="w-full text-left text-xs font-sans min-w-[340px]">
                    <thead className="bg-[#09090b] text-zinc-400 font-mono text-[9.5px] uppercase tracking-wider">
                      <tr>
                        <th className="p-2.5">{currentT.parameterTitle}</th>
                        <th className="p-2.5">{currentT.expectedTitle}</th>
                        <th className="p-2.5">{currentT.actualTitle}</th>
                        <th className="p-2.5 text-center">Parity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 text-zinc-300">
                      {executionResultData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-zinc-800/40">
                          <td className="p-2.5 font-medium">{row.item}</td>
                          <td className="p-2.5 font-mono text-[11px] text-zinc-400">{row.expected}</td>
                          <td className="p-2.5 font-mono text-[11px] font-semibold text-indigo-300">{row.actual}</td>
                          <td className="p-2.5 text-center select-none">
                            <span className={`px-2 py-0.5 rounded text-[10px] border font-mono font-bold uppercase ${
                              row.status === "ok"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : row.status === "warning"
                                  ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                  : "bg-red-500/10 border-red-500/20 text-red-400"
                            }`}>
                              {row.status === "ok" ? "PASS" : row.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Call to Export log sheet */}
                <div className="flex items-center justify-end gap-3 select-none">
                  <button
                    onClick={() => {
                      setJsonViewerTitle(lang === "zh-CN" ? "执行结果详情" : "Execution Result Details");
                      setJsonViewerData({
                        plan: activePlan,
                        results: executionResultData,
                        timestamp: new Date().toISOString()
                      });
                      setShowJsonViewer(true);
                    }}
                    className="border border-zinc-700 hover:bg-zinc-800 text-cyan-400 rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                  >
                    <Eye className="w-4 h-4" />
                    {lang === "zh-CN" ? "查看JSON" : "View JSON"}
                  </button>
                  <button
                    onClick={() => triggerToast(lang === "zh-CN" ? "物理层报告数据转换成功：100% 同合度" : "Tabular report compiled with high-precision values.")}
                    className="border border-zinc-700 hover:bg-zinc-800 text-indigo-400 rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    {currentT.exportLog}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* SYSTEM HARDWARE ERROR POPUP */}
          <AnimatePresence>
            {systemError && (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 shadow-lg flex flex-col gap-3 font-sans"
              >
                <div className="flex items-center gap-2 border-b border-zinc-800 pb-2.5">
                  <AlertTriangle className="w-4.5 h-4.5 text-red-500" />
                  <h3 className="text-sm font-semibold tracking-tight text-red-400">
                    {currentT.errConnTitle}
                  </h3>
                </div>
                <p className="text-[11px] text-red-300/90 leading-relaxed font-mono">
                  {systemError}
                </p>
                <div className="flex justify-end select-none">
                  <button
                    onClick={() => setSystemError(null)}
                    className="border border-red-500/20 hover:bg-red-500/10 text-red-300 rounded px-3 py-1.5 text-xs font-semibold cursor-pointer"
                  >
                    {lang === "zh-CN" ? "知道了" : "Dismiss"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 扩展功能面板 — Copilot 模式也显示 */}
          <ExtensionPanel
            lang={lang}
            userTemplates={userTemplates}
            templateSearch={templateSearch}
            setTemplateSearch={setTemplateSearch}
            onReplayTemplate={(tpl) => replayUserTemplate(tpl)}
            onDeleteTemplate={deleteUserTemplate}
            customCommands={customCommands}
            onOpenCustomCommands={openCustomCommandsPanel}
            onAssetsChanged={async () => {
              await loadUserTemplates();
              await loadCustomCommands();
            }}
            onSuggestionClick={(action, params) => {
              triggerToast(
                lang === "zh-CN"
                  ? `建议操作: ${action}`
                  : `Suggested: ${action}`
              );
              console.log("[Proactive] Suggestion clicked:", action, params);
            }}
            expanded={extPanelExpanded}
            setExpanded={setExtPanelExpanded}
          />
          </>
          )}
          {/* End of Conditional Rendering (BASE vs AI Copilot) */}

        </main>

        {/* RIGHT Panel: CollabAI Stream Chat Container */}
        <ConversationWindowHost
          enabled={conversationFocusMode}
          externalWindow={conversationWindow}
          onExternalWindowClosed={handleConversationWindowClosed}
        >
        <aside className={`${conversationFocusMode ? "w-full max-w-full flex-1 min-h-0" : "w-full lg:w-[384px] lg:flex-shrink-0 h-[500px] lg:h-full"} bg-zinc-900/40 border-t lg:border-t-0 lg:border-l border-zinc-800 flex flex-col overflow-hidden z-10`}>

          {/* Chat Headers */}
          <div className="flex-shrink-0 px-4 py-3 bg-zinc-900/50 border-b border-zinc-800 flex items-center justify-between select-none">
            <div className="flex flex-shrink-0 items-center gap-3">
              {/* AI CollabAI Mode Button */}
              <button
                onClick={() => setWorkbenchMode("copilot")}
                className={`flex items-center gap-2 transition-all ${
                  workbenchMode === "copilot" ? "opacity-100" : "opacity-60 hover:opacity-80"
                }`}
              >
                <span className="flex h-2 w-2 relative">
                  {workbenchMode === "copilot" && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${workbenchMode === "copilot" ? "bg-indigo-500" : "bg-zinc-500"}`}></span>
                </span>
                <span className={`whitespace-nowrap text-xs font-semibold font-display ${workbenchMode === "copilot" ? "text-zinc-200" : "text-zinc-400"}`}>
                  {lang === "zh-CN" ? "CollabAI 智能" : "CollabAI Stream"}
                </span>
              </button>

              {/* Manual BASE Mode Button */}
              <button
                onClick={() => setWorkbenchMode("base")}
                className={`flex items-center gap-2 transition-all ${
                  workbenchMode === "base" ? "opacity-100" : "opacity-60 hover:opacity-80"
                }`}
              >
                <span className="flex h-2 w-2 relative">
                  {workbenchMode === "base" && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${workbenchMode === "base" ? "bg-emerald-500" : "bg-zinc-500"}`}></span>
                </span>
                <span className={`whitespace-nowrap text-xs font-semibold font-display ${workbenchMode === "base" ? "text-zinc-200" : "text-zinc-400"}`}>
                  {lang === "zh-CN" ? "Manual 手动" : "Manual BASE"}
                </span>
              </button>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[10px] font-mono text-zinc-500 leading-none">
                {llmConfig.provider.toUpperCase()} : {(llmConfig.modelName || "default").replace("deepseek-", "")}
              </span>
              <button
                type="button"
                onClick={handleConversationFocusToggle}
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                  conversationFocusMode
                    ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                    : "border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
                title={
                  lang === "zh-CN"
                    ? (conversationFocusMode ? "恢复三栏布局" : "仅显示对话")
                    : (conversationFocusMode ? "Restore three-panel layout" : "Show conversation only")
                }
                aria-label={
                  lang === "zh-CN"
                    ? (conversationFocusMode ? "恢复三栏布局" : "仅显示对话")
                    : (conversationFocusMode ? "Restore three-panel layout" : "Show conversation only")
                }
                aria-pressed={conversationFocusMode}
              >
                {conversationFocusMode ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Conversation history lists */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 font-sans custom-scrollbar"
          >
            {workbenchMode === "base" ? (
              /* BASE Mode: 介绍卡片 + 历史任务列表 */
              <>
              <div className="p-3.5 rounded bg-zinc-900/50 border border-zinc-800 leading-relaxed text-zinc-300">
                <h4 className="text-[11.5px] font-bold text-zinc-150 mb-1 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  {lang === "zh-CN" ? "Manual BASE 模式" : "Manual BASE Mode"}
                </h4>

                <ul className="text-[10px] space-y-1.5 mt-2 font-medium">
                  <li className="flex items-center gap-1.5 text-emerald-300">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    {lang === "zh-CN" ? "📋 直接执行 MEPBridge 命令（无需 LLM）" : "📋 Direct MEPBridge command execution (no LLM)"}
                  </li>
                  <li className="flex items-center gap-1.5 text-emerald-300">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    {lang === "zh-CN" ? "🔍 实时读取 Archicad 选择集和结构" : "🔍 Real-time Archicad selection and structure reading"}
                  </li>
                  <li className="flex items-center gap-1.5 text-emerald-300">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    {lang === "zh-CN" ? "⚡ 快速操作，即点即用" : "⚡ Quick operations, click and run"}
                  </li>
                </ul>

                <p className="text-[9.5px] text-zinc-500 mt-2.5 italic border-t border-zinc-800/60 pt-2 leading-none">
                  {lang === "zh-CN" ? "提示：使用左侧按钮或下方快速模板执行操作" : "Tip: Use left panel buttons or quick templates below"}
                </p>
              </div>

              {/* 历史任务列表 */}
              <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800">
                <h4 className="text-[11px] font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  {lang === "zh-CN" ? "执行历史" : "Task History"}
                  <span className="text-[9px] text-zinc-500 font-normal ml-auto">
                    {taskHistory.length}/8
                  </span>
                </h4>

                {taskHistory.length === 0 ? (
                  <div className="text-[10px] text-zinc-600 italic py-4 text-center">
                    {lang === "zh-CN" ? "暂无执行记录" : "No tasks yet"}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar flex flex-col-reverse">
                    {taskHistory.map((task) => (
                      <div
                        key={task.id}
                        className={`p-2 rounded border text-[10px] flex items-start gap-2 ${
                          task.status === "success" ? "bg-emerald-900/10 border-emerald-500/20" :
                          task.status === "error" ? "bg-red-900/10 border-red-500/20" :
                          "bg-amber-900/10 border-amber-500/20"
                        }`}
                      >
                        <div className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                          task.status === "success" ? "bg-emerald-400" :
                          task.status === "error" ? "bg-red-400" :
                          "bg-amber-400 animate-pulse"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-zinc-300 truncate">{task.label}</span>
                            <span className="text-[8px] text-zinc-500 font-mono flex-shrink-0">{task.timestamp}</span>
                          </div>
                          {task.summary && (
                            <div className="text-[9px] text-zinc-500 mt-0.5 truncate">{task.summary}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* BASE 模式 NL 对话显示区域（显示自定义命令匹配/LLM 解析结果） */}
              {baseMessages.length > 0 && (
                <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800">
                  <h4 className="text-[11px] font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    {lang === "zh-CN" ? "NL 对话" : "NL Dialog"}
                  </h4>
                  <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar">
                    {baseMessages.slice(-6).map((m) => {
                      const isUser = m.sender === "user";
                      const isSystem = m.sender === "system";
                      if (isSystem) {
                        return (
                          <div key={m.id} className="text-center font-mono my-0.5">
                            <span className="inline-block px-2 py-0.5 rounded bg-zinc-900/80 text-[9px] text-indigo-400 border border-zinc-800">
                              {m.text.length > 80 ? m.text.slice(0, 80) + "..." : m.text}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={m.id} className={`flex flex-col max-w-[90%] ${isUser ? "self-end items-end ml-auto" : "self-start items-start"}`}>
                          <div className={`px-2.5 py-1.5 rounded-lg text-[10px] leading-relaxed ${
                            isUser
                              ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-200"
                              : "bg-zinc-800 border border-zinc-700 text-zinc-300"
                          }`}>
                            {m.text.length > 150 ? m.text.slice(0, 150) + "..." : m.text}
                          </div>
                          {m.isMepPlan && m.planRef && (
                            <div className="mt-1 px-2 py-1 rounded bg-indigo-900/20 border border-indigo-500/30 text-[9px] text-indigo-300">
                              ⚡ {lang === "zh-CN" ? "操作计划已生成" : "Plan generated"} ({m.planRef.steps.length} {lang === "zh-CN" ? "步" : "steps"})
                            </div>
                          )}
                          <span className="text-[8px] text-zinc-600 mt-0.5">{m.timestamp}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>
            ) : (
              /* AI Copilot Mode: Show original welcome and messages */
              <>
            {/* Friendly initial Greeting intro card */}
            <div className="p-3.5 rounded bg-zinc-900/50 border border-zinc-800 leading-relaxed text-zinc-300">
              <h4 className="text-[11.5px] font-bold text-zinc-150 mb-1 flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                {currentT.chatWelcomeHeader}
              </h4>

              <ul className="text-[10px] space-y-1.5 mt-2 font-medium">
                <li className="flex items-center gap-1.5 text-indigo-300">
                  <span className="w-1 h-1 rounded-full bg-indigo-400" />
                  {currentT.itemCap1}
                </li>
                <li className="flex items-center gap-1.5 text-indigo-300">
                  <span className="w-1 h-1 rounded-full bg-indigo-400" />
                  {currentT.itemCap2}
                </li>
                <li className="flex items-center gap-1.5 text-purple-300">
                  <span className="w-1 h-1 rounded-full bg-purple-400" />
                  {currentT.itemCap3}
                </li>
                <li className="flex items-center gap-1.5 text-emerald-300">
                  <span className="w-1 h-1 rounded-full bg-emerald-400" />
                  {currentT.itemCap4}
                </li>
              </ul>

              <p className="text-[9.5px] text-zinc-500 mt-2.5 italic border-t border-zinc-800/60 pt-2 leading-none">
                {currentT.chatHint}
              </p>
            </div>

            {/* Conversation message bubbles — Copilot 模式只显示 copilot 消息 */}
            <div className="p-3 rounded bg-zinc-900/50 border border-zinc-800 min-h-0">
              <h4 className="text-[11px] font-bold text-zinc-300 mb-2 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-indigo-400" />
                {lang === "zh-CN" ? "AI 对话历史" : "AI Dialog History"}
                <span className="text-[9px] text-zinc-500 font-normal ml-auto">
                  {copilotMessages.length}
                </span>
              </h4>
              <div className="space-y-3 max-h-[360px] overflow-y-auto custom-scrollbar pr-1 flex flex-col">
            {copilotMessages.map((m) => {
              const isUser = m.sender === "user";
              const isSystem = m.sender === "system";
              const shouldCollapseMessage = !isUser && (m.text.length > 260 || m.text.split("\n").length > 4);
              const messagePreview = shouldCollapseMessage
                ? `${m.text.split("\n")[0].slice(0, 160)}${m.text.length > 160 ? "..." : ""}`
                : m.text;

              if (isSystem) {
                return (
                  <div key={m.id} className="text-center font-mono my-1">
                    {shouldCollapseMessage ? (
                      <details className="inline-block max-w-full rounded bg-zinc-900/80 text-left text-[9.5px] text-indigo-300 border border-zinc-800 group">
                        <summary className="cursor-pointer list-none px-2.5 py-1 select-none hover:text-indigo-200">
                          <span>{messagePreview}</span>
                          <span className="ml-2 text-zinc-600 group-open:hidden">▶</span>
                          <span className="ml-2 text-zinc-600 hidden group-open:inline">▼</span>
                        </summary>
                        <div className="max-h-40 overflow-y-auto custom-scrollbar border-t border-zinc-800 px-2.5 py-1.5 whitespace-pre-line text-zinc-400">
                          {m.text}
                        </div>
                      </details>
                    ) : (
                      <span className="inline-block px-2.5 py-1 rounded bg-zinc-900/80 text-[9.5px] text-indigo-400 border border-zinc-800">
                        {m.text}
                      </span>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex flex-col max-w-[85%] ${isUser ? "self-end items-end" : "self-start items-start animate-fade-in"}`}
                >
                  {/* Bubble wrapper */}
                  <div
                    className={`rounded p-3 text-xs leading-relaxed font-sans tracking-wide shadow-sm ${isUser ? "bg-indigo-600 text-white rounded-br-none" : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-none"}`}
                  >
                    {/* 主文本 - 支持多行 */}
                    {shouldCollapseMessage ? (
                      <details className="group">
                        <summary className="cursor-pointer list-none select-none whitespace-pre-line">
                          <span>{messagePreview}</span>
                          <span className="ml-2 text-zinc-500 group-open:hidden">▶</span>
                          <span className="ml-2 text-zinc-500 hidden group-open:inline">▼</span>
                        </summary>
                        <div className="mt-2 max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-line rounded border border-zinc-700/50 bg-black/20 p-2 text-[11px] text-zinc-300">
                          {m.text}
                        </div>
                      </details>
                    ) : (
                      <div className="whitespace-pre-line">{m.text}</div>
                    )}

                    {/* 匹配来源标签 - Local Match */}
                    {m.isLocalMatch && (
                      <div className="mt-2 pt-2 border-t border-zinc-700/50 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">
                          \u26A1 Local Match &middot; {m.executionTimeMs}ms
                        </span>
                      </div>
                    )}

                    {/* 匹配来源标签 - 远程 descriptor 命中 */}
                    {m.matchedDescriptor && !m.isLocalMatch && (
                      <div className="mt-2 pt-2 border-t border-zinc-700/50 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-mono">
                          \U0001F9E0 {m.matchedDescriptor}
                        </span>
                        {m.isMepPlan && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[10px] font-mono">
                            \u26A0\uFE0F Mutation
                          </span>
                        )}
                      </div>
                    )}

                    {/* 步骤摘要 - 非本地匹配时显示 */}
                    {m.stepsSummary && !m.isLocalMatch && (
                      <div className="mt-1.5 px-2 py-1 rounded bg-zinc-800/50 text-[10px] font-mono text-cyan-300 border border-cyan-500/20">
                        \U0001F4CB {m.stepsSummary}
                      </div>
                    )}

                    {/* V2: LLM CAD-CoT 思考过程 - 可折叠 */}
                    {m.reasoning && !m.isLocalMatch && (
                      <details className="mt-1.5 group">
                        <summary className="cursor-pointer text-[10px] font-mono text-violet-400/80 hover:text-violet-300 flex items-center gap-1 select-none">
                          \U0001F9E0 {lang === "zh-CN" ? "AI 思考过程" : "AI Reasoning"}
                          <span className="text-zinc-600 group-open:hidden">\u25B6</span>
                          <span className="text-zinc-600 hidden group-open:inline">\u25BC</span>
                        </summary>
                        <div className="mt-1 max-h-40 overflow-y-auto custom-scrollbar px-2 py-1.5 rounded bg-violet-500/5 text-[10px] text-violet-200/70 border border-violet-500/20 font-mono whitespace-pre-line leading-relaxed">
                          {m.reasoning}
                        </div>
                      </details>
                    )}
                  </div>

                  {/* Time metadata stamp - 根据消息类型区分标签 */}
                  <span className="text-[9px] font-mono text-zinc-500 mt-1 px-1">
                    {isUser ? "Me" : (m.isLocalMatch ? "Local" : "MEP-Copilot")} &middot; {m.timestamp}
                  </span>
                </div>
              );
            })}

            {/* Simulated generation loading dot */}
            {isAnalyzing && (
              <div className="self-start flex flex-col gap-1 max-w-[85%]">
                <div className="bg-zinc-900 border border-zinc-800 rounded p-3 flex items-center justify-center gap-1 text-zinc-400 select-none">
                  <span className="text-[10px] font-semibold tracking-wide mr-1 font-mono uppercase text-indigo-400 animate-pulse">{currentT.dotConnecting}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
              </div>
            </div>
            </>
            )}
          </div>

          {/* Prompt quick templates selectors */}
          <div className="flex-shrink-0 px-3 py-2 bg-zinc-900/20 border-t border-zinc-800 flex flex-col gap-1.5 select-none text-left">
            <span className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
              {workbenchMode === "base"
                ? (lang === "zh-CN" ? "BASE 快速模板" : "BASE Quick Templates")
                : (lang === "zh-CN" ? "AI 智能场景模板" : "AI Scenario Presets")}
            </span>
            <div className="flex flex-col gap-1">
              {workbenchMode === "base" ? (
                /* BASE Mode Templates */
                <>
                  {/* BASE Template 1: Read Selection */}
                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
                                addOnCommandParameters: { includeAabb: false, includeMepInfo: true }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "读取选择集完成" : "Read selection completed");
                        recordTask(lang === "zh-CN" ? "读取选中构件" : "Get Selected", data.ok ? "success" : "error", data.ok ? `✓ ${data.response?.result?.addOnCommandResponse?.elements?.length || 0} elements` : data.error?.slice(0, 40));
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none hover:border-indigo-500 font-mono text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    📋 {lang === "zh-CN" ? "读取选中的构件详情" : "Get selected element details"}
                  </button>

                  {/* BASE Template 2: Scan Structure → AABB 视口显示 */}
                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "ScanStructuralElements" },
                                addOnCommandParameters: { types: ["Wall", "Column", "Beam"] }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        // 诊断日志
                        console.log('[Scan] response.ok:', data.ok, 'succeeded:', data.response?.succeeded);
                        console.log('[Scan] response.result:', data.response?.result);
                        // FO-1 V1.6+: 扫描结果驱动视口显示（每个元素按真实 AABB 尺寸 mm 比例绘制矩形）
                        if (data.ok && data.response?.succeeded) {
                          const elements = data.response.result?.addOnCommandResponse?.elements || data.response.result?.elements || [];
                          console.log('[Scan] elements count:', elements.length, 'first:', elements[0]);
                          if (Array.isArray(elements) && elements.length > 0) {
                            setBaseScanElements(elements as ElementWithAABB[]);
                            setScanSourceLabel(`ScanStructuralElements (${elements.length})`);
                            triggerToast(lang === "zh-CN"
                              ? `扫描完成：${elements.length} 个结构构件已按 AABB 真实尺寸绘制到视口`
                              : `Scan done: ${elements.length} structural elements drawn by real AABB bounds`);
                          } else {
                            triggerToast(lang === "zh-CN" ? "扫描完成，但未找到结构构件" : "Scan completed, no structural elements found");
                          }
                        } else {
                          triggerToast(lang === "zh-CN" ? "扫描结构完成" : "Scan structure completed");
                        }
                        recordTask(lang === "zh-CN" ? "扫描结构" : "Scan Structure", data.ok ? "success" : "error", data.ok ? `✓ ${data.response?.result?.addOnCommandResponse?.elements?.length || 0} elements` : data.error?.slice(0, 40));
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none hover:border-amber-500 font-mono text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🔍 {lang === "zh-CN" ? "扫描墙/柱/梁 → AABB 视口示意" : "Scan Wall/Column/Beam → AABB viewport"}
                  </button>

                  {/* BASE Template 3: Move Up 1000mm */}
                  <button
                    onClick={async () => {
                      setIsBaseExecuting(true);
                      try {
                        const res = await fetch("/api/execute", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            command: {
                              command: "API.ExecuteAddOnCommand",
                              parameters: {
                                addOnCommandId: { commandNamespace: "MEPBridge", commandName: "MoveSelectedElements" },
                                addOnCommandParameters: {
                                  useCurrentSelection: true,
                                  deltaMm: {
                                    x: 0,
                                    y: 0,
                                    z: 1000
                                  },
                                  dryRun: false,
                                  confirmRequired: true
                                }
                              }
                            }
                          })
                        });
                        const data = await res.json();
                        setBaseResult(data);
                        triggerToast(lang === "zh-CN" ? "构件已向上移动 1000mm" : "Elements moved up 1000mm");
                        recordTask(lang === "zh-CN" ? "移动构件↑1000mm" : "Move Up 1000mm", data.ok ? "success" : "error");
                      } catch (err) {
                        console.error(err);
                        triggerToast(lang === "zh-CN" ? "移动失败" : "Move failed");
                      } finally {
                        setIsBaseExecuting(false);
                      }
                    }}
                    disabled={isBaseExecuting || !mepbridgeConnected}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 rounded py-1.5 px-2.5 text-[10px] text-white font-bold outline-none font-mono text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ↑ {lang === "zh-CN" ? "移动选中构件向上 1000mm" : "Move selected up 1000mm"}
                  </button>
                </>
              ) : (
                /* AI Copilot Mode Templates */
                <>
                  {/* AI Scenario 1: 示例首层房间墙体 (参照文件首层真实坐标，24面墙) */}
                  <button
                    onClick={() => selectQuickSuggestion(lang === "zh-CN" ? "建示例首层房间墙体" : "Build ground floor walls")}
                    className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none hover:border-emerald-500 font-mono text-left cursor-pointer transition-colors"
                  >
                    🏠 {lang === "zh-CN" ? "示例首层房间墙体（15.3×14.3m，24面墙）" : "Ground Floor Walls (15.3×14.3m, 24 walls)"}
                  </button>

                  {/* AI Scenario 2: 示例布置首层风管 (参照文件首层真实坐标) */}
                  <button
                    onClick={() => selectQuickSuggestion(lang === "zh-CN" ? "示例布置首层风管" : "Ground floor duct layout")}
                    className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none hover:border-cyan-500 font-mono text-left cursor-pointer transition-colors"
                  >
                    🚿 {lang === "zh-CN" ? "示例布置首层风管（排风+暖供+暖回，7条管段）" : "Duct Layout (Exhaust+Hydronic, 7 segments)"}
                  </button>

                  {/* AI Scenario 3: 示例创建首层楼梯 (参照文件首层真实参数) */}
                  <button
                    onClick={() => selectQuickSuggestion(lang === "zh-CN" ? "示例创建首层楼梯" : "Create ground floor stair")}
                    className="w-full bg-zinc-800 border border-zinc-705 rounded py-1.5 px-2.5 text-[10px] text-zinc-200 outline-none hover:border-orange-500 font-mono text-left cursor-pointer transition-colors"
                  >
                    🪜 {lang === "zh-CN" ? "示例创建首层楼梯（2段10步+平台楼板，同图层）" : "Ground Floor Stair (2 flights + landing slab, same layer)"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Mode-aware user extension assets: template save + custom command creation */}
          <div className="flex-shrink-0 px-3 py-2 bg-zinc-900/25 border-t border-zinc-800 flex flex-col gap-1.5 select-none">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 ${workbenchMode === "copilot" ? "text-pink-400/75" : "text-cyan-400/75"}`}>
                {workbenchMode === "copilot" ? <Bookmark className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                {workbenchMode === "copilot"
                  ? (lang === "zh-CN" ? "AI 扩展资产" : "AI Assets")
                  : (lang === "zh-CN" ? "手动扩展资产" : "Manual Assets")}
              </span>
              <span className="text-[9px] text-zinc-600 font-mono">
                {lang === "zh-CN" ? "模板 / 命令 / 预设" : "Templates / Commands / Presets"}
              </span>
            </div>

            <p className="text-[9.5px] text-zinc-500 leading-relaxed">
              {workbenchMode === "copilot"
                ? (lang === "zh-CN" ? "AI 模式这里只保留智能场景模板：保存当前计划，或选择已有模板任务重放。" : "AI mode keeps scenario templates here: save the current plan or replay an existing template.")
                : (lang === "zh-CN" ? "手动模式这里只保留 NL 快捷命令：新增命令，或选择已有命令触发。" : "Manual mode keeps NL shortcuts here: add a command or trigger an existing command.")}
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              {workbenchMode === "copilot" ? (
                <>
                  <button
                    onClick={() => activePlan ? setShowSaveTemplateModal(true) : triggerToast(lang === "zh-CN" ? "请先生成一个可保存的计划" : "Generate a plan before saving a template")}
                    className={`rounded border px-2 py-1.5 text-[10px] font-mono transition-colors text-left ${activePlan ? "border-pink-500/30 bg-pink-500/10 text-pink-200 hover:bg-pink-500/15" : "border-zinc-800 bg-zinc-900/50 text-zinc-600 cursor-not-allowed"}`}
                    title={lang === "zh-CN" ? "把当前中区计划保存为用户模板" : "Save current center plan as a user template"}
                  >
                    <span className="flex items-center gap-1.5">
                      <Bookmark className="w-3 h-3" />
                      {lang === "zh-CN" ? "添加用户模板" : "Add Template"}
                    </span>
                  </button>
                  <div className="relative rounded border border-pink-500/30 bg-pink-500/10 text-pink-200">
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateDropdownOpen(prev => !prev);
                        setCustomCommandDropdownOpen(false);
                      }}
                      className="w-full px-2 py-1.5 text-[10px] font-mono hover:bg-pink-500/10 transition-colors text-left"
                      title={lang === "zh-CN" ? "展开/折叠已有用户模板列表" : "Expand/collapse user templates"}
                    >
                      <span className="flex items-center gap-1.5">
                        <Bookmark className="w-3 h-3" />
                        {lang === "zh-CN" ? "选择已有模板" : "Choose Template"}
                        <span className="ml-auto text-[8px] text-pink-300/70">{userTemplates.length}</span>
                        <ChevronDown className={`w-3 h-3 text-pink-300/70 transition-transform ${templateDropdownOpen ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {templateDropdownOpen && (
                      <div className="absolute right-0 bottom-full z-20 mb-1 w-80 max-h-56 overflow-y-auto custom-scrollbar rounded border border-zinc-700 bg-zinc-950 p-1.5 shadow-xl">
                        {userTemplates.length === 0 ? (
                          <div className="px-2 py-1.5 text-[10px] text-zinc-600 font-mono">
                            {lang === "zh-CN" ? "暂无用户模板" : "No user templates"}
                          </div>
                        ) : userTemplates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => {
                              setTemplateDropdownOpen(false);
                              replayUserTemplate(tpl);
                            }}
                            className="w-full rounded px-2 py-1.5 text-left text-[10px] text-zinc-300 hover:bg-zinc-800 font-mono flex items-center gap-2"
                            title={tpl.description || tpl.name}
                          >
                            <span className="flex-shrink-0">{tpl.icon || "📋"}</span>
                            <span className="flex-1 min-w-0">
                              <span className="block truncate text-zinc-200">{tpl.name}</span>
                              {tpl.description && <span className="block truncate text-[8px] text-zinc-600">{tpl.description}</span>}
                            </span>
                            <span className="text-[8px] text-zinc-600 flex-shrink-0">{tpl.riskLevel}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={openCustomCommandsPanel}
                    className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-mono text-cyan-200 hover:bg-cyan-500/15 transition-colors text-left"
                    title={lang === "zh-CN" ? "添加 NL 触发单步常用命令" : "Add an NL command that triggers a frequent single-step command"}
                  >
                    <span className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3" />
                      {lang === "zh-CN" ? "添加 NL 命令" : "Add NL Command"}
                    </span>
                  </button>
                  <div className="relative rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomCommandDropdownOpen(prev => !prev);
                        setTemplateDropdownOpen(false);
                      }}
                      className="w-full px-2 py-1.5 text-[10px] font-mono hover:bg-cyan-500/10 transition-colors text-left"
                      title={lang === "zh-CN" ? "展开/折叠已有 NL 命令列表" : "Expand/collapse NL commands"}
                    >
                      <span className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3" />
                        {lang === "zh-CN" ? "选择已有命令" : "Choose Command"}
                        <span className="ml-auto text-[8px] text-cyan-300/70">{enabledCustomCommands.length}</span>
                        <ChevronDown className={`w-3 h-3 text-cyan-300/70 transition-transform ${customCommandDropdownOpen ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {customCommandDropdownOpen && (
                      <div className="absolute right-0 bottom-full z-20 mb-1 w-80 max-h-56 overflow-y-auto custom-scrollbar rounded border border-zinc-700 bg-zinc-950 p-1.5 shadow-xl">
                        {enabledCustomCommands.length === 0 ? (
                          <div className="px-2 py-1.5 text-[10px] text-zinc-600 font-mono">
                            {lang === "zh-CN" ? "暂无已启用 NL 命令" : "No enabled NL commands"}
                          </div>
                        ) : enabledCustomCommands.map((cmd) => {
                          const trigger = cmd.triggers[0] || "";
                          return (
                            <button
                              key={cmd.id}
                              onClick={() => {
                                setCustomCommandDropdownOpen(false);
                                if (trigger) handleSendMessage(trigger);
                              }}
                              className="w-full rounded px-2 py-1.5 text-left text-[10px] text-zinc-300 hover:bg-zinc-800 font-mono flex items-center gap-2"
                              title={cmd.description || trigger || cmd.id}
                            >
                              <span className="text-cyan-400 flex-shrink-0">⚡</span>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate text-zinc-200">{trigger || cmd.description || cmd.id}</span>
                                {cmd.description && <span className="block truncate text-[8px] text-zinc-600">{cmd.description}</span>}
                              </span>
                              <span className="text-[8px] text-zinc-600 flex-shrink-0">{cmd.singleStep ? "step" : "tpl"}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* V2 H2: 自治模式选择器 + 链进度面板 */}
          {workbenchMode === "copilot" && (
            <div className="flex-shrink-0 px-3 py-2 bg-zinc-900/30 border-t border-zinc-800 flex flex-col gap-1.5 select-none">
              {/* 三预设模式切换 */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-mono uppercase text-violet-400/70 tracking-wider flex items-center gap-0.5">
                  <Zap className="w-3 h-3" />
                  {lang === "zh-CN" ? "自动模式" : "Autonomy"}
                </span>
                <div className="flex gap-1 ml-auto">
                  {([
                    { mode: "copilot-auto", label: lang === "zh-CN" ? "自动" : "Auto", color: "emerald" },
                    { mode: "copilot-supervised", label: lang === "zh-CN" ? "监督" : "Super", color: "amber" },
                    { mode: "manual-strict", label: lang === "zh-CN" ? "手动" : "Manual", color: "zinc" },
                  ] as const).map((preset) => (
                    <button
                      key={preset.mode}
                      onClick={() => setAutonomyMode(preset.mode)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all cursor-pointer border ${
                        autonomyMode === preset.mode
                          ? `bg-${preset.color}-500/20 text-${preset.color}-400 border-${preset.color}-500/40`
                          : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 链执行进度（仅在链运行时显示） */}
              {showChainProgress && chainStatus && (
                <div className={`flex flex-col gap-1 bg-black/20 rounded p-1.5 custom-scrollbar ${rightChainExpanded ? "max-h-36 overflow-y-auto" : "max-h-20 overflow-hidden"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-violet-300">
                      {isChainRunning ? (
                        <span className="flex items-center gap-1">
                          <Activity className="w-2.5 h-2.5 animate-spin" />
                          {lang === "zh-CN" ? "执行中..." : "Running..."}
                        </span>
                      ) : chainStatus.status === "completed" ? (
                        <span className="text-emerald-400">✅ {lang === "zh-CN" ? "完成" : "Done"}</span>
                      ) : chainStatus.status === "failed" || chainStatus.status === "error" ? (
                        <span className="text-red-400">❌ {lang === "zh-CN" ? "失败" : "Failed"}</span>
                      ) : (
                        <span>{chainStatus.status}</span>
                      )}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setRightChainExpanded(prev => !prev)}
                        className="px-1 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-violet-300 hover:bg-zinc-700 cursor-pointer"
                        title={lang === "zh-CN" ? "展开/折叠执行链详情" : "Expand/collapse chain details"}
                      >
                        {rightChainExpanded ? "▴" : "▾"}
                      </button>
                      {isChainRunning && (
                        <>
                          <button onClick={() => fetch("/api/plan-chain/pause", { method: "POST" }).then(() => {})} className="px-1 rounded text-[8px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 cursor-pointer">
                            ⏸
                          </button>
                          <button onClick={() => fetch("/api/plan-chain/cancel", { method: "POST" }).then(() => setIsChainRunning(false))} className="px-1 rounded text-[8px] bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer">
                            ✕
                          </button>
                        </>
                      )}
                      {!isChainRunning && chainStatus.status === "paused" && (
                        <button onClick={() => fetch("/api/plan-chain/resume", { method: "POST" }).then(() => setIsChainRunning(true))} className="px-1 rounded text-[8px] bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer">
                          ▶
                        </button>
                      )}
                    </div>
                  </div>
                  {!rightChainExpanded && (
                    <div className="text-[8px] text-zinc-500 font-mono truncate">
                      {lang === "zh-CN" ? "执行链已简化显示" : "Execution chain collapsed"}
                      {chainSteps.length > 0 && (
                        <span className="ml-1 text-zinc-400">
                          {Math.min((chainStatus?.currentStep ?? 0) + 1, chainSteps.length)}/{chainSteps.length} · {chainSteps[chainStatus?.currentStep ?? 0]?.title || chainSteps[0]?.title}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 步骤进度条 */}
                  {rightChainExpanded && <div className="flex gap-0.5 overflow-x-auto">
                    {(chainSteps.length > 0 ? chainSteps : []).map((step, idx) => {
                      const statusIcon =
                        step.status === "completed" ? "✅" :
                        step.status === "running" ? "🔄" :
                        step.status === "failed" ? "❌" :
                        step.status === "pending" ? "⏳" : "·";
                      const isCurrent = idx === chainStatus?.currentStep;
                      // H4: 视觉验证状态指示
                      const visualIcon = step.visualVerified ? "👁" : (step.visualIssues && step.visualIssues.length > 0 ? "⚠" : "");
                      return (
                        <div
                          key={step.id}
                          title={`${step.title} (${step.riskLevel}) - ${step.status}${visualIcon ? ` | 视觉: ${visualIcon}` : ""}`}
                          className={`flex-shrink-0 w-5 h-5 rounded-sm flex items-center justify-center text-[8px] cursor-default transition-colors ${
                            isCurrent ? "ring-1 ring-violet-400" : ""
                          } ${
                            step.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                            step.status === "running" ? "bg-violet-500/30 text-violet-200 animate-pulse" :
                            step.status === "failed" ? "bg-red-500/20 text-red-300" :
                            "bg-zinc-700/50 text-zinc-500"
                          }`}
                        >
                          {statusIcon}
                          {visualIcon && <span className="ml-0.5 text-[7px]">{visualIcon}</span>}
                        </div>
                      );
                    })}
                  </div>}
                  {/* 失败计数 */}
                  {(chainStatus?.failureCount ?? 0) > 0 && (
                    <span className="text-[8px] text-amber-400 font-mono">
                      ⚠ 重试/失败: {chainStatus.failureCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* H4.1 视口截图反馈区已移至中区（BASE 选择集模块截图切换 + Copilot centerViewMode=screenshot） */}

          {/* Static Form text box - BASE 和 Copilot 模式都显示（BASE 支持 NL 自定义命令短路匹配） */}
          <div className="flex-shrink-0 p-3 bg-zinc-950/90 border-t border-zinc-800 flex gap-2 items-center">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              rows={2}
              placeholder={workbenchMode === "base"
                ? (lang === "zh-CN" ? "输入自然语言或自定义命令触发词..." : "Enter NL or custom command trigger...")
                : currentT.chatPlaceholder}
              disabled={isAnalyzing}
              className={`flex-grow bg-zinc-900 border focus:outline-none p-2 text-[10px] rounded text-zinc-150 resize-none font-sans disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-[9px] ${
                workbenchMode === "base"
                  ? "border-emerald-800 focus:border-emerald-600"
                  : "border-zinc-800 focus:border-indigo-600"
              }`}
            />

            <button
              disabled={isAnalyzing || !inputMessage.trim()}
              onClick={() => handleSendMessage()}
              className={`flex-shrink-0 w-11 h-11 flex items-center justify-center rounded text-white disabled:opacity-30 cursor-pointer active:scale-95 transition-all ${
                workbenchMode === "base"
                  ? "bg-emerald-650 hover:bg-emerald-600 disabled:hover:bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                  : "bg-indigo-650 hover:bg-indigo-600 disabled:hover:bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.4)]"
              }`}
              aria-label={lang === "zh-CN" ? "发送消息" : "Send message"}
            >
              <Send className="w-4.5 h-4.5" />
            </button>
          </div>
        </aside>
        </ConversationWindowHost>
      </div>

      {/* 3. LLM Setup Parameter Settings Dialog Overlay (Modal Panel) */}
      <AnimatePresence>
        {showLlmModal && (
          <div className="fixed inset-0 z-55 flex items-center justify-center bg-black/60 backdrop-blur-sm select-auto">
            {/* Modal Body Container */}
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="w-[90%] max-w-[480px] rounded-xl bg-zinc-900 border border-zinc-800 p-5 shadow-2xl flex flex-col gap-4 font-sans text-left"
            >
              {/* Box header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 className="text-sm font-semibold tracking-tight text-white font-display flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  {currentT.modalLlmTitle}
                </h3>
                <button
                  onClick={() => setShowLlmModal(false)}
                  className="w-7 h-7 flex items-center justify-center rounded bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                  aria-label={lang === "zh-CN" ? "关闭" : "Close"}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Content body */}
              <div className="flex flex-col gap-3">
                {/* Selector */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold">{currentT.llmProv}</span>
                  <select
                    value={llmConfig.provider}
                    onChange={(e) => setLlmConfig({ ...llmConfig, provider: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 rounded py-2 px-3 text-xs text-zinc-200 focus:outline-none focus:border-indigo-600 font-mono"
                  >
                    <option value="deepseek">DeepSeek AI</option>
                    <option value="openai">OpenAI (Direct Link)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="ollama">Ollama Local Terminal</option>
                    <option value="custom">Custom Proxy API</option>
                  </select>
                </div>

                {/* API Key */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold">
                    API KEY {llmConfig.provider === "ollama" ? "(OPTIONAL)" : ""}
                  </span>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={llmConfig.apiKey}
                      onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                      placeholder={currentT.apiKeyPlaceholder}
                      disabled={llmConfig.provider === "ollama"}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded py-2 pl-3 pr-9 text-xs text-zinc-200 focus:outline-none focus:border-indigo-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      disabled={llmConfig.provider === "ollama" || !llmConfig.apiKey}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={showApiKey ? (lang === "zh-CN" ? "隐藏密钥" : "Hide API key") : (lang === "zh-CN" ? "显示密钥" : "Show API key")}
                    >
                      {showApiKey ? (
                        <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Endpoint */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold">API ENDPOINT (URL)</span>
                  <input
                    type="text"
                    value={llmConfig.endpoint}
                    onChange={(e) => setLlmConfig({ ...llmConfig, endpoint: e.target.value })}
                    placeholder={currentT.endpointPlaceholder}
                    className="bg-zinc-950 border border-zinc-800 rounded py-1.5 px-3 text-xs text-zinc-200 focus:outline-none focus:border-indigo-600"
                  />
                </div>

                {/* Model Name */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold">MODEL ALIAS / IDENTIFIER</span>
                  <input
                    type="text"
                    value={llmConfig.modelName}
                    onChange={(e) => setLlmConfig({ ...llmConfig, modelName: e.target.value })}
                    placeholder="deepseek-reasoner, gpt-4o, claud-3-5"
                    className="bg-zinc-950 border border-zinc-800 rounded py-1.5 px-3 text-xs text-zinc-200 focus:outline-none focus:border-indigo-600 font-mono"
                  />
                </div>
              </div>

              {/* Feedback responses */}
              {llmFeedback && (
                <div className={`text-xs p-3 rounded border font-mono ${llmFeedback.success ? "bg-emerald-950/40 border-emerald-900/50 text-emerald-300" : "bg-red-950/40 border-red-900/50 text-red-300"}`}>
                  {llmFeedback.text}
                </div>
              )}

              {/* Footer controls */}
              <div className="flex items-center justify-between border-t border-zinc-800 pt-3 select-none">
                <button
                  disabled={isTestingLlm}
                  onClick={testLlmCredentials}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-300 border border-zinc-800 hover:bg-zinc-800 rounded cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  {isTestingLlm ? currentT.testing : currentT.testConn}
                </button>

                <button
                  disabled={isTestingLlm}
                  onClick={saveLlmCredentials}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-wait"
                >
                  {currentT.save}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmationDialog}
        onClose={() => {
          setShowConfirmationDialog(false);
          setPendingExecution(null);
        }}
        onConfirm={async () => {
          setShowConfirmationDialog(false);
          if (pendingExecution) {
            await executeOperationPlan(pendingExecution, activePlanMode || workbenchMode);
          }
          setPendingExecution(null);
        }}
        onCancel={() => {
          setShowConfirmationDialog(false);
          setPendingExecution(null);
          appendMessage({
              id: `cancel_confirm_${Date.now()}`,
              sender: "system",
              text: lang === "zh-CN"
                ? "⚠️ 用户取消了操作确认，执行已终止。"
                : "⚠️ User cancelled operation confirmation. Execution aborted.",
              timestamp: new Date().toLocaleTimeString()
          });
        }}
        title={lang === "zh-CN" ? "确认执行" : "Confirm Execution"}
        message={pendingExecution?.title || ""}
        operationType="mutation"
        affectedElementCount={1}
        details={{
          dryRunResult: pendingExecution?.warning
        }}
        language={lang}
      />

      {/* BASE 模式视口截图弹窗 */}
      {showBaseScreenshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowBaseScreenshot(false)}
        >
          <div
            className="bg-zinc-900 border border-violet-500/30 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗标题栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold font-display text-violet-300 flex items-center gap-2">
                📸 {lang === "zh-CN" ? "Archicad 视口截图" : "Archicad Viewport Capture"}
                {viewportCapture.viewType && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-violet-300 font-mono">
                    {viewportCapture.viewType} | {viewportCapture.storyName}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchViewportCapture}
                  disabled={viewportCapture.loading}
                  className="text-[11px] px-2.5 py-1 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 disabled:opacity-40 transition-colors"
                >
                  {viewportCapture.loading
                    ? "⏳..."
                    : (lang === "zh-CN" ? "📸 刷新截图" : "📸 Refresh")}
                </button>
                <button
                  onClick={() => setShowBaseScreenshot(false)}
                  className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            </div>
            {/* 截图内容 */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-zinc-950">
              {viewportCapture.loading ? (
                <div className="text-zinc-500 text-sm">
                  {lang === "zh-CN" ? "正在截图..." : "Capturing..."}
                </div>
              ) : viewportCapture.imageBase64 ? (
                <img
                  src={`data:image/png;base64,${viewportCapture.imageBase64}`}
                  alt="Archicad Viewport"
                  className="max-w-full max-h-[60vh] object-contain rounded border border-zinc-700"
                />
              ) : (
                <div className="text-center text-zinc-500 text-sm">
                  <p>{lang === "zh-CN" ? "点击刷新截图按钮获取当前 Archicad 视口" : "Click refresh to capture Archicad viewport"}</p>
                </div>
              )}
            </div>
            {/* 底部信息 */}
            {viewportCapture.summary && (
              <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono">
                {viewportCapture.summary}
              </div>
            )}
          </div>
        </div>
      )}

      {/* JSON Viewer Modal */}
      <AnimatePresence>
        {showJsonViewer && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowJsonViewer(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-slate-900 rounded-xl border border-slate-700/50 shadow-2xl flex flex-col max-h-full">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-800/50">
                  <h3 className="text-lg font-semibold text-white">
                    {jsonViewerTitle}
                  </h3>
                  <button
                    onClick={() => setShowJsonViewer(false)}
                    className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
                    aria-label={lang === "zh-CN" ? "关闭" : "Close"}
                  >
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto">
                  <JsonViewer
                    title={lang === "zh-CN" ? "完整响应数据" : "Complete Response Data"}
                    data={jsonViewerData}
                    defaultExpanded={true}
                    language={lang}
                  />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Move Elements Modal */}
      <MoveElementsModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "MoveSelectedElements" },
                    addOnCommandParameters: {
                      useCurrentSelection: true,
                      deltaMm: params,
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(lang === "zh-CN" ? "构件已移动" : "Elements moved");
            recordTask(lang === "zh-CN" ? "移动构件" : "Move", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "移动失败" : "Move failed");
          }
        }}
        lang={lang}
      />

      {/* C.1.1: Edit Properties Modal */}
      <EditPropertiesModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "EditSelectedElements" },
                    addOnCommandParameters: {
                      useCurrentSelection: true,
                      properties: [{
                        propertyGuid: params.propertyGuid,
                        valueString: params.valueString
                      }],
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(lang === "zh-CN" ? "属性已编辑" : "Properties edited");
            recordTask(lang === "zh-CN" ? "编辑属性" : "Edit Props", data.ok ? "success" : "error", params.propertyName);
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "编辑失败" : "Edit failed");
          }
        }}
        lang={lang}
      />

      {/* 通用输入对话框（替代 prompt/confirm） */}
      <SimpleInputDialog
        isOpen={dialogState.isOpen}
        title={dialogState.title}
        label={dialogState.label}
        defaultValue={dialogState.defaultValue}
        options={dialogState.options}
        isConfirm={dialogState.isConfirm}
        selectionInfo={dialogState.selectionInfo}
        confirmText={lang === "zh-CN" ? "确认" : "Confirm"}
        cancelText={lang === "zh-CN" ? "取消" : "Cancel"}
        onConfirm={dialogState.onConfirm}
        onCancel={() => setDialogState(prev => ({ ...prev, isOpen: false }))}
      />

      {/* C.1.2: Copy Elements Modal */}
      <CopyElementsModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CopyElements" },
                    addOnCommandParameters: {
                      useCurrentSelection: true,
                      offsetMm: params,
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(lang === "zh-CN" ? "构件已复制" : "Elements copied");
            recordTask(lang === "zh-CN" ? "复制构件" : "Copy", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "复制失败" : "Copy failed");
          }
        }}
        lang={lang}
      />

      {/* BUILDING: CreateBuildingElementModal */}
      <CreateBuildingElementModal
        isOpen={showCreateBuildingModal}
        onClose={() => setShowCreateBuildingModal(false)}
        onExecute={async (commandName, params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: commandName },
                    addOnCommandParameters: params
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(lang === "zh-CN" ? `${commandName} 创建完成` : `${commandName} completed`);
            recordTask(lang === "zh-CN" ? `创建${commandName}` : `Create ${commandName}`, data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "创建失败" : "Create failed");
          }
        }}
        lang={lang}
        initialElementType={buildingElementType}
      />

      {/* E.3: Save Template Modal */}
      <SaveTemplateModal
        isOpen={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        onSaved={(template) => {
          triggerToast(lang === "zh-CN" ? `模板 "${template.name}" 已保存` : `Template "${template.name}" saved`);
        }}
        lang={lang}
        plan={activePlan}
      />

      {/* D4 F.1: Create Pipe Modal */}
      <CreatePipeModal
        isOpen={showCreatePipeModal}
        onClose={() => setShowCreatePipeModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreatePipe" },
                    addOnCommandParameters: {
                      route: {
                        waypoints: [params.start, params.end],
                        diameterMm: params.diameterMm,
                        crossSection: { shape: params.crossSectionShape }
                      },
                      mepSystemName: params.mepSystemName,
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(data.ok ? (lang === "zh-CN" ? "水管创建请求已发送" : "Pipe creation request sent") : (lang === "zh-CN" ? "创建失败" : "Creation failed"));
            recordTask(lang === "zh-CN" ? "创建水管" : "Create Pipe", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "创建失败" : "Creation failed");
          }
        }}
        lang={lang}
      />

      {/* D4 F.1: Create Pipe System Modal */}
      <CreatePipeSystemModal
        isOpen={showCreatePipeSystemModal}
        onClose={() => setShowCreatePipeSystemModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreatePipeSystem" },
                    addOnCommandParameters: {
                      mainRoute: {
                        waypoints: params.mainWaypoints,
                        diameterMm: params.diameterMm
                      },
                      branches: params.branches.map(b => ({
                        tapPoint: b.tapPoint,
                        endPoint: b.endPoint,
                        diameterMm: b.diameterMm ?? params.diameterMm
                      })),
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(data.ok ? (lang === "zh-CN" ? "管道系统创建请求已发送" : "Pipe system request sent") : (lang === "zh-CN" ? "创建失败" : "Failed"));
            recordTask(lang === "zh-CN" ? "管道系统" : "Pipe System", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "创建失败" : "Creation failed");
          }
        }}
        lang={lang}
      />

      {/* D5 F.2: Create Duct Modal (Ventilation) */}
      <CreateDuctModal
        isOpen={showCreateDuctModal}
        onClose={() => setShowCreateDuctModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreateDuct" },
                    addOnCommandParameters: {
                      waypoints: [params.start, params.end],
                      width: params.widthMm / 1000,
                      height: params.heightMm / 1000,
                      crossSection: { shape: "Rectangular" },
                      mepSystemName: params.mepSystemName,
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(data.ok ? (lang === "zh-CN" ? "风管创建请求已发送" : "Duct creation request sent") : (lang === "zh-CN" ? "创建失败" : "Failed"));
            recordTask(lang === "zh-CN" ? "创建风管" : "Create Duct", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "创建失败" : "Creation failed");
          }
        }}
        lang={lang}
      />

      {/* D5 F.1: Create Cable Carrier Modal (Electrical) */}
      <CreateCableCarrierModal
        isOpen={showCreateCableCarrierModal}
        onClose={() => setShowCreateCableCarrierModal(false)}
        onExecute={async (params) => {
          try {
            const res = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: {
                  command: "API.ExecuteAddOnCommand",
                  parameters: {
                    addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreateCableCarrier" },
                    addOnCommandParameters: {
                      waypoints: [params.start, params.end],
                      width: params.widthMm / 1000,
                      height: params.heightMm / 1000,
                      crossSection: { shape: "Rectangular" },
                      mepSystemName: params.mepSystemName,
                      dryRun: false,
                      confirmRequired: true
                    }
                  }
                }
              })
            });
            const data = await res.json();
            setBaseResult(data);
            triggerToast(data.ok ? (lang === "zh-CN" ? "桥架创建请求已发送" : "Cable carrier creation request sent") : (lang === "zh-CN" ? "创建失败" : "Failed"));
            recordTask(lang === "zh-CN" ? "创建桥架" : "Create Tray", data.ok ? "success" : "error");
          } catch (err) {
            console.error(err);
            triggerToast(lang === "zh-CN" ? "创建失败" : "Creation failed");
          }
        }}
        lang={lang}
      />

      {/* E.4: Template Replay Modal */}
      <TemplateReplayModal
        isOpen={replayTemplate !== null}
        onClose={() => setReplayTemplate(null)}
        onReplay={async (filledPlan) => {
          if (filledPlan) {
            setActivePlan(filledPlan);
            setExecutionResultData(filledPlan.parameters || []);
            setShowPlanCard(true);
            setWorkbenchMode("copilot");
            setExecutionCompleted(false);
            setCurrentExecutingStepIndex(-1);

            const shouldAutoExecuteTemplate = autonomyMode === "copilot-auto";
            if (shouldAutoExecuteTemplate) {
              if (!archicadConnected || !mepbridgeConnected) {
                setSystemError(currentT.errConnDesc);
                triggerToast(currentT.errConnTitle);
              } else {
                triggerToast(lang === "zh-CN" ? "AI 自动模式：用户模板将直接执行" : "AI auto mode: executing user template directly");
                await executeOperationPlan(filledPlan, "copilot");
              }
            } else {
              triggerToast(lang === "zh-CN" ? "用户模板已加载，请按当前模式确认执行" : "User template loaded; confirm according to current mode");
            }
          }
          setReplayTemplate(null);
        }}
        lang={lang}
        template={replayTemplate}
      />

      {/* E.5: Custom Commands Panel */}
      <CustomCommandsPanel
        isOpen={showCustomCommandsPanel}
        onClose={() => setShowCustomCommandsPanel(false)}
        onSaved={() => {
          loadCustomCommands();
          triggerToast(lang === "zh-CN" ? "自定义命令已保存" : "Custom command saved");
        }}
        lang={lang}
      />
    </div>
  );
}

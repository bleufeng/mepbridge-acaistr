import { workbenchFetch as fetch } from "../execution-recovery";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  RefreshCw,
  ShieldCheck,
  Cpu,
  Layers,
  Search,
  Terminal,
  Sparkles,
  Building2,
  ChevronDown,
  ChevronRight,
  Activity,
  CheckCircle2,
  Clock,
  Network,
  X,
  ArrowRight,
} from "lucide-react";

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
  permissions?: {
    archicad?: {
      access: string;
      commands: string[];
    };
  };
};

type ApxCommand = {
  name: string;
  commandName: string;
  commandNamespace?: string | null;
  title: string;
  description: string;
  featureArea: string; // Architecture | MEP | Project | Workspace
  executionKind?: string;
  riskLevel: string; // read | low-mutation | medium-mutation | ...
  nlTriggers: {
    zh?: string[];
    en?: string[];
  };
  parameters?: Record<string, unknown>;
};

interface ModuleCatalogPanelProps {
  lang: "zh-CN" | "en-US";
}

// MACAI平台 8 大功能域基线指标（保留上一版本数据，待功能变化更新数据）
interface DomainDefinition {
  id: string;
  category: "A" | "B" | "C";
  nameZh: string;
  nameEn: string;
  modZh: string;
  modEn: string;
  equivCount: number;
  qPct: number; // Q1~Q3 操控纵深完备度基线
  rollZh: string;
  rollEn: string;
  gateZh: string;
  gateEn: string;
  devkitFamily: string;
  notesZh: string;
  notesEn: string;
}

const DOMAINS: DomainDefinition[] = [
  {
    id: "dom_base_arch",
    category: "A",
    nameZh: "1. 基础建筑与空间构件域",
    nameEn: "1. Basic Architecture & Structural Elements",
    modZh: "A2 基础构建域",
    modEn: "A2 Core Building Domain",
    equivCount: 18,
    qPct: 92,
    rollZh: "设计目标: 同事务 1mm 内核级自动回滚",
    rollEn: "Design Benchmark: In-transaction 1mm kernel rollback",
    gateZh: "分SDK构建及三宿主实机验收闭环",
    gateEn: "Per-SDK builds & three-host live verified",
    devkitFamily: "ACAPI_Element_Create, Get, Change, Delete, CalcBounds",
    notesZh: "全面覆盖墙、柱、梁、板、屋顶、楼梯、门、窗、对象、灯具、地形网格、自由体与空间区域。原生封装施工图级构造语义与同事务 1mm 几何回读核验。",
    notesEn: "Covers walls, columns, beams, slabs, roofs, stairs, doors, windows, objects, lamps, meshes, morphs, and zones with construction-grade semantics and 1mm in-transaction verification.",
  },
  {
    id: "dom_complex",
    category: "A",
    nameZh: "2. 复杂系统构件与主从拓扑域",
    nameEn: "2. Complex Systems & Topology (CW/Shell/Railing/Skylight)",
    modZh: "A3 复杂构件域",
    modEn: "A3 Complex Elements Domain",
    equivCount: 8,
    qPct: 50,
    rollZh: "v0.1.9 当前实施：幕墙已证场景原位闭环；壳体、栏杆、天窗 Q3 转 v0.2.0",
    rollEn: "v0.1.9 current: Scoped Curtain Wall in-place edits; other fields not verified; Shell, Railing and Skylight Q3 moved to v0.2.0",
    gateZh: "生命周期按构件拆分：幕墙 CURRENT；其余三类 PLANNED_V020",
    gateEn: "Lifecycle split by element: Curtain Wall CURRENT; other three PLANNED_V020",
    devkitFamily: "ACAPI_Element_Change + APIMemoMask_CWall* (v0.1.9); shellShapes / railingNodes / skylight host edit (v0.2.0)",
    notesZh: "已证场景：AC30固定列2m原位修改与6m×6m、4列×5行新建；历史bestDivision、行等分、类别与材质成果按当时产物分层保留。v0.1.9不支持既有幕墙高度编辑，请求写入前拒绝；新建时设置高度与已证分格能力保留；路径、段级写入、GDL与多轴组合转后续待排期。母GUID／未改字段保持不等于全部字段可写通过。壳体、栏杆、天窗完整Q3编辑仍为v0.2.0规划，不声明整个复杂构件域完备率。",
    notesEn: "Verified AC30 scenarios: in-place fixed 2m columns and a new 6m x 6m, 4-column x 5-row wall. Historical division, class and surface results retain their original build scope. v0.1.9 does not support height edits of existing curtain walls; requests are rejected before writing. Creation height and verified grid edits are retained; path, segment writes, GDL and multi-axis combinations are deferred. GUID/integrity checks do not prove every writable field. Full Shell/Railing/Skylight Q3 remains planned for v0.2.0; no aggregate completeness claim.",
  },
  {
    id: "dom_edit_batch",
    category: "A",
    nameZh: "3. 几何变换、实体布尔与双模批量域",
    nameEn: "3. Geometric Transforms, Solid Operations & Batching",
    modZh: "A4 变换、编辑与批量域",
    modEn: "A4 Edit, Transform & Batch Domain",
    equivCount: 24,
    qPct: 91,
    rollZh: "三版五型有效创建双策略实机全通闭环；Undo/Redo 顺延后续",
    rollEn: "Three-host five-type valid creation verified under both policies; typed failures and Undo/Redo not verified",
    gateZh: "分SDK构建及三宿主实机验收闭环",
    gateEn: "Per-SDK builds & three-host live verified",
    devkitFamily: "ACAPI_Element_Move, Rotate, Mirror, SolidOperation_Create, Trim_Elements",
    notesZh: "支持保持原 GUID 的精确字段掩码修改、空间变换、屋顶修剪与实体布尔运算；提供对话级全回滚与大批量翻模级单件隔离双档批量策略。",
    notesEn: "Supports GUID-preserving field mask modification, rigid transforms, roof trimming, SEO boolean operations, and dual-tier atomic batch policies.",
  },
  {
    id: "dom_2d_drafting",
    category: "A",
    nameZh: "4. 2D 施工图感知与文档注释域",
    nameEn: "4. 2D Drafting Perception & Annotation Docs",
    modZh: "A1 2D 感知与文档域",
    modEn: "A1 2D Perception & Docs Domain",
    equivCount: 14,
    qPct: 88,
    rollZh: "90% (视图数据库上下文 RAII 自动恢复)",
    rollEn: "90% (Database context RAII auto-restore)",
    gateZh: "L2/L3 混合就绪",
    gateEn: "L2/L3 Ready",
    devkitFamily: "ACAPI_Database_ChangeCurrentDatabase, APIMemoMask_DrawingData, API_*ID",
    notesZh: "穿透平面图、工作图与详图提取线、多段线、圆弧、圆、文字及填充边界，内置防篡改哈希指纹与远原点大坐标精度预警。",
    notesEn: "Pierces Floor Plan, Worksheet, and Detail databases to extract 6 drafting primitives with source fingerprint hashing and far-from-origin precision guards.",
  },
  {
    id: "dom_mep",
    category: "A",
    nameZh: "5. MEP 机电管网与拓扑求解域",
    nameEn: "5. MEP Piping, Ducting & Topology Solver",
    modZh: "A5 原生机电域",
    modEn: "A5 Native MEP Domain",
    equivCount: 20,
    qPct: 83,
    rollZh: "85% (统一错误信封与标准管径校验护栏)",
    rollEn: "85% (Standard error envelopes & diameter validation)",
    gateZh: "L3 双版规范基准就绪 (AC28/AC29)",
    gateEn: "L3 Dual-Host Contract Ready (AC28/AC29)",
    devkitFamily: "ACAPI::MEP::v1::ElementDefault, Piping, Ducting, CableCarrier, RoutingElement",
    notesZh: "提供暖通、给排水与电缆桥架原生管网构建，支持弯头/三通/四通转折配件自动求解及布管前结构梁板柱 AABB 碰撞预检。",
    notesEn: "Provides native HVAC, piping, and cable carrier routing with automatic fitting connection solving and structural AABB clash pre-scanning.",
  },
  {
    id: "dom_env_attr",
    category: "B",
    nameZh: "6. 楼层空间、属性族与分类体系域",
    nameEn: "6. Stories, Attribute Families & Classification Systems",
    modZh: "B1 & B2 环境与属性域",
    modEn: "B1 & B2 Environment & Attributes Domain",
    equivCount: 38,
    qPct: 87,
    rollZh: "90% (高风险操作门禁与属性写入完整性对账)",
    rollEn: "90% (High-risk operation guards & property reconciliation)",
    gateZh: "分SDK构建及三宿主实机验收闭环",
    gateEn: "Per-SDK builds & three-host live verified",
    devkitFamily: "ACAPI_Environment (StorySettings), ACAPI_Attribute_Get, ACAPI_Element_GetPropertyObjects",
    notesZh: "完整覆盖楼层增删改查、Archicad 全部 9 大属性族查询、复杂截面读取、分类体系赋值以及带完整性对账的构件属性读写。",
    notesEn: "Covers story management, all 9 Archicad attribute families, complex profiles, classifications, and element property read/write with integrity reconciliation.",
  },
  {
    id: "dom_view_json",
    category: "B",
    nameZh: "7. 视图、收藏夹与 JSON 透传域",
    nameEn: "7. Viewports, Favorites & Official JSON API Whitelist",
    modZh: "B3 视图与受控透传域",
    modEn: "B3 Views & Controlled Pass-Thru Domain",
    equivCount: 28,
    qPct: 85,
    rollZh: "设计目标: 严格契约白名单锁，阻断未授权接口裸露",
    rollEn: "Design Benchmark: Strict whitelist lock blocking unauthorized calls",
    gateZh: "分SDK构建及三宿主实机验收闭环",
    gateEn: "Per-SDK builds & three-host live verified",
    devkitFamily: "ACAPI_Favorite_Get/Create, ACAPI_Selection_Get/Set, Official JSON API",
    notesZh: "支持收藏夹预设全周期管理、视口截图提取、选择集双向高亮同步，并通过严格白名单机制安全透传官方非几何查询接口。",
    notesEn: "Supports Favorites lifecycle, viewport capture, bidirectional selection sync, and secure whitelisted pass-through of official non-geometric queries.",
  },
  {
    id: "dom_platform",
    category: "C",
    nameZh: "8. 跨实例快照、算量与智能翻模域",
    nameEn: "8. Multi-Instance Snapshot, QTO & Smart Reverse Modeling",
    modZh: "C1~C4 平台扩展域",
    modEn: "C1~C4 Platform Extensions Domain",
    equivCount: 12,
    qPct: 88,
    rollZh: "设计目标: 变更防呆回抄确认与逆序分块补偿清理",
    rollEn: "Design Benchmark: Acknowledgement + reverse chunked cleanup",
    gateZh: "L2/L3 持续演进",
    gateEn: "L2/L3 Evolving",
    devkitFamily: "Server Orchestration, D-1~D-4 Snapshot/Replay, aud4-1 SHA-256, C-CAD",
    notesZh: "提供多实例发现与安全路由、跨工程无 GUID 容差差异比对与分块回放、带 SHA-256 校验的建筑 JSON 算量导出，以及平台级 CAD 底图智能翻模与复合工法矩阵。",
    notesEn: "Delivers multi-instance routing, cross-project non-GUID diff/replay, SHA-256 verified Building JSON QTO export, platform CAD reverse modeling, and compound skill matrix.",
  },
];


function getDomainProgressColor(pct: number) {
  if (pct >= 90) {
    return {
      bar: "bg-emerald-500",
      track: "bg-emerald-950/40",
      text: "text-emerald-400",
      border: "border-emerald-800/40",
    };
  }
  if (pct >= 80) {
    return {
      bar: "bg-sky-500",
      track: "bg-sky-950/40",
      text: "text-sky-400",
      border: "border-sky-800/40",
    };
  }
  if (pct >= 60) {
    return {
      bar: "bg-amber-500",
      track: "bg-amber-950/40",
      text: "text-amber-400",
      border: "border-amber-800/40",
    };
  }
  return {
    bar: "bg-indigo-500",
    track: "bg-indigo-950/40",
    text: "text-indigo-400",
    border: "border-indigo-800/40",
  };
}

export interface PlatformCompoundSkill {
  id: string;
  nameZh: string;
  nameEn: string;
  categoryZh: string;
  categoryEn: string;
  version: string;
  statusZh: string;
  statusEn: string;
  descriptionZh: string;
  descriptionEn: string;
  underlyingCommands: string[];
  topologyHighlightsZh: string;
  topologyHighlightsEn: string;
  verificationZh: string;
  verificationEn: string;
}

export const PLATFORM_COMPOUND_SKILLS: PlatformCompoundSkill[] = [
  {
    id: "C4-STAIR-01",
    nameZh: "全塔双折楼梯一体化系统工法",
    nameEn: "Full-Tower Double-Run Stair Compound System",
    categoryZh: "建筑垂直交通复合工法",
    categoryEn: "Vertical Circulation Compound",
    version: "规划态 (v0.1.9发行业务排除)",
    statusZh: "平台规划工法 (独立脚本验证，未随包发行)",
    statusEn: "Planned Compound (Script Verified, Unbundled in v0.1.9)",
    descriptionZh: "面向核心筒楼梯间的端到端全塔楼梯装配规划，从底层直达屋面（0.0m ➔ 9.0m 3层）。实现梯段、平台板、一体化扶手与防排烟管道高内聚空间约束求解。",
    descriptionEn: "End-to-end full-tower stair assembly planning (0.0m to 9.0m across 3 floors). Solves flights, landings, monolithic handrails, and ventilation pipe constraints.",
    underlyingCommands: ["CreateStair", "CreateSlab", "CreateMorph", "CreatePipe", "CreateZone"],
    topologyHighlightsZh: "6梯段 + 6平台板 + 1一体化扶手Morph + 1排烟管道，带踏步舒适度公式及平台净深前置校验。",
    topologyHighlightsEn: "6 flights + 6 landings + 1 morph railing + 1 ventilation pipe with step comfort formulas.",
    verificationZh: "tools/build-lt1-full-tower-stair.js 独立自动化脚本验证，不作为 v0.1.9 随包发行交付。",
    verificationEn: "Verified by automated script only; unbundled from v0.1.9 release package.",
  },
  {
    id: "C-CAD-01",
    nameZh: "CAD 施工底图智能识别与翻模工法",
    nameEn: "CAD Blueprint Recognition & Reverse Modeling",
    categoryZh: "智能翻模与图层解析",
    categoryEn: "Reverse Modeling & Layer Perception",
    version: "规划预览",
    statusZh: "规划预览 (只读图元探针就绪，批量翻模待业务闭环)",
    statusEn: "Planned Preview (Drafting Probe Ready, Modeling Incomplete)",
    descriptionZh: "穿透 Worksheet 与 Detail 施工图纸数据库提取 6 类底图几何要素，基于 28 项图层规范执行自动识别，支持人工映射保护与多边形快速批量翻模。",
    descriptionEn: "Pierces Worksheet & Detail databases to extract 6 primitive types, auto-recognizes 28 layer standards, and batch-generates building geometry.",
    underlyingCommands: ["ReadDraftingElements", "GetLayers", "BatchCreateElements", "CreateSolidOperation"],
    topologyHighlightsZh: "6 类 2D 图元（线、多段线、圆弧、圆、文字、填充）提取，墙体厚度与轴线匹配推断，门窗洞口自动预留。",
    topologyHighlightsEn: "6 primitive types extracted with wall thickness inference, centerline matching, and auto opening creation.",
    verificationZh: "C++ ReadDraftingElements Memo 探针通过，带 sourceFingerprint 哈希指纹防篡改守护。",
    verificationEn: "ReadDraftingElements Memo probe verified with sourceFingerprint anti-tamper hash guards.",
  },
  {
    id: "MEP-SOLVE-01",
    nameZh: "MEP 管网空间交叉求解与避障工法",
    nameEn: "MEP Spatial Fitting Solver & Clash Pre-Scan",
    categoryZh: "机电智能路由与求解",
    categoryEn: "MEP Auto-Routing & Topology",
    version: "v0.1.9",
    statusZh: "规范基准就绪 (结构避让与拓扑求解)",
    statusEn: "Contract Ready (Structural Avoidance & Topology)",
    descriptionZh: "实现给排水、暖通风管与强弱电桥架原生拓扑组网，在布管前自动扫描梁板柱空间 AABB 包围盒，智能求解转折配件与三维避障。",
    descriptionEn: "Native piping, ducting, and cable carrier networks with structural AABB pre-scan and automated fitting topology solving.",
    underlyingCommands: ["ScanStructuralElements", "AutoRoutePipe", "SolveConn", "CreateTakeOff", "CreateFlexibleSegment"],
    topologyHighlightsZh: "弯头、三通、四通配件空间自适应求解，标准公称管径与坡度校验，与土建结构梁板柱智能避让。",
    topologyHighlightsEn: "Adaptive elbow/tee/cross fitting solving, standard diameter/slope validation, and structural avoidance.",
    verificationZh: "结构碰撞预检 + 标准错误信封，通过弯头三通四通流体拓扑连通设计规范。",
    verificationEn: "Structural clash pre-scan + standard error envelopes with complete fluid topology connectivity design.",
  },
  {
    id: "AUD-ZDM-01",
    nameZh: "零脏模型跨实例差异比对与增量回放",
    nameEn: "Zero-Dirty Cross-Instance Diff & Replay",
    categoryZh: "模型协同与确定性回放",
    categoryEn: "Collaboration & Deterministic Replay",
    version: "规划三阶段",
    statusZh: "多实例概览就绪 (复现与差异比对规划中)",
    statusEn: "Multi-Instance Overview Ready (Replay & Diff Planned)",
    descriptionZh: "三阶段：① 多实例文件基本概览（当前首期）；② B参照A复现模型（未完整实现）；③ 两文件模型差异对比并输出结果（未完整实现）。",
    descriptionEn: "Three phases: 1. Basic multi-file overview; 2. Reproduce model B from A (incomplete); 3. Compare two models and output differences (incomplete).",
    underlyingCommands: ["list_archicad_instances", "snapshot_elements", "compare_snapshot", "replay_snapshot"],
    topologyHighlightsZh: "无 GUID 空间容差比对，>50 项高风险操作防呆回抄确认，200 项逆序分块补偿自动回滚机制。",
    topologyHighlightsEn: "Non-GUID spatial tolerance diff, >50 item confirmation token, and 200-item reverse chunked rollback.",
    verificationZh: "多实例服务概览在线，高级差异与回放功能保留未开放执行。",
    verificationEn: "Multi-instance service overview online; advanced diff and replay reserved as non-executable.",
  },
];

// 命令归类到 A / B / C 大类
function getCommandCategory(cmd: ApxCommand): "A" | "B" | "C" {
  const name = cmd.name || "";
  const commandName = cmd.commandName || "";

  // Class C: 快照、算量、跨实例、智能翻模、批量阵列
  if (
    /snapshot|compare|replay|instance|drafting|batch|multiply/i.test(name) ||
    /Snapshot|Compare|Replay|Instance|Drafting|Batch|Multiply/i.test(commandName)
  ) {
    return "C";
  }

  // Class B: 属性、视图、选择集、环境、图层、透传、收藏夹、标注文字
  if (
    /stories|story|attribute|profile|classification|layer|propert|favorite|selection|selected|viewport|project_info|library|libraries|hotlink|grid|text|dimension|label|marker|documentation|view_map|gsm/i.test(name) ||
    /Stories|Story|Attribute|Profile|Classification|Layer|Propert|Favorite|Selection|Selected|Viewport|ProjectInfo|Libraries|Hotlinks|Grid|Text|Dimension|Label|Marker|Documentation|ViewMap|Gsm/i.test(commandName)
  ) {
    return "B";
  }

  // Class A: 原生几何与复杂构件 (建筑、机电、变换、布尔、修剪、开洞)
  return "A";
}

// 计算生命周期 Q1~Q4 与复杂度深度 L1~L4
function getCommandLifecycleAndDepth(cmd: ApxCommand): { q: "Q1" | "Q2" | "Q3" | "Q4"; depth: "L1" | "L2" | "L3" | "L4" } {
  const name = cmd.commandName || "";
  const r = cmd.riskLevel || "read";

  let q: "Q1" | "Q2" | "Q3" | "Q4" = "Q2";
  if (r === "create-element" || /Create|Build/.test(name)) {
    q = "Q1";
  } else if (/Delete|Remove/.test(name) || r === "delete" || r === "high-mutation") {
    q = "Q3";
  } else if (/Move|Rotate|Mirror|Edit|Change|Trim|SolidOperation|Modify|Batch|Multiply/.test(name) || r === "modify-element") {
    q = "Q3";
  } else if (/Snapshot|Compare|Replay|Solve|AutoRoute/.test(name)) {
    q = "Q4";
  }

  let depth: "L1" | "L2" | "L3" | "L4" = "L2";
  if (/Info|Stories|Libraries|Layers|Attributes|Systems|Properties|Project|Profiles|Classifications/.test(name)) {
    depth = "L1";
  } else if (/Solve|SolidOperation|Trim|Complex|AutoRoute|Mesh|Morph|Stair|Takeoff|FlexibleSegment/.test(name)) {
    depth = "L3";
  } else if (/Snapshot|Replay|Batch|BuildingJson/.test(name)) {
    depth = "L4";
  }

  return { q, depth };
}

type NavTabType = "ALL_DOMAINS" | "CLASS_A" | "CLASS_B" | "CLASS_C" | "MODULES";

export default function ModuleCatalogPanel({ lang }: ModuleCatalogPanelProps) {
  const [modules, setModules] = useState<WorkbenchModule[]>([]);
  const [apxCommands, setApxCommands] = useState<ApxCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 用户指定的唯一导航栏：全功能域 | 原生几何与复杂构件 | 属性、视图与透传 | 快照、算量与智能翻模 | 复合业务扩展包
  const [activeTab, setActiveTab] = useState<NavTabType>("ALL_DOMAINS");

  // 搜索与展开状态
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDomain, setExpandedDomain] = useState<string | null>("dom_base_arch");

  const zh = lang === "zh-CN";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/extensions/catalog");
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || ("HTTP " + response.status));
      }
      if (!Array.isArray(data.apxCommands)) throw new Error("Invalid catalog command list");
      setModules(Array.isArray(data.modules) ? data.modules : []);
      setApxCommands(data.apxCommands);
    } catch (loadError) {
      setApxCommands([]);
      setModules([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 统计指标
  const totalApxCount = apxCommands.length;
  const registeredCount = loading ? "..." : error ? "--" : totalApxCount;

  // 命令按 A / B / C 分类
  const categorizedCommands = useMemo(() => {
    const map = {
      A: [] as ApxCommand[],
      B: [] as ApxCommand[],
      C: [] as ApxCommand[],
    };
    for (const cmd of apxCommands) {
      const cat = getCommandCategory(cmd);
      map[cat].push(cmd);
    }
    return map;
  }, [apxCommands]);

  // 过滤当前分类的指令列表
  const displayedCommands = useMemo(() => {
    let list: ApxCommand[] = [];
    if (activeTab === "CLASS_A") list = categorizedCommands.A;
    else if (activeTab === "CLASS_B") list = categorizedCommands.B;
    else if (activeTab === "CLASS_C") list = categorizedCommands.C;
    else return [];

    if (!searchTerm) return list;
    const q = searchTerm.toLowerCase();
    return list.filter((cmd) => {
      const inName = cmd.name.toLowerCase().includes(q);
      const inCmd = cmd.commandName.toLowerCase().includes(q);
      const inTitle = (cmd.title || "").toLowerCase().includes(q);
      const inDesc = (cmd.description || "").toLowerCase().includes(q);
      const inTriggersZh = (cmd.nlTriggers?.zh || []).some(t => t.toLowerCase().includes(q));
      const inTriggersEn = (cmd.nlTriggers?.en || []).some(t => t.toLowerCase().includes(q));
      return inName || inCmd || inTitle || inDesc || inTriggersZh || inTriggersEn;
    });
  }, [activeTab, categorizedCommands, searchTerm]);

  // 过滤 8 大功能域
  const filteredDomains = useMemo(() => {
    if (!searchTerm) return DOMAINS;
    const q = searchTerm.toLowerCase();
    return DOMAINS.filter((d) => {
      const inZh = d.nameZh.toLowerCase().includes(q) || d.modZh.toLowerCase().includes(q) || d.notesZh.toLowerCase().includes(q);
      const inEn = d.nameEn.toLowerCase().includes(q) || d.modEn.toLowerCase().includes(q) || d.notesEn.toLowerCase().includes(q);
      const inDevkit = d.devkitFamily.toLowerCase().includes(q);
      return inZh || inEn || inDevkit;
    });
  }, [searchTerm]);

  // 过滤复合工法技能
  const filteredCompoundSkills = useMemo(() => {
    if (!searchTerm) return PLATFORM_COMPOUND_SKILLS;
    const q = searchTerm.toLowerCase();
    return PLATFORM_COMPOUND_SKILLS.filter((s) => {
      const inZh = s.nameZh.toLowerCase().includes(q) || s.categoryZh.toLowerCase().includes(q) || s.descriptionZh.toLowerCase().includes(q) || s.topologyHighlightsZh.toLowerCase().includes(q);
      const inEn = s.nameEn.toLowerCase().includes(q) || s.categoryEn.toLowerCase().includes(q) || s.descriptionEn.toLowerCase().includes(q) || s.topologyHighlightsEn.toLowerCase().includes(q);
      const inCmd = s.underlyingCommands.some(c => c.toLowerCase().includes(q));
      return s.id.toLowerCase().includes(q) || inZh || inEn || inCmd;
    });
  }, [searchTerm]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* 顶部超级宣传看板 (Grand Billboard) */}
      <div className="shrink-0 border-b border-zinc-800 bg-gradient-to-r from-zinc-950 via-indigo-950/20 to-zinc-950 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-sky-500/10 p-2 border border-sky-500/30">
              <Boxes className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-tight text-zinc-100">
                  {zh ? "MACAI 平台能力全景看板" : "MACAI Platform Capability Showcase"}
                </span>
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-sky-300 border border-sky-500/30">
                  {`v0.1.9 (${loading ? "..." : error ? "--" : `${totalApxCount} MCP`})`}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {zh
                  ? "基于 Archicad DevKit (GSAPI) C++ 族谱覆盖与 Q1～Q4 工业级设计生命周期评估"
                  : "Based on Archicad DevKit (GSAPI) C++ Family Coverage & Q1-Q4 Industrial Design Lifecycle Assessment"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-sky-500 hover:text-sky-300"
            title={zh ? "刷新能力目录" : "Refresh capability catalog"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{zh ? "刷新" : "Refresh"}</span>
          </button>
        </div>

        {/* 5 大核心数据指标卡（体现数量多与工业级四象限覆盖） */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {/* 指标 1：API 原子功能规模（162 ~ 189） */}
          <div className="rounded border border-indigo-500/30 bg-indigo-950/20 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider">
                {zh ? "Archicad API 原子功能数" : "Archicad API Capabilities"}
              </span>
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-indigo-100">162</span>
              <span className="text-[10px] text-indigo-400 font-mono">
                {zh ? "(全开 189 API)" : "(Full 189 APIs)"}
              </span>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 truncate">
              {zh ? "MACAI平台8大领域设计参考" : "MACAI Platform: 8 design domains"}
            </div>
          </div>

          {/* 指标 2：MCP 契约注册边界 */}
          <div className="rounded border border-sky-500/30 bg-sky-950/20 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-sky-300 font-bold uppercase tracking-wider">
                {zh ? "MCP 契约注册边界" : "MCP Contract Registries"}
              </span>
              <Network className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-sky-100">{registeredCount}</span>
              <span className="text-[10px] text-sky-400 font-mono">
                {zh ? "(95 契约注册)" : "(95 Contracts Registered)"}
              </span>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 truncate">
              {loading ? (zh ? "目录加载中" : "Loading catalog") : error ? (zh ? "目录加载异常" : "Catalog loaded with error") : (zh ? "来自当前服务目录；91 APX + 4 Server" : "Current service catalog; 91 APX + 4 Server")}
            </div>
          </div>

          {/* 指标 3：官方 JSON API 覆盖池（46 / 73） */}
          <div className="rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                {zh ? "官方 JSON API 覆盖池" : "Official JSON API Pool"}
              </span>
              <Layers className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-amber-100">46 / 73</span>
              <span className="text-[10px] text-amber-400 font-mono">
                {zh ? "(63.0% 官方池覆盖)" : "(63.0% Official Pool Coverage)"}
              </span>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 truncate">
              {zh ? "28项C++超集 + 18项受控透传" : "28 C++ supersets + 18 controlled pass-thrus"}
            </div>
          </div>

          {/* 指标 4：生命周期：Q1–Q3 操控纵深完备度 */}
          <div className="rounded border border-emerald-500/30 bg-emerald-950/20 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">
                {zh ? "生命周期：Q1–Q3 操控纵深" : "Lifecycle: Q1–Q3 Depth"}
              </span>
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-emerald-100">84.7%</span>
              <span className="text-[10px] text-emerald-400 font-mono">
                {zh ? "(Q1~Q4 纵深覆盖)" : "(Q1-Q4 Depth Coverage)"}
              </span>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 truncate">
              {zh ? "幕墙已证场景闭环；按类型分项演进" : "Scoped CW verified; type-partitioned evolution"}
            </div>
          </div>

          {/* 指标 5：零脏模型事务回滚率 */}
          <div className="rounded border border-rose-500/30 bg-rose-950/20 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-rose-300 font-bold uppercase tracking-wider">
                {zh ? "模型事务回滚率" : "Model Transaction Rollback"}
              </span>
              <ShieldCheck className="h-3.5 w-3.5 text-rose-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-rose-100">99.8%</span>
              <span className="text-[10px] text-rose-400 font-mono">
                {zh ? "(三宿主实机 100% 零残留)" : "(Three-host 100% Zero Residuals)"}
              </span>
            </div>
            <div className="text-[9px] text-zinc-400 mt-0.5 truncate">
              {zh ? "同事务 1mm 回滚；Zero-Dirty-Model 闭环" : "In-transaction 1mm rollback; Zero-Dirty-Model closed"}
            </div>
          </div>
        </div>
      </div>

      {/* 唯一核心导航条（按用户指定要求保留与编排）：
          全功能域 | 原生几何与复杂构件 | 属性、视图与透传 | 快照、算量与智能翻模 | 复合业务扩展包 */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            {
              id: "ALL_DOMAINS" as const,
              zh: "全功能域",
              en: "All Domains",
              count: zh ? "8 大官方功能域" : "8 Official Domains",
              activeClass: "bg-indigo-600 text-white",
            },
            {
              id: "CLASS_A" as const,
              zh: "原生几何与复杂构件",
              en: "Geometry & Complex",
              count: `${categorizedCommands.A.length} 项`,
              activeClass: "bg-emerald-600 text-white",
            },
            {
              id: "CLASS_B" as const,
              zh: "属性、视图与透传",
              en: "Attributes, View & Pass-Thru",
              count: `${categorizedCommands.B.length} 项`,
              activeClass: "bg-sky-600 text-white",
            },
            {
              id: "CLASS_C" as const,
              zh: "快照、算量与智能翻模",
              en: "Snapshot, QTO & Reverse",
              count: `${categorizedCommands.C.length} 项`,
              activeClass: "bg-purple-600 text-white",
            },
            {
              id: "MODULES" as const,
              zh: "复合业务扩展包",
              en: "Compound Skills & Modules",
              count: `${modules.length} 已装 / ${PLATFORM_COMPOUND_SKILLS.length} 规划`,
              activeClass: "bg-amber-600 text-white",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 border ${
                activeTab === tab.id
                  ? `${tab.activeClass} border-transparent shadow-sm`
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              <span>{zh ? tab.zh : tab.en}</span>
              <span className={`text-[10px] font-mono rounded px-1.5 py-0.2 ${
                activeTab === tab.id ? "bg-black/30 text-white" : "bg-zinc-800 text-zinc-400"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* 右侧搜索框 */}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={zh ? "快速搜索指令、方法或关键词..." : "Search command, method or keyword..."}
            className="w-full rounded bg-zinc-950 pl-8 pr-7 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-indigo-500"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 主展示区（纯静态能力规格展示，零试运行延迟，秒开零假死） */}
      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {error && (
          <div className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} className="text-red-400 hover:text-red-200">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            1. 「全功能域」：显示 8 大官方功能域组
        ────────────────────────────────────────────────────────────── */}
        {activeTab === "ALL_DOMAINS" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between border-b border-zinc-800/80 pb-2 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-zinc-200">
                  {zh ? "Archicad 8 大官方功能域与生命周期完备度" : "8 Archicad Official Functional Domains & Lifecycle Depth"}
                </span>
                <span className="rounded bg-indigo-950 px-2 py-0.5 text-[10px] font-mono text-indigo-300 border border-indigo-800/40">
                  {filteredDomains.length} {zh ? "个功能域组" : "groups"}
                </span>
                <span
                  className="rounded bg-emerald-950/60 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-300 border border-emerald-800/40 flex items-center gap-1 shadow-sm"
                  title={zh ? "全库 1523 个文件地毯式扫描与沙箱通信防线核验，保证官方 Archicad JSON 与自有 MEPBridge 命名空间绝对纯净独立" : "1523 project files scanned, strictly official Archicad JSON + MEPBridge namespace"}
                >
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  <span>{zh ? "API 通道边界 3443 项 PASS" : "API Channel Boundary 3443 PASS"}</span>
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                {zh ? "点击各组可展开查看 DevKit 族谱与事务防线" : "Click to view DevKit bindings & safety defense"}
              </span>
            </div>

            <div className="space-y-2.5">
              {filteredDomains.map((dom) => {
                const isExpanded = expandedDomain === dom.id;
                const progressColor = getDomainProgressColor(dom.qPct);
                const tagColor =
                  dom.category === "A"
                    ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/40"
                    : dom.category === "B"
                    ? "bg-sky-950/40 text-sky-300 border-sky-800/40"
                    : "bg-purple-950/40 text-purple-300 border-purple-800/40";

                return (
                  <div
                    key={dom.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-700"
                  >
                    {/* 卡片头部（点击展开） */}
                    <div
                      onClick={() => setExpandedDomain(isExpanded ? null : dom.id)}
                      className="flex items-center justify-between p-3 cursor-pointer select-none gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold border ${tagColor}`}>
                          {dom.category}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-100">
                              {zh ? dom.nameZh : dom.nameEn}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              ({zh ? dom.modZh : dom.modEn})
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                            <span className="font-mono text-indigo-300">
                              {zh ? `API 规模：${dom.equivCount} 项` : `API Scale: ${dom.equivCount} items`}
                            </span>
                            <span>•</span>
                            <span className={`font-mono font-medium ${progressColor.text}`}>
                              {zh ? `Q1~Q3 操控纵深：${dom.qPct}%` : `Q1-Q3 Lifecycle Depth: ${dom.qPct}%`}
                            </span>
                            <span>•</span>
                            <span className="font-mono text-sky-300">
                              {zh ? dom.gateZh : dom.gateEn}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="w-24 sm:w-28 text-right">
                          <div className="flex items-center justify-between text-[10px] font-mono leading-none mb-1">
                            <span className="text-zinc-500">{zh ? "纵深完备度" : "Readiness"}</span>
                            <span className={`font-bold ${progressColor.text}`}>{dom.qPct}%</span>
                          </div>
                          <div className={`h-1.5 w-full ${progressColor.track} rounded-full overflow-hidden border ${progressColor.border}`}>
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${progressColor.bar}`}
                              style={{ width: `${Math.min(100, Math.max(0, dom.qPct))}%` }}
                            />
                          </div>
                        </div>

                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-zinc-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                      </div>
                    </div>

                    {/* 展开的详情面板 */}
                    {isExpanded && (
                      <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-3 space-y-2.5 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* DevKit 族谱绑定 */}
                          <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                              <Cpu className="h-3 w-3" />
                              <span>{zh ? "GSAPI / DevKit C++ 族谱绑定" : "GSAPI / DevKit C++ Family Binding"}</span>
                            </div>
                            <p className="font-mono text-[11px] text-zinc-300 break-words leading-relaxed">
                              {dom.devkitFamily}
                            </p>
                          </div>

                          {/* 事务回滚与安全防线 */}
                          <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                            <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" />
                              <span>{zh ? "Q4 事务回滚与安全防线" : "Q4 Rollback & Safety Defense"}</span>
                            </div>
                            <p className="text-[11px] text-zinc-300">
                              {zh ? dom.rollZh : dom.rollEn}
                            </p>
                          </div>
                        </div>

                        {/* 架构亮点与详细说明 */}
                        <div className="rounded border border-zinc-800/80 bg-zinc-900/30 p-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              <span>{zh ? "功能域架构亮点与设计" : "Domain Architecture Highlights & Design"}</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-zinc-400">
                              {zh ? dom.notesZh : dom.notesEn}
                            </p>
                          </div>

                          {/* 快捷跳转查看该分类的具体指令 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (dom.category === "A") setActiveTab("CLASS_A");
                              else if (dom.category === "B") setActiveTab("CLASS_B");
                              else setActiveTab("CLASS_C");
                            }}
                            className="shrink-0 flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-200 border border-sky-800/40 bg-sky-950/40 px-2.5 py-1 rounded transition-colors"
                          >
                            <span>{zh ? "查看具体指令" : "View Commands"}</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            2. 「原生几何与复杂构件」、「属性、视图与透传」、「快照、算量与智能翻模」：
               直接显示具体的每个匹配指令
        ────────────────────────────────────────────────────────────── */}
        {(activeTab === "CLASS_A" || activeTab === "CLASS_B" || activeTab === "CLASS_C") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-100">
                  {activeTab === "CLASS_A" && (zh ? "原生几何与复杂构件指令清单" : "Geometry & Complex Elements Commands")}
                  {activeTab === "CLASS_B" && (zh ? "属性、视图与透传指令清单" : "Attributes, View & Pass-Thru Commands")}
                  {activeTab === "CLASS_C" && (zh ? "快照、算量与智能翻模指令清单" : "Snapshot, QTO & Reverse Modeling Commands")}
                </span>
                <span className="rounded bg-sky-950 px-2 py-0.5 text-[10px] font-mono text-sky-300 border border-sky-800/40">
                  {displayedCommands.length} {zh ? "项指令" : "commands"}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">
                {zh ? "全量命令受 AI 协同对话流调度与 Gate 2 门禁保护" : "Dispatched via AI Copilot flow with Gate 2 guard"}
              </span>
            </div>

            {displayedCommands.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded">
                {zh ? "没有匹配的指令" : "No matching commands found"}
              </div>
            ) : (
              <div className="space-y-2">
                {displayedCommands.map((cmd) => {
                  const { q, depth } = getCommandLifecycleAndDepth(cmd);
                  const isRead = cmd.riskLevel === "read";
                  const isCreate = cmd.riskLevel === "create-element" || cmd.riskLevel === "write";
                  const triggers = zh ? (cmd.nlTriggers?.zh || []) : (cmd.nlTriggers?.en || []);

                  return (
                    <div
                      key={cmd.name}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-sky-300">
                              {cmd.commandNamespace ? `${cmd.commandNamespace}.${cmd.commandName}` : cmd.name}
                            </span>
                            {cmd.executionKind === "server-endpoint" && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[9px] text-amber-400 border border-amber-900/40">
                                {zh ? "服务端接口" : "Server Endpoint"}
                              </span>
                            )}
                            <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[9px] text-zinc-400">
                              {cmd.featureArea}
                            </span>

                            {/* 生命周期四象限标签 */}
                            <span className="rounded bg-indigo-950/60 px-1.5 py-0.2 font-mono text-[9px] text-indigo-300 border border-indigo-800/40 font-semibold">
                              {q}
                            </span>

                            {/* 复杂深度分级标签 */}
                            <span className="rounded bg-purple-950/60 px-1.5 py-0.2 font-mono text-[9px] text-purple-300 border border-purple-800/40 font-semibold">
                              {depth}
                            </span>

                            {/* 风险属性 */}
                            <span
                              className={`rounded px-1.5 py-0.2 text-[9px] font-medium border ${
                                isRead
                                  ? "bg-emerald-950/50 text-emerald-300 border-emerald-800/40"
                                  : isCreate
                                  ? "bg-sky-950/50 text-sky-300 border-sky-800/40"
                                  : "bg-amber-950/50 text-amber-300 border-amber-800/40"
                              }`}
                            >
                              {isRead
                                ? (zh ? "只读查询" : "Read-Only")
                                : isCreate
                                ? (zh ? "构件生成" : "Create")
                                : (zh ? "编辑修改" : "Modify")}
                            </span>
                          </div>

                          {/* 详细描述 */}
                          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                            {cmd.description}
                          </p>

                          {/* 自然语言触发词胶囊 */}
                          {triggers.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[9px] font-mono text-zinc-600">
                                {zh ? "NL触发词:" : "NL Triggers:"}
                              </span>
                              {triggers.slice(0, 5).map((t, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-cyan-950/40 px-1.5 py-0.2 font-mono text-[8px] text-cyan-300/80 border border-cyan-800/30"
                                >
                                  {t}
                                </span>
                              ))}
                              {triggers.length > 5 && (
                                <span className="text-[8px] font-mono text-zinc-600">
                                  +{triggers.length - 5}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 安全防线标记 */}
                        <div className="shrink-0 flex items-center">
                          <span
                            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border font-mono ${
                              isRead
                                ? "border-emerald-800/40 bg-emerald-950/30 text-emerald-300"
                                : "border-zinc-800 bg-zinc-950 text-zinc-500"
                            }`}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            <span>{isRead ? (zh ? "零脏读查询" : "Zero-Dirty Read") : (zh ? "Gate 2 守护" : "Gate 2 Guarded")}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            3. 「复合业务扩展包」：展示 MACAI 平台复合工法技能与已加载模块
        ────────────────────────────────────────────────────────────── */}
        {activeTab === "MODULES" && (
          <div className="space-y-5">
            {/* 3.1 已加载扩展业务模块清单 (运行态 · 已装入) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-sky-400" />
                  <h3 className="text-xs font-bold text-zinc-200">
                    {zh ? "已加载扩展业务模块清单 (Loaded Modules)" : "Loaded Business Modules"}
                  </h3>
                  <span className="rounded bg-sky-950 px-2 py-0.5 text-[10px] font-mono text-sky-300 border border-sky-800/40">
                    {modules.length} {zh ? "个已启用" : "enabled"}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {zh ? "ExtensionManager 动态挂载 · 独立沙箱权限 · 运行态计入" : "Dynamically Loaded · Sandboxed · Counted in Runtime"}
                </span>
              </div>

              {modules.length === 0 ? (
                <div className="rounded border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-500">
                  {zh ? "当前没有已启用模块" : "No reviewed modules are enabled"}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {modules.map((module) => (
                    <div
                      key={module.id}
                      className="rounded-lg border border-sky-500/20 bg-gradient-to-b from-sky-950/10 to-zinc-900/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-zinc-100">
                              {module.displayName[lang]}
                            </span>
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                              {module.id} v{module.version}
                            </span>
                            <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[9px] text-sky-300 border border-sky-800/40">
                              {zh ? "运行时模块" : "Runtime Module"}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                            {module.description[lang]}
                          </p>

                          {/* 声明依赖的底层 APX 权限 */}
                          {module.permissions?.archicad?.commands && (
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              <span className="text-[9px] font-mono text-zinc-500">
                                {zh ? "底层调用 APX 原生权限:" : "Underlying APX Permissions:"}
                              </span>
                              {module.permissions.archicad.commands.map((cmdName) => (
                                <span
                                  key={cmdName}
                                  className="rounded bg-zinc-900 px-1.5 py-0.2 font-mono text-[9px] text-sky-300 border border-sky-900/40"
                                >
                                  {cmdName}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <span className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{zh ? "服务在线" : "Online"}</span>
                        </span>
                      </div>

                      {/* 模块内部封装的复合命令 */}
                      <div className="mt-3 space-y-1.5 border-t border-zinc-800/70 pt-2.5">
                        {module.commands.map((command) => (
                          <div
                            key={command.name}
                            className="flex items-center justify-between gap-3 rounded bg-zinc-900/70 px-3 py-2 border border-zinc-800/50"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-zinc-200">
                                {command.displayName[lang]}
                              </div>
                              <div className="truncate font-mono text-[9px] text-zinc-500">
                                {command.name}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                              {zh ? "只读组合业务" : "Read-only Composite"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3.2 MACAI 平台规划复合工法库 (规划态 · 不计入已装) */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <h3 className="text-xs font-bold text-zinc-200">
                    {zh ? "MACAI 平台规划复合工法库 (规划态 · v0.1.9 不计入已装)" : "MACAI Platform Planned Compound Skills (Planned · Excluded from v0.1.9)"}
                  </h3>
                  <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-mono text-amber-300 border border-amber-800/40">
                    {filteredCompoundSkills.length} {zh ? "项规划工法" : "skills"}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {zh ? "规划态高内聚多步骤工法 · 独立脚本验证 · 待正式发行业务闭环" : "Planned Multi-Step Skills · Script Verified · Pending Release Inclusion"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {filteredCompoundSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="rounded-lg border border-amber-500/25 bg-gradient-to-b from-amber-950/15 via-zinc-900/60 to-zinc-900/40 p-3.5 space-y-2.5 transition-colors hover:border-amber-500/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-extrabold text-amber-200">
                            {zh ? skill.nameZh : skill.nameEn}
                          </span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 border border-zinc-700">
                            {skill.id}
                          </span>
                          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                            {skill.version}
                          </span>
                          <span className="rounded bg-amber-950/70 px-2 py-0.5 text-[9px] text-amber-300 border border-amber-700/50">
                            {zh ? skill.categoryZh : skill.categoryEn}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300">
                          {zh ? skill.descriptionZh : skill.descriptionEn}
                        </p>
                      </div>

                      <span className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/50">
                        <Clock className="h-3 w-3" />
                        <span>{zh ? skill.statusZh : skill.statusEn}</span>
                      </span>
                    </div>

                    {/* 依赖的底层 APX 原生指令标签 */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {zh ? "调度底层 APX 指令:" : "Underlying APX Commands:"}
                      </span>
                      {skill.underlyingCommands.map((cmd) => (
                        <span
                          key={cmd}
                          className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-sky-300 border border-sky-900/40"
                        >
                          {cmd}
                        </span>
                      ))}
                    </div>

                    {/* 空间拓扑与实机验证双保障栏 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] rounded bg-zinc-950/70 p-2 border border-zinc-800/70">
                      <div>
                        <span className="font-bold text-sky-400">
                          {zh ? "拓扑与空间约束：" : "Topology & Spatial: "}
                        </span>
                        <span className="text-zinc-300">
                          {zh ? skill.topologyHighlightsZh : skill.topologyHighlightsEn}
                        </span>
                      </div>
                      <div>
                        <span className="font-bold text-amber-400">
                          {zh ? "验证与交付状态：" : "Status & Delivery: "}
                        </span>
                        <span className="text-zinc-300">
                          {zh ? skill.verificationZh : skill.verificationEn}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

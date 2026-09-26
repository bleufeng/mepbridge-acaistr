// postReplay.ts
// 回放后步骤（post-replay steps）的共用逻辑：解析、目标元素收集、参数装配。
//
// 背景：模板步骤在采集时固化，创建类步骤的产物 GUID 只有回放时才产生 ⇒
// "把本次新建构件的属性统一设成 X"无法写成普通步骤（占位符还会被 plan-chain Gate1 拒绝）。
// 因此这类收尾动作登记为 plan.postReplaySteps，目标元素由回放器运行时解析。
//
// 本文件保持纯函数（不依赖 React / fetch），便于契约测试直接断言。

import type { OperationPlan, PostReplayStep } from "./types";

/** 创建类命令 → 元素类型（用于按类型收集新建构件 GUID） */
export const ACTION_ELEMENT_TYPES: Record<string, string> = {
  CreateWall: "Wall",
  CreateColumn: "Column",
  CreateBeam: "Beam",
  CreateSlab: "Slab",
  CreateRoof: "Roof",
  CreateMesh: "Mesh",
  CreateMorph: "Morph",
  CreateObject: "Object",
  CreateStair: "Stair",
  CreateZone: "Zone",
  CreateDoor: "Door",
  CreateWindow: "Window",
  CreateLamp: "Lamp",
  CreateDimension: "Dimension",
  CreateLabel: "Label",
  CreateText: "Text",
  CreateCableCarrier: "CableCarrier",
  CreatePipe: "Pipe",
  CreateDuct: "Duct",
  CreateFlexibleSegment: "FlexibleSegment",
};

/**
 * 创建类命令的返回键名不统一（CreateWall → wallGuid，CreateBeam → beamGuid，
 * 部分命令统一用 elementGuid/guid）。此处按"键名 → 元素类型"登记，
 * 空字符串表示键名本身不带类型信息（类型改由步骤 action 推断）。
 */
const GUID_KEYS: Array<{ key: string; type: string }> = [
  { key: "wallGuid", type: "Wall" },
  { key: "columnGuid", type: "Column" },
  { key: "beamGuid", type: "Beam" },
  { key: "slabGuid", type: "Slab" },
  { key: "roofGuid", type: "Roof" },
  { key: "meshGuid", type: "Mesh" },
  { key: "morphGuid", type: "Morph" },
  { key: "objectGuid", type: "Object" },
  { key: "stairGuid", type: "Stair" },
  { key: "zoneGuid", type: "Zone" },
  { key: "doorGuid", type: "Door" },
  { key: "windowGuid", type: "Window" },
  { key: "lampGuid", type: "Lamp" },
  { key: "elementGuid", type: "" },
  { key: "guid", type: "" },
];

export interface StepExecutionRecord {
  action: string;
  payload: Record<string, unknown>;
}

export interface CreatedElements {
  /** 全部新建构件 GUID（去重，保持出现顺序） */
  all: string[];
  /** 按元素类型分组（仅登记得出来的类型） */
  byType: Record<string, string[]>;
  /** 按来源步骤 action 分组 */
  byAction: Record<string, string[]>;
}

function pushUnique(bucket: string[], guid: unknown): boolean {
  if (typeof guid !== "string" || !guid) return false;
  if (bucket.includes(guid)) return false;
  bucket.push(guid);
  return true;
}

/**
 * 从回放各步的返回体里收集"本次新建的构件"。
 * 只认创建类命令的返回键；未识别的返回体不会贡献 GUID（不会误伤既有元素）。
 */
export function collectCreatedElements(records: StepExecutionRecord[]): CreatedElements {
  const created: CreatedElements = { all: [], byType: {}, byAction: {} };

  const add = (guid: unknown, action: string, typeHint: string) => {
    if (!pushUnique(created.all, guid)) return;
    const type = typeHint || ACTION_ELEMENT_TYPES[action] || "";
    if (type) {
      created.byType[type] = created.byType[type] || [];
      pushUnique(created.byType[type], guid);
    }
    if (action) {
      created.byAction[action] = created.byAction[action] || [];
      pushUnique(created.byAction[action], guid);
    }
  };

  for (const record of records || []) {
    const payload = record?.payload;
    if (!payload || typeof payload !== "object") continue;
    const action = typeof record.action === "string" ? record.action : "";

    for (const { key, type } of GUID_KEYS) {
      if (key in payload) add(payload[key], action, type);
    }

    if (Array.isArray(payload.createdGuids)) {
      payload.createdGuids.forEach((guid: unknown) => add(guid, action, ""));
    }

    if (Array.isArray(payload.elements)) {
      (payload.elements as Array<Record<string, unknown>>).forEach((el) => {
        if (!el || typeof el !== "object") return;
        const type = typeof el.type === "string" ? el.type : "";
        add(el.guid, action, type);
      });
    }
  }

  return created;
}

/**
 * 解析模板的回放后步骤：
 * ① 模板自带 plan.postReplaySteps → 原样使用；
 * ② 否则从 plan.unifiedStructuralProperty（采集侧元数据）派生一条批量设属性步骤
 *    （旧模板无需迁移即可获得该收尾步骤）；
 * ③ 都没有 → 空数组（行为与历史一致）。
 */
export function resolvePostReplaySteps(plan: OperationPlan | null | undefined): PostReplayStep[] {
  if (!plan) return [];

  if (Array.isArray(plan.postReplaySteps) && plan.postReplaySteps.length > 0) {
    return plan.postReplaySteps;
  }

  const unified = plan.unifiedStructuralProperty;
  if (
    unified &&
    typeof unified === "object" &&
    typeof unified.propertyName === "string" &&
    typeof unified.valueString === "string"
  ) {
    return [
      {
        id: "post-replay-unified-structural-property",
        action: "EditSelectedElements",
        title:
          (typeof unified.propertyName === "string" && unified.propertyName
            ? "统一构件属性：" + unified.propertyName
            : "统一构件属性") + " = " + unified.valueString,
        description: typeof unified.appliesTo === "string" ? unified.appliesTo : "",
        params: {
          filter: "BuiltIn",
          properties: [
            {
              groupName: typeof unified.groupName === "string" ? unified.groupName : "CategoryPropertyDefinitionGroup",
              propertyName: unified.propertyName,
              valueString: unified.valueString,
            },
          ],
          confirmRequired: true,
        },
        riskLevel: "low-mutation",
        target: { source: "createdGuids" },
      },
    ];
  }

  return [];
}

/**
 * 把回放后步骤装配成可执行参数：注入运行时解析出的 elementGuids。
 * 返回 null 表示本次回放没有匹配的目标构件（调用方应显式跳过并提示，不得静默）。
 */
export function buildPostReplayParams(
  step: PostReplayStep,
  created: CreatedElements
): Record<string, unknown> | null {
  const target = step.target || { source: "createdGuids" as const };
  if (target.source !== "createdGuids") return null;

  let guids: string[] = [];
  if (Array.isArray(target.types) && target.types.length > 0) {
    for (const type of target.types) {
      guids.push(...(created.byType[type] || []));
    }
  } else if (Array.isArray(target.actions) && target.actions.length > 0) {
    for (const action of target.actions) {
      guids.push(...(created.byAction[action] || []));
    }
  } else {
    guids = [...created.all];
  }

  const unique = Array.from(new Set(guids.filter((guid) => typeof guid === "string" && guid)));
  if (unique.length === 0) return null;

  return { ...(step.params || {}), elementGuids: unique };
}

/** 回放后步骤的展示名（预览弹窗 / 执行日志共用） */
export function describePostReplayStep(step: PostReplayStep): string {
  return step.title || step.action;
}

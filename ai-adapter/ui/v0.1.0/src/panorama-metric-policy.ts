// SPDX-License-Identifier: MIT
// Display projection of CAPABILITY_PANORAMA_VERSION_TRACKER.md §1.4.
// No evidence collector, timer, model calls, or automatic promotion to VERIFIED.
export const PANORAMA_METRIC_POLICY_REVISION = "2026-11-07 / REV3";
// Maintainer-confirmed measurement scope, not an observed command list or live pass count.
// Highest host is the baseline. Add verified lower-host exclusives via a deduplicated union, not a raw sum.
export const PANORAMA_FULL_SCOPE = {
  referenceHost: 30,
  hostLabel: "AC30",
  scopeRevision: "AC28-30-UNION-20261107",
  supportedHosts: [28, 29, 30],
  aggregation: "DEDUPLICATED_VERSION_UNION",
  officialJsonBaseTotal: 77,
  officialJsonSupplementalTotal: null,
  officialJsonUnionTotal: null,
  basis: "MAINTAINER_CONFIRMED",
  declaredAt: "2026-11-07",
  commandInventoryStatus: "PENDING_RECONCILIATION",
  atomicTotal: null,
  lifecycleTotal: null,
} as const;

export const PANORAMA_METRIC_POLICIES = [
  {
    id: "registry", titleZh: "当前目录注册数", titleEn: "Current catalog registrations",
    conditionZh: "实际目录加载成功且结构有效；源码注册变更须通过契约一致性检查。",
    conditionEn: "A valid current catalog response; source registration changes also require contract consistency checks.",
    triggerZh: "打开看板／手动刷新返回时更新；注册变更在同批修订中核对。",
    triggerEn: "Update on panel load or manual refresh response; reconcile registration changes in the same change set.",
    sourceZh: "当前服务目录；注册数，不是实机通过数",
    sourceEn: "Current service catalog; Registered, not live-verified",
  },
  {
    id: "atomic", titleZh: "原子能力点规模", titleEn: "Atomic capability inventory",
    conditionZh: "全开以AC30为基准，AC28／29独有能力去重补入三版并集；同功能跨版只计一次，实现／独立读回资格与分宿主兼容性分列。",
    conditionEn: "Use AC30 as the baseline and add unique AC28/29 capabilities into a deduplicated three-host union. Shared functionality counts once; implementation/readback qualifications and per-host compatibility stay separate.",
    triggerZh: "最高支持版本／清单范围变更或支持切片验收后，同批回填；不等正式发版。",
    triggerEn: "Reconcile in the same change set after highest-supported-host or inventory changes, or slice acceptance; do not wait for release.",
    sourceZh: "AC30基准及AC28／29独有能力清单待核定，未沿用旧全开数量",
    sourceEn: "AC30 baseline and AC28/29-exclusive inventories pending; legacy totals are not reused",
  },
  {
    id: "json", titleZh: "Graphisoft JSON API覆盖池", titleEn: "Graphisoft JSON API coverage",
    conditionZh: `${PANORAMA_FULL_SCOPE.hostLabel}基准${PANORAMA_FULL_SCOPE.officialJsonBaseTotal}项，补入AC28／29独有命令；三版本相同功能只计一次，最终并集分母及已覆盖分子均待完整清单对账。`,
    conditionEn: `${PANORAMA_FULL_SCOPE.hostLabel} baseline: ${PANORAMA_FULL_SCOPE.officialJsonBaseTotal} commands, plus AC28/29-exclusive commands. Shared capabilities count once; reconcile complete inventories before publishing the union denominator or covered numerator.`,
    triggerZh: "任一支持版本清单／白名单／映射变化时重核三版并集；基准或独有项变化后同步分母与相同口径分子，不自动翻绿。",
    triggerEn: "Reconcile the union when any supported host inventory, whitelist or mapping changes; update the denominator and same-scope numerator without auto-promoting acceptance.",
    sourceZh: "AC30基准77由维护者确认；三版并集总分母／独有项／覆盖分子待对账",
    sourceEn: "AC30 baseline 77 confirmed by maintainer; union denominator, exclusive commands and covered numerator await reconciliation",
  },
  {
    id: "lifecycle", titleZh: "Q1–Q4操控纵深", titleEn: "Q1–Q4 lifecycle depth",
    conditionZh: "全开分母为AC30基准加AC28／29独有能力的去重并集；按类型／模式核通过项，每版实跑／兼容状态独立，Q4为拓扑与编排。",
    conditionEn: "The full denominator is the deduplicated union of the AC30 baseline plus AC28/29-exclusive capabilities; verify by type/mode and retain separate live/compatibility states. Q4 means topology and orchestration.",
    triggerZh: "创建／读取／修改／拓扑切片验收或回归失败时，同批重算或标失效。",
    triggerEn: "Recompute or invalidate in the same change set after slice acceptance or regression failure.",
    sourceZh: "保留构件分项状态；无当前汇总验收快照",
    sourceEn: "Per-element scope is retained; no current aggregate acceptance snapshot",
  },
  {
    id: "recovery", titleZh: "失败恢复验证率", titleEn: "Failure recovery verification rate",
    conditionZh: "原生失败注入／Undo／补偿按策略分组，实际恢复通过数÷已执行合格用例数；未跑／未知另列。",
    conditionEn: "Group native failure injection, Undo and compensation by strategy; verified recoveries / executed eligible cases, with not-run and unknown cases separate.",
    triggerZh: "每批恢复用例完成、发现残留或相关事务代码变化时复核；发布前绑定产物。",
    triggerEn: "Review after recovery test batches, residual findings or relevant transaction changes; bind evidence to artifacts before release.",
    sourceZh: "未接入当前产物／宿主的失败恢复样本快照",
    sourceEn: "No recovery sample snapshot bound to current artifacts and hosts",
  },
] as const;

// A catalog count is not an acceptance metric. Empty but valid catalogs report zero.
export function getCatalogMetric(loading: boolean, error: string, count: number, observedAt: string | null) {
  if (loading) return { state: "LOADING", value: "...", observedAt: null } as const;
  if (error || !observedAt) return { state: "UNAVAILABLE", value: "--", observedAt: null } as const;
  return { state: "OBSERVED", value: String(count), observedAt } as const;
}

export type VersionCapabilityInventory = {
  host: number;
  // Stable semantic IDs; aliases and parameter/mode differences must be reconciled upstream.
  capabilityIds: readonly string[];
  complete: boolean;
};

// Pure inventory arithmetic. Never probes hosts or treats inventory presence as live acceptance.
export function summarizeVersionCapabilityUnion(inventories: readonly VersionCapabilityInventory[]) {
  const byHost = new Map<number, Set<string>>();
  for (const inventory of inventories) {
    if (!PANORAMA_FULL_SCOPE.supportedHosts.some(host => host === inventory.host)
      || byHost.has(inventory.host) || typeof inventory.complete !== "boolean"
      || !Array.isArray(inventory.capabilityIds)
      || inventory.capabilityIds.some(id => typeof id !== "string" || !id || id.trim() !== id)) {
      throw new Error("INVALID_VERSION_CAPABILITY_INVENTORY");
    }
    byHost.set(inventory.host, new Set(inventory.capabilityIds));
  }
  const observedIds = new Set([...byHost.values()].flatMap(ids => [...ids]));
  const complete = PANORAMA_FULL_SCOPE.supportedHosts.every(host =>
    inventories.some(inventory => inventory.host === host && inventory.complete));
  const baseline = byHost.get(PANORAMA_FULL_SCOPE.referenceHost);
  const baselineComplete = inventories.some(inventory =>
    inventory.host === PANORAMA_FULL_SCOPE.referenceHost && inventory.complete);
  const ids = [...observedIds].sort();
  const supplements = complete ? ids.filter(id => !baseline!.has(id)) : null;
  return {
    status: complete ? "COMPLETE" as const : "PENDING_RECONCILIATION" as const,
    observedUniqueCount: observedIds.size, // Lower bound only when inventories are incomplete.
    baselineTotal: baselineComplete ? baseline!.size : null,
    unionTotal: complete ? observedIds.size : null,
    supplementalTotal: supplements?.length ?? null,
    supplementalCapabilityIds: supplements,
    availability: ids.map(id => ({
      capabilityId: id,
      hosts: PANORAMA_FULL_SCOPE.supportedHosts.filter(host => byHost.get(host)?.has(id)),
    })),
  };
}

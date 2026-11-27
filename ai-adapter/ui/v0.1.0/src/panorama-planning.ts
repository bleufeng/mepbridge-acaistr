// SPDX-License-Identifier: MIT
// Planning projection only. Task definitions remain in V020_ITERATION_PLAN_20261106.md.
// IDs belong to one primary bucket; cross-domain dependencies never add a count.
export const PANORAMA_PLANNING_REVISION = "V020-REV6";
export const PANORAMA_PLANNING_STATUS = "PLANNING_POOL";
// Maintainer-approved V20-47 qualification scope; these flags are requirements, not PASS results.
export const MACOS_BUILD_QUALIFICATION_POLICY = {
  taskId: "V20-47",
  nativeBuildRequired: true,
  windowsFunctionalTestsRequired: true,
  macLiveTestsRequired: false,
  macHostExecutionStatus: "NOT_RUN",
  waiver: "MAC_LIVE_NOT_REQUIRED_V020",
  approvedAt: "2026-11-07",
} as const;

export const PANORAMA_PLANNING_BUCKETS = [
  { id: "dom_base_arch", nameZh: "基础建筑与空间", nameEn: "Basic architecture & spaces", taskNumbers: [33, 34, 35, 36, 37, 38, 39, 40] },
  { id: "dom_complex", nameZh: "复杂构件", nameEn: "Complex elements", taskNumbers: [4, 5, 6, 7, 8, 9] },
  { id: "dom_edit_batch", nameZh: "几何／布尔／批量", nameEn: "Geometry, Boolean & batch", taskNumbers: [1, 2, 3, 10, 11, 12, 13] },
  { id: "dom_2d_drafting", nameZh: "2D感知与注释", nameEn: "2D perception & annotation", taskNumbers: [] },
  { id: "dom_mep", nameZh: "MEP管网与拓扑", nameEn: "MEP routing & topology", taskNumbers: [14, 15, 42, 43, 44, 45, 46] },
  { id: "dom_env_attr", nameZh: "环境与构造资产", nameEn: "Environment & construction assets", taskNumbers: [41] },
  { id: "dom_view_json", nameZh: "视图与JSON透传", nameEn: "Views & JSON pass-through", taskNumbers: [] },
  { id: "dom_platform", nameZh: "快照／导出／翻模", nameEn: "Snapshots, export & reverse modeling", taskNumbers: [20, 21, 22] },
  { id: "cross_cutting", nameZh: "横切保障／产品／技能／交付", nameEn: "Cross-cutting reliability, product, skills & delivery", taskNumbers: [16, 17, 18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 47] },
] as const;

const numbers = PANORAMA_PLANNING_BUCKETS.flatMap(bucket => [...bucket.taskNumbers]);
export const PANORAMA_PLANNING_TOTALS = {
  total: numbers.length,
  carried: numbers.filter(number => number <= 32).length,
  added: numbers.filter(number => number >= 33).length,
  buildingAdded: numbers.filter(number => number >= 33 && number <= 41).length,
  mepAdded: numbers.filter(number => number >= 42 && number <= 46).length,
  macBuildAdded: numbers.filter(number => number === 47).length,
  domainOwned: PANORAMA_PLANNING_BUCKETS.filter(bucket => bucket.id !== "cross_cutting")
    .reduce((total, bucket) => total + bucket.taskNumbers.length, 0),
  crossCutting: PANORAMA_PLANNING_BUCKETS.find(bucket => bucket.id === "cross_cutting")!.taskNumbers.length,
} as const;

export function getPanoramaPlanningBucket(id: string) {
  return PANORAMA_PLANNING_BUCKETS.find(bucket => bucket.id === id);
}

export function formatPlanningTaskIds(numbers: readonly number[]) {
  return numbers.map(number => `V20-${String(number).padStart(2, "0")}`).join(" / ");
}

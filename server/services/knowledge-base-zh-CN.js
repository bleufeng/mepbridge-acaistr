// knowledge-base-zh-CN.js
// 内置知识库 — 中文版（中国大陆地区发布包使用）
// 数据来源：中国国家标准（GB）、行业标准（JGJ）、材料标准（GB/T）
//
// severity 设计原则：
//   error   = 安全强制（疏散/防火/栏杆/管径最小值/楼梯踏步等，违反不可执行）
//   warning = 设计参考（墙厚/房间面积/层高/采光/节能等，用户可自行调整）

module.exports = {
  locale: 'zh-CN',
  region: 'CN',
  version: '1.0.0',
  updatedAt: '2026-06-28',
  sources: [
    // 建筑设计类
    'GB 55038-2025（住宅项目规范）+ GB 50096-2011（住宅设计规范）',
    'GB 55037-2022（建筑防火通用规范）+ GB 50016-2014(2018年版)（建筑设计防火规范）',
    'GB 55019-2021（建筑与市政工程无障碍通用规范）+ GB 50763-2012（无障碍设计规范）',
    'GB 55031-2022（民用建筑通用规范）+ GB 50352-2019（民用建筑设计统一标准）',
    // 结构类
    'GB/T 50010-2010（2024年版）（混凝土结构设计标准）',
    // 给排水类
    'GB 50015-2019（建筑给水排水设计标准）',
    'GB 50242-2025（建筑给水排水及采暖工程施工质量验收规范）',
    // 暖通类
    'GB 50243-2024（通风与空调工程施工质量验收规范）',
    // 电气类
    'GB 55024-2022（建筑电气与智能化通用规范）+ GB 50054-2011（低压配电设计规范）',
    // 节能类
    'JGJ 26-2018（严寒和寒冷地区居住建筑节能设计标准）',
    'JGJ 102-2003（玻璃幕墙工程技术规范）',
    // 墙体材料
    'GB/T 11968-2020, GB/T 13545-2014, GB/T 11981-2019（墙体材料）',
    // 楼板/屋面材料
    'GB/T 14040-2007, GB/T 12755-2021（楼板/屋面材料）',
    // 门窗材料
    'WB/T 1024-2006, GB/T 8478-2020, GB 12955-2024（防火门）（门窗材料）',
    // 管道材料
    'GB/T 18742.2-2017, GB/T 5836.1-2018, GB/T 3091-2025（管道材料）'
  ],

  // ─── H8.1 建筑规范知识库（GB 国标条文，来源已核查至现行版本） ───
  buildingCode: [
    // 住宅项目规范 GB 55038-2025 + 住宅设计规范 GB 50096-2011
    { id: 'BC-001', category: 'residential', rule: '住宅层高 ≥ 2.8m（设计参考，用户可调整）', source: 'GB 55038-2025', severity: 'warning', field: 'height', minValue: 2.8 },
    { id: 'BC-002', category: 'residential', rule: '卧室使用面积 ≥ 9㎡（双人）/ 5㎡（单人）（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: 'roomArea', minValue: 5 },
    { id: 'BC-003', category: 'residential', rule: '厨房使用面积 ≥ 4㎡（一居室）/ 5㎡（多居室）（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: 'roomArea', minValue: 4 },
    { id: 'BC-004', category: 'residential', rule: '卫生间使用面积 ≥ 3.0㎡（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: 'roomArea', minValue: 3.0 },
    { id: 'BC-005', category: 'residential', rule: '疏散门净宽 ≥ 0.9m（住宅入户门，安全强制）', source: 'GB 55038-2025', severity: 'error', field: 'width', minValue: 0.9 },
    { id: 'BC-006', category: 'residential', rule: '室内门净宽 ≥ 0.8m（卧室门）/ 0.7m（卫生间门）（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: 'width', minValue: 0.7 },
    { id: 'BC-007', category: 'residential', rule: '卧室、起居室自然采光窗地面积比 ≥ 1/7（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: null },
    { id: 'BC-008', category: 'residential', rule: '阳台栏杆高度 ≥ 1.05m（六层及以下）/ ≥ 1.1m（七层及以上）（安全强制）', source: 'GB 55038-2025', severity: 'error', field: 'height', minValue: 1.05 },
    // 建筑防火通用规范 GB 55037-2022 + 建筑设计防火规范 GB 50016-2014(2018年版)
    { id: 'BC-101', category: 'fireproof', rule: '住宅建筑耐火等级不低于二级', source: 'GB 55037-2022', severity: 'warning', field: null },
    { id: 'BC-102', category: 'fireproof', rule: '疏散楼梯净宽 ≥ 1.1m（多层住宅，安全强制）', source: 'GB 55037-2022', severity: 'error', field: 'width', minValue: 1.1 },
    { id: 'BC-103', category: 'fireproof', rule: '防火墙耐火极限 ≥ 3.0h（安全强制）', source: 'GB 55037-2022', severity: 'error', field: null },
    { id: 'BC-104', category: 'fireproof', rule: '疏散门应向疏散方向开启（人数>60人时）', source: 'GB 50016-2014(2018年版)', severity: 'warning', field: null },
    { id: 'BC-105', category: 'fireproof', rule: '防火门耐火极限：甲级1.5h / 乙级1.0h / 丙级0.5h（安全强制）', source: 'GB 12955-2024', severity: 'error', field: null },
    // 建筑与市政工程无障碍通用规范 GB 55019-2021 + 无障碍设计规范 GB 50763-2012
    { id: 'BC-201', category: 'accessibility', rule: '无障碍门净宽 ≥ 0.8m（设计参考）', source: 'GB 55019-2021', severity: 'warning', field: 'width', minValue: 0.8 },
    { id: 'BC-202', category: 'accessibility', rule: '无障碍坡道坡度 ≤ 1:12（设计参考）', source: 'GB 55019-2021', severity: 'warning', field: null },
    { id: 'BC-501', category: 'accessibility', rule: '建筑入口轮椅坡道净宽 ≥ 1.2m（安全强制）', source: 'GB 55019-2021', severity: 'error', field: 'width', minValue: 1.2 },
    { id: 'BC-502', category: 'accessibility', rule: '无障碍卫生间面积 ≥ 2.0m × 2.0m（设计参考）', source: 'GB 50763-2012', severity: 'warning', field: 'roomArea', minValue: 4.0 },
    // 民用建筑设计统一标准 GB 50352-2019 + 混凝土结构设计标准 GB/T 50010-2010(2024年版)
    { id: 'BC-301', category: 'general', rule: '外墙厚度 ≥ 0.2m（寒冷地区保温要求，设计参考）', source: 'JGJ 26-2018', severity: 'warning', field: 'thickness', minValue: 0.2 },
    { id: 'BC-302', category: 'general', rule: '楼板厚度 ≥ 0.1m（现浇）/ 0.12m（预制）（设计参考）', source: 'GB/T 50010-2010(2024年版)', severity: 'warning', field: 'thickness', minValue: 0.1 },
    { id: 'BC-303', category: 'general', rule: '现浇钢筋混凝土楼板最小厚度 ≥ 0.06m（单向板，设计参考）', source: 'GB/T 50010-2010(2024年版)', severity: 'warning', field: 'thickness', minValue: 0.06 },
    { id: 'BC-304', category: 'general', rule: '混凝土保护层最小厚度 ≥ 0.015m（室内正常环境，设计参考）', source: 'GB/T 50010-2010(2024年版)', severity: 'warning', field: null },
    // 节能设计 JGJ 26-2018（严寒寒冷地区居住建筑）
    { id: 'BC-401', category: 'energy', rule: '严寒/寒冷地区居住建筑外墙传热系数 ≤ 0.45 W/(㎡·K)（设计参考）', source: 'JGJ 26-2018', severity: 'warning', field: null },
    { id: 'BC-402', category: 'energy', rule: '屋面传热系数 ≤ 0.35 W/(㎡·K)（严寒地区，设计参考）', source: 'JGJ 26-2018', severity: 'warning', field: null },
    { id: 'BC-403', category: 'energy', rule: '外窗传热系数 ≤ 2.5 W/(㎡·K)（寒冷地区，设计参考）', source: 'JGJ 26-2018', severity: 'warning', field: null },
    // 厨房通风 + 楼梯
    { id: 'BC-601', category: 'residential', rule: '厨房自然通风开口面积 ≥ 地面面积 1/10 且 ≥ 0.6㎡（设计参考）', source: 'GB 50096-2011', severity: 'warning', field: null },
    { id: 'BC-602', category: 'residential', rule: '楼梯踏步宽度 ≥ 0.26m，高度 ≤ 0.175m（住宅，安全强制）', source: 'GB 50096-2011', severity: 'error', field: null }
  ],

  // ─── H8.2 MEP 标准知识库（给排水/暖通/电气，来源已核查至现行版本） ───
  mepStandard: [
    // 建筑给水排水设计标准 GB 50015-2019（原"规范"改"标准"）
    { id: 'MEP-001', domain: 'Piping', subType: 'Water', rule: '住宅给水管最小管径 DN15（入户，安全强制）', source: 'GB 50015-2019', severity: 'error', field: 'diameterMm', minValue: 15, commandAction: 'CreatePipe' },
    { id: 'MEP-002', domain: 'Piping', subType: 'Water', rule: '住宅给水分支管径 DN20（卫生间/厨房，设计参考）', source: 'GB 50015-2019', severity: 'warning', field: 'diameterMm', recommendedValue: 20, commandAction: 'CreatePipe' },
    { id: 'MEP-003', domain: 'Piping', subType: 'Drainage', rule: '排水立管最小管径 DN50（器具排水，安全强制）', source: 'GB 50015-2019', severity: 'error', field: 'diameterMm', minValue: 50, commandAction: 'CreatePipe' },
    { id: 'MEP-004', domain: 'Piping', subType: 'Drainage', rule: '排水主管管径 DN100（卫生间主管，设计参考）', source: 'GB 50015-2019', severity: 'warning', field: 'diameterMm', recommendedValue: 100, commandAction: 'CreatePipe' },
    { id: 'MEP-005', domain: 'Piping', subType: 'Water', rule: '给水管距地高度 0.5-0.8m（住宅，设计参考）', source: 'GB 50015-2019', severity: 'warning', field: 'z', minRange: [0.5, 0.8], commandAction: 'CreatePipe' },
    { id: 'MEP-006', domain: 'Piping', subType: 'Drainage', rule: '排水管坡度 ≥ 2%（重力排水，设计参考）', source: 'GB 50015-2019', severity: 'warning', field: 'slope', minValue: 0.02, commandAction: 'CreatePipe' },
    // 通风与空调工程施工质量验收规范 GB 50243-2024
    { id: 'MEP-101', domain: 'Ventilation', subType: 'Duct', rule: '矩形风管边长 ≤ 2000mm（标准，设计参考）', source: 'GB 50243-2024', severity: 'warning', field: 'width', maxValue: 2.0, commandAction: 'CreateDuct' },
    { id: 'MEP-102', domain: 'Ventilation', subType: 'Duct', rule: '风管风速 ≤ 8m/s（住宅低风压系统，设计参考）', source: 'GB 50243-2024', severity: 'warning', field: null },
    { id: 'MEP-103', domain: 'Ventilation', subType: 'Duct', rule: '卫生间排风管最小尺寸 150×150mm（设计参考）', source: 'GB 50243-2024', severity: 'warning', field: 'width', minValue: 0.15, commandAction: 'CreateDuct' },
    { id: 'MEP-104', domain: 'Ventilation', subType: 'Duct', rule: '厨房排油烟管最小尺寸 200×200mm（设计参考）', source: 'GB 50243-2024', severity: 'warning', field: 'width', minValue: 0.2, commandAction: 'CreateDuct' },
    // 建筑电气与智能化通用规范 GB 55024-2022 + 低压配电设计规范 GB 50054-2011
    { id: 'MEP-201', domain: 'CableCarrier', subType: 'Electrical', rule: '电缆桥架宽度 ≤ 600mm（住宅标准，设计参考）', source: 'GB 55024-2022', severity: 'warning', field: 'width', maxValue: 0.6, commandAction: 'CreateCableCarrier' },
    { id: 'MEP-202', domain: 'CableCarrier', subType: 'Electrical', rule: '桥架距地高度 ≥ 2.2m（顶部布置，设计参考）', source: 'GB 50054-2011', severity: 'warning', field: 'z', minValue: 2.2, commandAction: 'CreateCableCarrier' },
    { id: 'MEP-203', domain: 'CableCarrier', subType: 'Electrical', rule: '桥架与水管间距 ≥ 0.3m（平行布置，安全强制）', source: 'GB 55024-2022', severity: 'error', field: null },
    // V2 P2: AutoRoutePipe 专用规范（管径规范通过 ACTION_ALIAS 复用 CreatePipe 无 subType 通用规则）
    { id: 'MEP-301', domain: 'Piping', subType: null, rule: '管道与障碍物间隙 ≥ 20mm（安装操作空间，安全强制）', source: 'GB 50242-2025', severity: 'error', field: 'clearanceMm', minValue: 20, commandAction: 'AutoRoutePipe' },
    { id: 'MEP-302', domain: 'Piping', subType: null, rule: '管道与障碍物间隙建议 ≥ 50mm（检修维护空间，设计参考）', source: 'GB 50242-2025', severity: 'warning', field: 'clearanceMm', recommendedValue: 50, commandAction: 'AutoRoutePipe' },
    { id: 'MEP-303', domain: 'Piping', subType: null, rule: '自动布管最小管径 DN15（通用下限，安全强制）', source: 'GB 50015-2019', severity: 'error', field: 'diameterMm', minValue: 15, commandAction: 'AutoRoutePipe' }
  ],

  // ─── H8.3 材料规格知识库（来源已核查至现行版本） ───
  material: [
    // 墙体材料
    { id: 'MAT-001', type: 'Wall', material: '加气混凝土砌块', thickness: '200mm', fireRating: 'A1', thermalConductivity: 0.16, source: 'GB/T 11968-2020' },
    { id: 'MAT-002', type: 'Wall', material: '钢筋混凝土墙', thickness: '200mm', fireRating: 'A1', thermalConductivity: 1.74, source: 'GB/T 50010-2010(2024年版)' },
    { id: 'MAT-003', type: 'Wall', material: '空心砖墙', thickness: '240mm', fireRating: 'A2', thermalConductivity: 0.45, source: 'GB/T 13545-2014' },
    { id: 'MAT-004', type: 'Wall', material: '轻钢龙骨石膏板', thickness: '120mm', fireRating: 'B1', thermalConductivity: 0.25, source: 'GB/T 11981-2019' },
    { id: 'MAT-005', type: 'Wall', material: '玻璃幕墙', thickness: '200mm（中空Low-E）', fireRating: 'A2', thermalConductivity: 1.8, source: 'JGJ 102-2003' },
    // 楼板材料
    { id: 'MAT-101', type: 'Slab', material: '现浇钢筋混凝土楼板', thickness: '120mm', fireRating: 'A1', thermalConductivity: 1.74, source: 'GB/T 50010-2010(2024年版)' },
    { id: 'MAT-102', type: 'Slab', material: '预制空心板', thickness: '150mm', fireRating: 'A1', thermalConductivity: 1.2, source: 'GB/T 14040-2007' },
    { id: 'MAT-103', type: 'Slab', material: '压型钢板组合楼板', thickness: '150mm', fireRating: 'A1', thermalConductivity: 1.74, source: 'GB/T 50010-2010(2024年版)' },
    // 屋面材料
    { id: 'MAT-201', type: 'Roof', material: '现浇钢筋混凝土屋面板', thickness: '150mm', fireRating: 'A1', thermalConductivity: 1.74, source: 'GB/T 50010-2010(2024年版)' },
    { id: 'MAT-202', type: 'Roof', material: '压型钢板屋面', thickness: '80mm（含保温）', fireRating: 'B1', thermalConductivity: 0.04, source: 'GB/T 12755-2021' },
    // 门窗材料
    { id: 'MAT-301', type: 'Door', material: '木质夹板门', thickness: '40mm', fireRating: 'B1', thermalConductivity: 0.16, source: 'WB/T 1024-2006' },
    { id: 'MAT-302', type: 'Window', material: '断桥铝合金窗', thickness: '70mm（中空玻璃）', fireRating: 'B1', thermalConductivity: 2.8, source: 'GB/T 8478-2020' },
    { id: 'MAT-303', type: 'Door', material: '防火门（木质）', thickness: '50mm', fireRating: '甲级1.5h', thermalConductivity: 0.16, source: 'GB 12955-2024' },
    { id: 'MAT-304', type: 'Door', material: '防火门（钢质）', thickness: '55mm', fireRating: '乙级1.0h', thermalConductivity: 0.58, source: 'GB 12955-2024' },
    // 管道材料
    { id: 'MAT-401', type: 'Pipe', material: 'PPR给水管', thickness: 'PN1.6MPa', fireRating: 'B2', thermalConductivity: 0.24, source: 'GB/T 18742.2-2017' },
    { id: 'MAT-402', type: 'Pipe', material: 'PVC排水管', thickness: 'PN6kg', fireRating: 'B2', thermalConductivity: 0.16, source: 'GB/T 5836.1-2018' },
    { id: 'MAT-403', type: 'Pipe', material: '镀锌钢管', thickness: 'PN1.6MPa', fireRating: 'A1', thermalConductivity: 0.45, source: 'GB/T 3091-2025' }
  ],

  // ─── LLM 注入段落模板（中文）───
  i18n: {
    sectionTitle: '## 领域知识库（H8 建筑规范 + MEP标准 + 材料规格）',
    sectionIntro: '**重要**: 生成命令时必须遵守以下规范，违反规范时降低 confidence 并在 warningText 中提示。',
    buildingTitle: '### 建筑规范（GB 国标）',
    mepTitle: '### MEP 标准规范',
    materialTitle: '### 常用材料规格',
    severityError: '⚠必须',
    severityWarning: '建议',
    sourceLabel: '来源',
    materialHints: [
      '外墙: 加气混凝土砌块 200mm / 钢筋混凝土 200mm',
      '内墙: 轻钢龙骨石膏板 120mm / 空心砖 240mm',
      '楼板: 现浇钢筋混凝土 120mm',
      '门: 木质夹板门 40mm / 窗: 断桥铝合金 70mm'
    ],
    // 任务类型推断关键词
    intentKeywords: {
      pipe: ['管', '风管', '桥架'],
      building: ['墙', '楼板', '屋顶'],
      doorWindow: ['门', '窗'],
      drainage: ['排水', '废水', '污水', '雨水', 'waste', 'drain', 'sewage', 'rain'],
      water: ['给水', '冷水', '热水', '循环', '冷水管', '热水管', '循环管', '供水', '进水', 'water', 'cold', 'hot', 'circulation'],
      duct: ['风'],
      electrical: ['桥架']
    }
  }
};

// task-templates.js
// V2 H5.5 自然语言任务模板库
//
// 职责：存储常见建筑/MEP 任务模板，用户输入匹配模板时快速生成完整计划
// 优势：避免每次都调 LLM，降低延迟；模板可由用户自定义扩展
//
// 模板匹配优先级：
//   1. 精确关键词匹配 → 模板快速生成
//   2. LLM 语义分解（decomposeGoal）
//   3. descriptor nlTriggers 单命令匹配

const path = require('path');
const fs = require('fs');
const { migrateLegacyFile } = require('./runtime-paths');
const { normalizeUiLocale } = require('./ui-locale');

const TEMPLATES_FILE = migrateLegacyFile('.task-templates.json');

// 内置 10+ 场景模板（H5.5 基础集）
// TPL-001 于 2026-07-06 基于参照文件首层实际19面墙重新生成
// 数据来源: GetElementsByType(Wall, floorIndex=0) + GetElementGeometry 逐面读取
// 关键变更（vs 2026-07-04 旧版）:
//   - 墙数 24 → 19（删除9面文件中不存在的墙: 承重横墙2/3, 承重纵墙2, 内隔墙3/8/10/11/14/15）
//   - 新增3面文件中实际存在的墙: 西卫生间横墙(-5.99,-5.87)→(-2.06,-5.87), 中部横墙(-0.65,-2.87)→(4.72,-2.87), 卫生间纵墙(4.72,-2.87)→(4.73,-0.37)
//   - 厚度统一: 旧版分3级(0.36/0.21/0.20) → 新版全部0.30m（实测一致）
//   - 高度统一: 旧版3.4m → 新版3.0m（实测一致）
//   - Y坐标微调: 承重横墙1 y=-5.90 → -5.87, 内隔墙2 终点x=-1.05 → -2.06, 内隔墙9 终点y=-5.72 → -11.37, 内隔墙13 起点/终点 y=-0.09 → -0.37
const BUILTIN_TEMPLATES = [
  {
    id: 'TPL-001',
    name: '示例首层房间墙体',
    category: 'building',
    keywords: { zh: ['示例住宅', '住宅户型', '建住宅', '建房子', '户型', '标准住宅', '小户型', '建一个住宅', '首层墙体', '示例首层'], en: ['sample house', 'residential layout', 'apartment plan', 'build a house', 'ground floor walls'] },
    description: '\u{6309} AC28 \u{6587}\u{4ef6}\u{9996}\u{5c42}\u{5df2}\u{6709}\u{5899}\u{4f53}\u{53c2}\u{6570}\u{521b}\u{5efa}\u{793a}\u{4f8b}\u{9996}\u{5c42}\u{623f}\u{95f4}\u{5899}\u{4f53}\u{ff0c}\u{5305}\u{542b}\u{5916}\u{5899}\u{3001}\u{627f}\u{91cd}\u{5899}\u{548c}\u{5185}\u{9694}\u{5899}\u{7684}\u{5b9e}\u{6d4b}\u{5750}\u{6807}\u{3002}',
    generate: (params = {}) => {
      // 坐标来源: GetElementsByType(Wall, floorIndex=0) + GetElementGeometry 逐面读取（2026-07-06）
      // 外围轮廓: X[-5.99, 9.31] × Y[-11.37, 2.93]
      const offsetX = params.offsetX || 0;
      const offsetY = params.offsetY || 0;

      // 实测: 所有墙厚度统一 0.30m，高度统一 3.0m
      const t = params.thickness || 0.30;           // 墙厚 300mm（实测统一）
      const h = params.height || 3.0;               // 墙高 3.0m（实测统一）

      const ox = (x) => x + offsetX;
      const oy = (y) => y + offsetY;

      return {
        userIntent: '\u{793a}\u{4f8b}\u{521b}\u{5efa}\u{9996}\u{5c42}\u{623f}\u{95f4}\u{5899}\u{4f53}\u{ff08}\u{53c2}\u{7167}\u{6587}\u{4ef6}\u{9996}\u{5c42}\u{771f}\u{5b9e}\u{5750}\u{6807}\u{ff09}',
        steps: [
          // —— 外墙 4 面（矩形闭合，实测坐标） ——
          { action: 'CreateWall', title: `南外墙 (-5.99,-11.37)→(9.31,-11.37) t=0.30 L=15.30m`, params: { start: { x: ox(-5.99), y: oy(-11.37) }, end: { x: ox(9.31), y: oy(-11.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `北外墙 (-5.99,2.93)→(9.31,2.93) t=0.30 L=15.30m`, params: { start: { x: ox(-5.99), y: oy(2.93) }, end: { x: ox(9.31), y: oy(2.93) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `西外墙 (-5.99,-11.37)→(-5.99,2.93) t=0.30 L=14.30m`, params: { start: { x: ox(-5.99), y: oy(-11.37) }, end: { x: ox(-5.99), y: oy(2.93) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `东外墙 (9.31,-11.37)→(9.31,2.93) t=0.30 L=14.30m`, params: { start: { x: ox(9.31), y: oy(-11.37) }, end: { x: ox(9.31), y: oy(2.93) }, thickness: t, height: h }, riskLevel: 'create-element' },
          // —— 内部承重墙 2 面（实测坐标） ——
          { action: 'CreateWall', title: `承重横墙1 (-0.65,-5.87)→(4.70,-5.87) t=0.30 L=5.35m`, params: { start: { x: ox(-0.65), y: oy(-5.87) }, end: { x: ox(4.70), y: oy(-5.87) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `承重纵墙1 (-0.65,-0.37)→(-0.65,-5.87) t=0.30 L=5.50m`, params: { start: { x: ox(-0.65), y: oy(-0.37) }, end: { x: ox(-0.65), y: oy(-5.87) }, thickness: t, height: h }, riskLevel: 'create-element' },
          // —— 内隔墙 13 面（实测坐标） ——
          { action: 'CreateWall', title: `内隔墙1 (6.50,-8.79)→(9.31,-8.79) t=0.30 L=2.81m`, params: { start: { x: ox(6.50), y: oy(-8.79) }, end: { x: ox(9.31), y: oy(-8.79) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙2 (4.70,-7.51)→(-2.06,-7.51) t=0.30 L=6.76m`, params: { start: { x: ox(4.70), y: oy(-7.51) }, end: { x: ox(-2.06), y: oy(-7.51) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙3 (6.50,-6.21)→(9.31,-6.21) t=0.30 L=2.81m`, params: { start: { x: ox(6.50), y: oy(-6.21) }, end: { x: ox(9.31), y: oy(-6.21) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙4 (6.50,-3.23)→(9.31,-3.23) t=0.30 L=2.81m`, params: { start: { x: ox(6.50), y: oy(-3.23) }, end: { x: ox(9.31), y: oy(-3.23) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙5 (-0.65,-0.37)→(4.73,-0.37) t=0.30 L=5.38m`, params: { start: { x: ox(-0.65), y: oy(-0.37) }, end: { x: ox(4.73), y: oy(-0.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙6 (-2.06,2.93)→(-2.06,-11.37) t=0.30 L=14.30m`, params: { start: { x: ox(-2.06), y: oy(2.93) }, end: { x: ox(-2.06), y: oy(-11.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙7 (4.70,-11.37)→(4.70,-7.51) t=0.30 L=3.86m`, params: { start: { x: ox(4.70), y: oy(-11.37) }, end: { x: ox(4.70), y: oy(-7.51) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙8 (6.50,-0.37)→(6.50,-11.37) t=0.30 L=11.00m`, params: { start: { x: ox(6.50), y: oy(-0.37) }, end: { x: ox(6.50), y: oy(-11.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙9 (4.72,-2.87)→(4.73,-0.37) t=0.30 L=2.50m`, params: { start: { x: ox(4.72), y: oy(-2.87) }, end: { x: ox(4.73), y: oy(-0.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙10 (6.50,-0.37)→(9.31,-0.37) t=0.30 L=2.81m`, params: { start: { x: ox(6.50), y: oy(-0.37) }, end: { x: ox(9.31), y: oy(-0.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙11 (-5.99,-0.37)→(-2.06,-0.37) t=0.30 L=3.93m`, params: { start: { x: ox(-5.99), y: oy(-0.37) }, end: { x: ox(-2.06), y: oy(-0.37) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙12 (-5.99,-5.87)→(-2.06,-5.87) t=0.30 L=3.93m`, params: { start: { x: ox(-5.99), y: oy(-5.87) }, end: { x: ox(-2.06), y: oy(-5.87) }, thickness: t, height: h }, riskLevel: 'create-element' },
          { action: 'CreateWall', title: `内隔墙13 (-0.65,-2.87)→(4.72,-2.87) t=0.30 L=5.37m`, params: { start: { x: ox(-0.65), y: oy(-2.87) }, end: { x: ox(4.72), y: oy(-2.87) }, thickness: t, height: h }, riskLevel: 'create-element' }
        ]
      };
    }
  },
  {
    id: 'TPL-002',
    name: '示例布置首层风管',
    category: 'mep',
    keywords: { zh: ['首层风管', '布置风管', '示例风管', '空调管', '暖通风管', '新风管', '送风管', '示例布置首层风管'], en: ['duct layout', 'hvac duct', 'ground floor duct', 'air duct', 'fresh air duct', 'supply duct'] },
    description: '\u{6309} AC28 \u{6587}\u{4ef6}\u{9996}\u{5c42}\u{5df2}\u{6709}\u{6784}\u{4ef6}\u{53c2}\u{6570}\u{521b}\u{5efa}\u{ff1a}2\u{6bb5}10\u{6b65}\u{697c}\u{68af} + 1\u{5757}\u{8fde}\u{63a5}\u{697c}\u{68af}\u{697c}\u{677f}\u{ff0c}\u{540c}\u{56fe}\u{5c42}\u{4f4d}\u{7f6e}\u{3002}\u{697c}\u{68af}\u{9ad8}1.5m\u{3001}\u{5bbd}1.2m\u{ff1b}\u{5e73}\u{53f0}\u{697c}\u{677f}\u{539a}0.24m\u{3001}level=1.5m\u{ff0c}\u{5750}\u{6807}(-0.4,-5.62)\u{5230}(1.1,-2.87)\u{3002}\u{53c2}\u{6570}\u{6765}\u{81ea}\u{5f53}\u{524d}\u{6587}\u{4ef6} mesh/AABB \u{8bfb}\u{53d6}\u{7ed3}\u{679c}\u{3002}',
    generate: (params = {}) => {
      // 数据来源: AC28 当前文件 GetElementsByType(MEPRoute, includeAabb=true) + GetMEPElementInfo(routeGuid) 2026-07-13
      // 3条新风路由，系统名=新风，domain=Ventilation，floorIndex=0，layerName=MEP - 空调系统
      const offsetX = params.offsetX || 0;
      const offsetY = params.offsetY || 0;
      const ox = (x) => x + offsetX;
      const oy = (y) => y + offsetY;

      const mainDuctW = params.ductWidth || 0.60;        // 新风主段宽 600mm（实测 route 1/3）
      const branchDuctW = params.branchDuctWidth || 0.50; // 新风西段宽 500mm（实测 route 2）
      const ductH = params.ductHeight || 0.30;           // 风管高 300mm
      const z = params.z || 2.4;                         // 贴顶高度 2.4m（实测 offsetFromHomeStory）

      return {
        userIntent: `示例布置首层风管（3条新风路由，贴顶2.4m，矩形600×300/500×300）`,
        steps: [
          // routeGuid=BC8707D4，polyline 3点，Rectangular 600×300
          { action: 'CreateDuct', title: `新风管1-南段 (6.75,-10.12)→(5.65,-10.12)→(5.65,-6.81) 600×300mm 贴顶2.4m`, params: { waypoints: [{ x: ox(6.750), y: oy(-10.120), z }, { x: ox(5.653), y: oy(-10.120), z }, { x: ox(5.653), y: oy(-6.808), z }], width: mainDuctW, height: ductH }, riskLevel: 'create-element' },
          // routeGuid=0CBDF795，polyline 4点，Rectangular 500×300
          { action: 'CreateDuct', title: `新风管2-西段 (5.65,-6.81)→(-1.26,-6.81)→(-1.26,-1.05)→(-0.40,-1.05) 500×300mm 贴顶2.4m`, params: { waypoints: [{ x: ox(5.653), y: oy(-6.808), z }, { x: ox(-1.262), y: oy(-6.814), z }, { x: ox(-1.262), y: oy(-1.048), z }, { x: ox(-0.400), y: oy(-1.048), z }], width: branchDuctW, height: ductH }, riskLevel: 'create-element' },
          // routeGuid=6FDE358E，polyline 3点，Rectangular 600×300
          { action: 'CreateDuct', title: `新风管3-北段 (5.65,-6.81)→(5.65,-1.31)→(6.75,-1.31) 600×300mm 贴顶2.4m`, params: { waypoints: [{ x: ox(5.653), y: oy(-6.808), z }, { x: ox(5.653), y: oy(-1.314), z }, { x: ox(6.750), y: oy(-1.314), z }], width: mainDuctW, height: ductH }, riskLevel: 'create-element' }
        ]
      };
    }
  },
  {
    id: 'TPL-003',
    name: '首层双跑楼梯与平台楼板',
    category: 'building',
    keywords: {
      zh: ['示例楼梯', '创建楼梯', '首层楼梯', '建楼梯', '画楼梯', '示例创建首层楼梯', '楼梯楼板', '楼梯平台', '两段楼梯', '2段楼梯'],
      en: ['sample stair', 'create stair', 'ground floor stair', 'build stair', 'two flight stair', 'landing slab']
    },
    description: '\u{6309} AC28 \u{6587}\u{4ef6}\u{9996}\u{5c42}\u{5df2}\u{6709}\u{6784}\u{4ef6}\u{53c2}\u{6570}\u{521b}\u{5efa}\u{ff1a}2\u{6bb5}10\u{6b65}\u{697c}\u{68af} + 1\u{5757}\u{8fde}\u{63a5}\u{697c}\u{68af}\u{697c}\u{677f}\u{ff0c}\u{540c}\u{56fe}\u{5c42}\u{4f4d}\u{7f6e}\u{3002}\u{697c}\u{68af}\u{9ad8}1.5m\u{3001}\u{5bbd}1.2m\u{ff1b}\u{5e73}\u{53f0}\u{697c}\u{677f}\u{539a}0.24m\u{3001}level=1.5m\u{ff0c}\u{5750}\u{6807}(-0.4,-5.62)\u{5230}(1.1,-2.87)\u{3002}\u{53c2}\u{6570}\u{6765}\u{81ea}\u{5f53}\u{524d}\u{6587}\u{4ef6} mesh/AABB \u{8bfb}\u{53d6}\u{7ed3}\u{679c}\u{3002}',
    generate: (params = {}) => {
      const offsetX = params.offsetX || 0;
      const offsetY = params.offsetY || 0;

      const stepNum = params.stepNum || 10;
      const totalHeight = params.totalHeight || 1.5;
      const flightWidth = params.flightWidth || 1.2;
      const floorIndex = params.floorIndex ?? 0;
      const lowerFlightBaseLevel = params.lowerFlightBaseLevel ?? 0.0;
      const upperFlightBaseLevel = params.upperFlightBaseLevel ?? 1.5;

      const translatePoint = (pt) => ({ x: pt.x + offsetX, y: pt.y + offsetY });
      const landingPolygon = [
        { x: -0.4, y: -5.62 },
        { x: 1.1, y: -5.62 },
        { x: 1.1, y: -2.87 },
        { x: -0.4, y: -2.87 }
      ].map(translatePoint);

      // Derived from current file mesh/AABB:
      // Stair A AABB: x 1.093790198..4.64, y -4.071811192..-2.868188808
      // Stair B AABB: x 1.020000012..4.566209814, y -5.621811181..-4.418188796
      const upperFlightWaypoints = [
        { x: 1.093790198, y: -3.47 },
        { x: 4.64, y: -3.47 }
      ].map(translatePoint);
      const lowerFlightWaypoints = [
        { x: 4.566209814, y: -5.02 },
        { x: 1.020000012, y: -5.02 }
      ].map(translatePoint);

      return {
        userIntent: '\u{793a}\u{4f8b}\u{521b}\u{5efa}\u{9996}\u{5c42}\u{697c}\u{68af}\u{ff1a}2\u{6bb5}10\u{6b65}\u{697c}\u{68af} + 1\u{5757}\u{8fde}\u{63a5}\u{697c}\u{68af}\u{697c}\u{677f}\u{ff0c}\u{540c}\u{56fe}\u{5c42}\u{4f4d}\u{7f6e}',
        steps: [
          {
            action: 'CreateSlab',
            title: '创建楼梯平台/楼板 level=1.5m 厚0.24m 范围1.5×2.75m',
            params: { polygon: landingPolygon, thickness: 0.24, level: 1.5, floorIndex, dryRun: true, confirmRequired: true },
            riskLevel: 'create-element'
          },
          {
            action: 'CreateStair',
            title: `\u{521b}\u{5efa}\u{4e0a}\u{8dd1}\u{697c}\u{68af}\u{6bb5} 10\u{6b65}\u{9ad8}1.5m\u{5bbd}1.2m\u{ff0c}baseLevel=1.5m\u{ff0c}mesh\u{4e2d}\u{7ebf} (1.09,-3.47)->(4.64,-3.47)`,
            params: { start: upperFlightWaypoints[0], end: upperFlightWaypoints[upperFlightWaypoints.length - 1], waypoints: upperFlightWaypoints, totalHeight, baseLevel: upperFlightBaseLevel, stepNum, flightWidth, floorIndex, dryRun: true, confirmRequired: true },
            riskLevel: 'create-element'
          },
          {
            action: 'CreateStair',
            title: `\u{521b}\u{5efa}\u{4e0b}\u{8dd1}\u{697c}\u{68af}\u{6bb5} 10\u{6b65}\u{9ad8}1.5m\u{5bbd}1.2m\u{ff0c}baseLevel=0m\u{ff0c}mesh\u{4e2d}\u{7ebf} (4.57,-5.02)->(1.02,-5.02)`,
            params: { start: lowerFlightWaypoints[0], end: lowerFlightWaypoints[lowerFlightWaypoints.length - 1], waypoints: lowerFlightWaypoints, totalHeight, baseLevel: lowerFlightBaseLevel, stepNum, flightWidth, floorIndex, dryRun: true, confirmRequired: true },
            riskLevel: 'create-element'
          }
        ]
      };
    }
  },
  {
    id: 'TPL-004',
    name: '矩形楼板',
    category: 'building',
    keywords: { zh: ['建楼板', '创建楼板', '地板', '建地板'], en: ['create slab', 'create floor'] },
    generate: (params = {}) => {
      const w = params.width || 4, h = params.height || 3;
      return {
        userIntent: `建${w}×${h}楼板`,
        steps: [
          { action: 'CreateSlab', title: '矩形楼板', params: { polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], thickness: 0.15 }, riskLevel: 'create-element' }
        ]
      };
    }
  },
  {
    id: 'TPL-005',
    name: '坡屋顶',
    category: 'building',
    keywords: { zh: ['建屋顶', '坡屋顶', '盖顶'], en: ['create roof', 'pitched roof'] },
    generate: (params = {}) => {
      const w = params.width || 4, h = params.height || 3;
      return {
        userIntent: '建坡屋顶',
        steps: [
          { action: 'CreateRoof', title: '30度坡屋顶', params: { vertices: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], pitchAngle: 30, thickness: 0.2 }, riskLevel: 'create-element' }
        ]
      };
    }
  },
  {
    id: 'TPL-006',
    name: '单根水管',
    category: 'mep',
    keywords: { zh: ['建水管', '创建水管', '画水管', '一根水管'], en: ['create pipe', 'water pipe'] },
    generate: (params = {}) => ({
      userIntent: '建一根水管',
      steps: [
        { action: 'CreatePipe', title: '水管', params: { waypoints: params.waypoints || [{ x: 0, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }], diameterMm: params.diameterMm || 22 }, riskLevel: 'create-element' }
      ]
    })
  },
  {
    id: 'TPL-007',
    name: '矩形风管',
    category: 'mep',
    keywords: { zh: ['建风管', '创建风管', '画风管', '暖通'], en: ['create duct', 'hvac duct'] },
    generate: (params = {}) => ({
      userIntent: '建风管',
      steps: [
        { action: 'CreateDuct', title: '矩形风管', params: { waypoints: params.waypoints || [{ x: 0, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }], width: 0.3, height: 0.2 }, riskLevel: 'create-element' }
      ]
    })
  },
  {
    id: 'TPL-008',
    name: '电缆桥架',
    category: 'mep',
    keywords: { zh: ['建桥架', '创建桥架', '电缆桥架', '电气桥架'], en: ['cable tray', 'cable carrier'] },
    generate: (params = {}) => ({
      userIntent: '建电缆桥架',
      steps: [
        { action: 'CreateCableCarrier', title: '电缆桥架', params: { waypoints: params.waypoints || [{ x: 0, y: 0, z: 2.8 }, { x: 5, y: 0, z: 2.8 }], width: 0.15, height: 0.08 }, riskLevel: 'create-element' }
      ]
    })
  },
  {
    id: 'TPL-009',
    name: '柱子',
    category: 'building',
    keywords: { zh: ['建柱', '创建柱', '画柱', '立柱'], en: ['create column', 'add column'] },
    generate: (params = {}) => ({
      userIntent: '建柱',
      steps: [
        { action: 'CreateColumn', title: '柱子', params: { position: params.position || { x: 0, y: 0 }, height: params.height || 3.0 }, riskLevel: 'create-element' }
      ]
    })
  },
  {
    id: 'TPL-010',
    name: '梁',
    category: 'building',
    keywords: { zh: ['建梁', '创建梁', '画梁'], en: ['create beam', 'add beam'] },
    generate: (params = {}) => ({
      userIntent: '建梁',
      steps: [
        { action: 'CreateBeam', title: '梁', params: { start: params.start || { x: 0, y: 0 }, end: params.end || { x: 4, y: 0 } }, riskLevel: 'create-element' }
      ]
    })
  },
  {
    id: 'TPL-011',
    name: '移动选中',
    category: 'transform',
    keywords: { zh: ['移动', '平移', '偏移', '挪动'], en: ['move', 'shift', 'translate'] },
    generate: (params = {}) => ({
      userIntent: '移动选中构件',
      steps: [
        { action: 'MoveSelectedElements', title: '移动选中', params: { useCurrentSelection: true, deltaMm: params.deltaMm || { x: 0, y: 0, z: 0 } }, riskLevel: 'low-mutation' }
      ]
    })
  },
  {
    id: 'TPL-012',
    name: '旋转选中',
    category: 'transform',
    keywords: { zh: ['旋转', '转动'], en: ['rotate'] },
    generate: (params = {}) => ({
      userIntent: '旋转选中构件',
      steps: [
        { action: 'RotateSelectedElements', title: '旋转选中', params: { useCurrentSelection: true, center: params.center || { x: 0, y: 0 }, angle: params.angle || 1.5708 }, riskLevel: 'medium-mutation' }
      ]
    })
  }
];

const ENGLISH_TEMPLATE_METADATA = {
  'TPL-001': {
    name: 'Sample ground-floor room walls',
    description: 'Creates sample ground-floor room walls from measured reference coordinates.',
    userIntent: 'Create sample ground-floor room walls from measured reference coordinates',
    stepLabels: [
      'South exterior wall',
      'North exterior wall',
      'West exterior wall',
      'East exterior wall',
      'Load-bearing wall 1',
      'Load-bearing wall 2',
      'Interior partition 1',
      'Interior partition 2',
      'Interior partition 3',
      'Interior partition 4',
      'Interior partition 5',
      'Interior partition 6',
      'Interior partition 7',
      'Interior partition 8',
      'Interior partition 9',
      'Interior partition 10',
      'Interior partition 11',
      'Interior partition 12',
      'Interior partition 13',
    ],
  },
  'TPL-002': {
    name: 'Sample ground-floor ventilation ducts',
    description: 'Creates three measured fresh-air duct routes on the ground floor.',
    userIntent: 'Lay out three sample ground-floor fresh-air duct routes',
    stepLabels: [
      'Fresh-air duct 1 - south route',
      'Fresh-air duct 2 - west route',
      'Fresh-air duct 3 - north route',
    ],
  },
  'TPL-003': {
    name: 'Two-flight stair and landing slab',
    description: 'Creates two stair flights and one connecting landing slab from measured reference geometry.',
    userIntent: 'Create a sample two-flight ground-floor stair with a connecting landing slab',
    stepLabels: [
      'Create stair landing slab',
      'Create upper stair flight',
      'Create lower stair flight',
    ],
  },
  'TPL-004': {
    name: 'Rectangular slab',
    description: 'Creates a rectangular slab.',
    userIntent: 'Create a rectangular slab',
    stepLabels: ['Create rectangular slab'],
  },
  'TPL-005': {
    name: 'Pitched roof',
    description: 'Creates a 30-degree pitched roof.',
    userIntent: 'Create a pitched roof',
    stepLabels: ['Create 30-degree pitched roof'],
  },
  'TPL-006': {
    name: 'Single water pipe',
    description: 'Creates one water pipe route.',
    userIntent: 'Create a water pipe',
    stepLabels: ['Create water pipe'],
  },
  'TPL-007': {
    name: 'Rectangular duct',
    description: 'Creates one rectangular ventilation duct route.',
    userIntent: 'Create a rectangular duct',
    stepLabels: ['Create rectangular duct'],
  },
  'TPL-008': {
    name: 'Cable carrier',
    description: 'Creates one cable carrier route.',
    userIntent: 'Create a cable carrier',
    stepLabels: ['Create cable carrier'],
  },
  'TPL-009': {
    name: 'Column',
    description: 'Creates one column.',
    userIntent: 'Create a column',
    stepLabels: ['Create column'],
  },
  'TPL-010': {
    name: 'Beam',
    description: 'Creates one beam.',
    userIntent: 'Create a beam',
    stepLabels: ['Create beam'],
  },
  'TPL-011': {
    name: 'Move selected elements',
    description: 'Moves the current Archicad selection.',
    userIntent: 'Move selected elements',
    stepLabels: ['Move selected elements'],
  },
  'TPL-012': {
    name: 'Rotate selected elements',
    description: 'Rotates the current Archicad selection.',
    userIntent: 'Rotate selected elements',
    stepLabels: ['Rotate selected elements'],
  },
};

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toFixed(3).replace(/\.?0+$/, '');
}

function formatPoint(point) {
  if (!point || typeof point !== 'object') return '';
  const values = [formatNumber(point.x), formatNumber(point.y)];
  if (point.z !== undefined) values.push(formatNumber(point.z));
  return `(${values.join(', ')})`;
}

function englishStepTitle(templateId, step, index, metadata) {
  const label = metadata.stepLabels?.[index] || step.action || `Step ${index + 1}`;

  if (templateId === 'TPL-001' && step.params?.start && step.params?.end) {
    return `${label}: ${formatPoint(step.params.start)} -> ${formatPoint(step.params.end)}; ` +
      `t=${formatNumber(step.params.thickness)}m, h=${formatNumber(step.params.height)}m`;
  }

  if (templateId === 'TPL-002' && Array.isArray(step.params?.waypoints)) {
    const route = step.params.waypoints.map(formatPoint).join(' -> ');
    const widthMm = Math.round(Number(step.params.width || 0) * 1000);
    const heightMm = Math.round(Number(step.params.height || 0) * 1000);
    return `${label}: ${route}; ${widthMm}x${heightMm}mm`;
  }

  if (templateId === 'TPL-003') {
    if (step.action === 'CreateSlab') {
      return `${label}: level=${formatNumber(step.params?.level)}m, ` +
        `thickness=${formatNumber(step.params?.thickness)}m`;
    }
    return `${label}: ${formatPoint(step.params?.start)} -> ${formatPoint(step.params?.end)}; ` +
      `${step.params?.stepNum || 0} steps, height=${formatNumber(step.params?.totalHeight)}m, ` +
      `width=${formatNumber(step.params?.flightWidth)}m`;
  }

  return label;
}

function localizeGeneratedPlan(template, plan, locale) {
  if (normalizeUiLocale(locale) !== 'en-US') {
    return plan;
  }

  const metadata = ENGLISH_TEMPLATE_METADATA[template.id];
  if (!metadata) {
    return plan;
  }

  return {
    ...plan,
    userIntent: metadata.userIntent,
    steps: plan.steps.map((step, index) => ({
      ...step,
      title: englishStepTitle(template.id, step, index, metadata),
    })),
  };
}

class TaskTemplateRegistry {
  constructor() {
    this.templates = [...BUILTIN_TEMPLATES];
    this._loadUserTemplates();
  }

  _loadUserTemplates() {
    try {
      if (fs.existsSync(TEMPLATES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
        if (Array.isArray(data.templates)) {
          // 用户模板覆盖同 id 内置模板
          this.templates = [
            ...this.templates.filter(t => !data.templates.find(ut => ut.id === t.id)),
            ...data.templates
          ];
          console.log(`[TaskTemplates] Loaded ${data.templates.length} user templates`);
        }
      }
    } catch (e) {
      console.error('[TaskTemplates] Load user templates failed:', e.message);
    }
  }

  /**
   * 匹配模板（关键词匹配）
   * @returns {Object|null} 匹配的模板或 null
   */
  match(text) {
    const lower = text.toLowerCase().trim();
    for (const tpl of this.templates) {
      const allKeywords = [
        ...(tpl.keywords?.zh || []),
        ...(tpl.keywords?.en || [])
      ];
      for (const kw of allKeywords) {
        if (lower.includes(kw.toLowerCase())) {
          return tpl;
        }
      }
    }
    return null;
  }

  /**
   * 快速生成计划（命中模板时）
   * @returns {Object|null} { userIntent, steps } 或 null
   */
  tryGenerate(text, context = {}) {
    const tpl = this.match(text);
    if (!tpl) return null;

    try {
      // 模板 generate 函数可能需要从 context 提取参数
      const params = context.templateParams || {};
      const locale = normalizeUiLocale(context.locale || context.language);
      const plan = localizeGeneratedPlan(tpl, tpl.generate(params), locale);
      if (plan && plan.steps && plan.steps.length > 0) {
        console.log(`[TaskTemplates] Template matched: ${tpl.id} (${tpl.name}), generated ${plan.steps.length} steps`);
        return plan;
      }
    } catch (e) {
      console.error('[TaskTemplates] Generate failed for', tpl.id, e.message);
    }
    return null;
  }

  list(locale = 'zh-CN') {
    const normalizedLocale = normalizeUiLocale(locale);
    return this.templates.map(t => ({
      id: t.id,
      name: normalizedLocale === 'en-US'
        ? (ENGLISH_TEMPLATE_METADATA[t.id]?.name || t.name)
        : t.name,
      category: t.category,
      description: normalizedLocale === 'en-US'
        ? (ENGLISH_TEMPLATE_METADATA[t.id]?.description || t.description || '')
        : (t.description || ''),
    }));
  }
}

module.exports = new TaskTemplateRegistry();

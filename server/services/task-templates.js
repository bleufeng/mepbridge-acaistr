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
const { extractTemplateParams } = require('./nl-param-extractors');

const TEMPLATES_FILE = migrateLegacyFile('.task-templates.json');

// ── 示例box 组合模板（TPL-021）冻结字面量 ──
// 来源：运行时用户模板冻结快照（柱梁 TPL-STRUCT-FRAME-20260918 / 机电 TPL-007 2026-09-20 重采）。
// 与用户模板不自动同步；内置更新需重跑本拼接或手工维护。
const BOX_STRUCT_STEPS = [{"action":"CreateColumn","title":"Column 001 [首层] 层0 (-5.84,-11.22) h=2.8","params":{"position":{"x":-5.84,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 002 [首层] 层0 (-5.84,2.78) h=2.8","params":{"position":{"x":-5.84,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 003 [首层] 层0 (9.16,2.78) h=2.8","params":{"position":{"x":9.16,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 004 [首层] 层0 (9.16,-11.22) h=2.8","params":{"position":{"x":9.16,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 005 [首层] 层0 (-5.84,-6.02) h=2.8","params":{"position":{"x":-5.84,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 006 [首层] 层0 (9.16,-6.02) h=2.8","params":{"position":{"x":9.16,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 007 [首层] 层0 (-2.21,-11.22) h=2.8","params":{"position":{"x":-2.21,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 008 [首层] 层0 (-2.21,2.78) h=2.8","params":{"position":{"x":-2.21,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 009 [首层] 层0 (-2.21,-6.02) h=2.8","params":{"position":{"x":-2.21,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 010 [首层] 层0 (4.55,-11.22) h=2.8","params":{"position":{"x":4.55,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 011 [首层] 层0 (4.55,2.78) h=2.8","params":{"position":{"x":4.55,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 012 [首层] 层0 (4.55,-6.02) h=2.8","params":{"position":{"x":4.55,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":0},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 013 [二层] 层1 (-5.84,-11.22) h=2.8","params":{"position":{"x":-5.84,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 014 [二层] 层1 (-5.84,2.78) h=2.8","params":{"position":{"x":-5.84,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 015 [二层] 层1 (9.16,2.78) h=2.8","params":{"position":{"x":9.16,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 016 [二层] 层1 (9.16,-11.22) h=2.8","params":{"position":{"x":9.16,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 017 [二层] 层1 (-5.84,-6.02) h=2.8","params":{"position":{"x":-5.84,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 018 [二层] 层1 (9.16,-6.02) h=2.8","params":{"position":{"x":9.16,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 019 [二层] 层1 (-2.21,-11.22) h=2.8","params":{"position":{"x":-2.21,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 020 [二层] 层1 (-2.21,2.78) h=2.8","params":{"position":{"x":-2.21,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 021 [二层] 层1 (-2.21,-6.02) h=2.8","params":{"position":{"x":-2.21,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 022 [二层] 层1 (4.55,-11.22) h=2.8","params":{"position":{"x":4.55,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 023 [二层] 层1 (4.55,2.78) h=2.8","params":{"position":{"x":4.55,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 024 [二层] 层1 (4.55,-6.02) h=2.8","params":{"position":{"x":4.55,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":1},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 001 [二层] 层1 (-6.14,-5.87)->(9.46,-5.87) L=15.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":-6.14,"y":-5.87},"end":{"x":9.46,"y":-5.87},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 002 [二层] 层1 (-6.14,2.93)->(9.46,2.93) L=15.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":-6.14,"y":2.93},"end":{"x":9.46,"y":2.93},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 003 [二层] 层1 (-6,-0.37)->(9.318,-0.37) L=15.318 offset=0 Z=[2.6, 3]","params":{"start":{"x":-6,"y":-0.37},"end":{"x":9.317653,"y":-0.37},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 004 [二层] 层1 (-2.06,-11.52)->(-2.06,3.08) L=14.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":-2.06,"y":-11.52},"end":{"x":-2.06,"y":3.08},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 005 [二层] 层1 (-5.99,-11.52)->(-5.99,3.08) L=14.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":-5.99,"y":-11.52},"end":{"x":-5.99,"y":3.08},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 006 [二层] 层1 (-6.14,-11.37)->(9.31,-11.37) L=15.45 offset=0 Z=[2.6, 3]","params":{"start":{"x":-6.14,"y":-11.37},"end":{"x":9.310103,"y":-11.37},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 007 [二层] 层1 (4.7,-11.52)->(4.7,3.08) L=14.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":4.7,"y":-11.52},"end":{"x":4.7,"y":3.08},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 008 [二层] 层1 (9.31,-11.52)->(9.31,3.08) L=14.6 offset=0 Z=[2.6, 3]","params":{"start":{"x":9.31,"y":-11.52},"end":{"x":9.31,"y":3.08},"floorIndex":1,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 025 [三层] 层2 (-5.84,-11.22) h=2.8","params":{"position":{"x":-5.84,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 026 [三层] 层2 (-5.84,2.78) h=2.8","params":{"position":{"x":-5.84,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 027 [三层] 层2 (9.16,2.78) h=2.8","params":{"position":{"x":9.16,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 028 [三层] 层2 (9.16,-11.22) h=2.8","params":{"position":{"x":9.16,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 029 [三层] 层2 (-5.84,-6.02) h=2.8","params":{"position":{"x":-5.84,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 030 [三层] 层2 (9.16,-6.02) h=2.8","params":{"position":{"x":9.16,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 031 [三层] 层2 (-2.21,-11.22) h=2.8","params":{"position":{"x":-2.21,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 032 [三层] 层2 (-2.21,2.78) h=2.8","params":{"position":{"x":-2.21,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 033 [三层] 层2 (-2.21,-6.02) h=2.8","params":{"position":{"x":-2.21,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 034 [三层] 层2 (4.55,-11.22) h=2.8","params":{"position":{"x":4.55,"y":-11.22},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 035 [三层] 层2 (4.55,2.78) h=2.8","params":{"position":{"x":4.55,"y":2.78},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateColumn","title":"Column 036 [三层] 层2 (4.55,-6.02) h=2.8","params":{"position":{"x":4.55,"y":-6.02},"height":2.8,"dryRun":false,"confirmRequired":true,"floorIndex":2},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 009 [三层] 层2 (-6.14,2.93)->(9.46,2.93) L=15.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":-6.14,"y":2.93},"end":{"x":9.46,"y":2.93},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 010 [三层] 层2 (-6,-0.37)->(9.318,-0.37) L=15.318 offset=0 Z=[5.6, 6]","params":{"start":{"x":-6,"y":-0.37},"end":{"x":9.317653,"y":-0.37},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 011 [三层] 层2 (9.31,-11.52)->(9.31,3.08) L=14.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":9.31,"y":-11.52},"end":{"x":9.31,"y":3.08},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 012 [三层] 层2 (4.7,-11.52)->(4.7,3.08) L=14.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":4.7,"y":-11.52},"end":{"x":4.7,"y":3.08},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 013 [三层] 层2 (-2.06,-11.52)->(-2.06,3.08) L=14.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":-2.06,"y":-11.52},"end":{"x":-2.06,"y":3.08},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 014 [三层] 层2 (-6.14,-11.37)->(9.31,-11.37) L=15.45 offset=0 Z=[5.6, 6]","params":{"start":{"x":-6.14,"y":-11.37},"end":{"x":9.310103,"y":-11.37},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 015 [三层] 层2 (-6.14,-5.87)->(9.46,-5.87) L=15.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":-6.14,"y":-5.87},"end":{"x":9.46,"y":-5.87},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 016 [三层] 层2 (-5.99,-11.52)->(-5.99,3.08) L=14.6 offset=0 Z=[5.6, 6]","params":{"start":{"x":-5.99,"y":-11.52},"end":{"x":-5.99,"y":3.08},"floorIndex":2,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 017 [屋面] 层3 (-6.14,-5.87)->(9.46,-5.87) L=15.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":-6.14,"y":-5.87},"end":{"x":9.46,"y":-5.87},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 018 [屋面] 层3 (-6.14,-11.37)->(9.31,-11.37) L=15.45 offset=0 Z=[8.6, 9]","params":{"start":{"x":-6.14,"y":-11.37},"end":{"x":9.310103,"y":-11.37},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 019 [屋面] 层3 (-6.14,2.93)->(9.46,2.93) L=15.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":-6.14,"y":2.93},"end":{"x":9.46,"y":2.93},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 020 [屋面] 层3 (-6,-0.37)->(9.318,-0.37) L=15.318 offset=0 Z=[8.6, 9]","params":{"start":{"x":-6,"y":-0.37},"end":{"x":9.317653,"y":-0.37},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 021 [屋面] 层3 (9.31,-11.52)->(9.31,3.08) L=14.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":9.31,"y":-11.52},"end":{"x":9.31,"y":3.08},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 022 [屋面] 层3 (4.7,-11.52)->(4.7,3.08) L=14.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":4.7,"y":-11.52},"end":{"x":4.7,"y":3.08},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 023 [屋面] 层3 (-2.06,-11.52)->(-2.06,3.08) L=14.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":-2.06,"y":-11.52},"end":{"x":-2.06,"y":3.08},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"},{"action":"CreateBeam","title":"Beam 024 [屋面] 层3 (-5.99,-11.52)->(-5.99,3.08) L=14.6 offset=0 Z=[8.6, 9]","params":{"start":{"x":-5.99,"y":-11.52},"end":{"x":-5.99,"y":3.08},"floorIndex":3,"dryRun":false,"confirmRequired":true},"riskLevel":"create-element"}];
const BOX_MEP_STEPS = [{"action":"CreateDuct","title":"新风干管1 (6.75,-10.12)→(5.65,-10.12)→(5.65,-6.81) 600×300mm z=2.4m","params":{"waypoints":[{"x":6.75,"y":-10.12,"z":2.4},{"x":5.653,"y":-10.12,"z":2.4},{"x":5.653,"y":-6.808,"z":2.4}],"width":0.6,"height":0.3},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风干管2 (5.65,-6.81)→(-1.26,-6.81)→(-1.26,-1.55) 500×300mm z=2.4m","params":{"waypoints":[{"x":5.653,"y":-6.808,"z":2.4},{"x":-1.262,"y":-6.814,"z":2.4},{"x":-1.262,"y":-1.548,"z":2.4}],"width":0.5,"height":0.3},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风干管3 (5.65,-6.81)→(5.65,-1.31)→(6.75,-1.31) 600×300mm z=2.4m","params":{"waypoints":[{"x":5.653,"y":-6.808,"z":2.4},{"x":5.653,"y":-1.314,"z":2.4},{"x":6.75,"y":-1.314,"z":2.4}],"width":0.6,"height":0.3},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管4 (-1.26,-6.81)→(-4,-6.81)→(-4,-8.7) 300×250mm z=2.4m","params":{"waypoints":[{"x":-1.262,"y":-6.814,"z":2.4},{"x":-4,"y":-6.814,"z":2.4},{"x":-4,"y":-8.7,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管5 (-1.26,-1.55)→(-1.26,1.3)→(-4,1.3) 300×250mm z=2.4m","params":{"waypoints":[{"x":-1.262,"y":-1.548,"z":2.4},{"x":-1.262,"y":1.3,"z":2.4},{"x":-4,"y":1.3,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管6 (-1.26,-3.5)→(-4,-3.5)→(-4,-3.2) 300×250mm z=2.4m","params":{"waypoints":[{"x":-1.262,"y":-3.5,"z":2.4},{"x":-4,"y":-3.5,"z":2.4},{"x":-4,"y":-3.2,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管7 (3.3,-6.81)→(3.3,-9.4) 300×250mm z=2.4m","params":{"waypoints":[{"x":3.3,"y":-6.814,"z":2.4},{"x":3.3,"y":-9.4,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管8 (5.65,-7.5)→(7.9,-7.5) 300×250mm z=2.4m","params":{"waypoints":[{"x":5.653,"y":-7.5,"z":2.4},{"x":7.9,"y":-7.5,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管9 (5.65,-4.7)→(7.9,-4.7) 300×250mm z=2.4m","params":{"waypoints":[{"x":5.653,"y":-4.7,"z":2.4},{"x":7.9,"y":-4.7,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风干管10 (-1.26,-1.55)→(-1.26,-1.05)→(-0.4,-1.05) 500×300mm z=2.4m","params":{"waypoints":[{"x":-1.262,"y":-1.548,"z":2.4},{"x":-1.262,"y":-1.048,"z":2.4},{"x":-0.4,"y":-1.048,"z":2.4}],"width":0.5,"height":0.3},"riskLevel":"create-element"},{"action":"CreateDuct","title":"新风支管11 (0.3,-6.81)→(0.3,-9.4) 300×250mm z=2.4m","params":{"waypoints":[{"x":0.3,"y":-6.814,"z":2.4},{"x":0.3,"y":-9.4,"z":2.4}],"width":0.3,"height":0.25},"riskLevel":"create-element"},{"action":"CreateCableCarrier","title":"电缆桥架12 (9.06,0.2)→(-1.69,0.2)→(-1.69,-7.23)→(5,-7.23)→(5,-11.12) 200×100mm z=2.1m","params":{"waypoints":[{"x":9.06,"y":0.196854438,"z":2.1},{"x":-1.693238115,"y":0.196854438,"z":2.1},{"x":-1.693238115,"y":-7.225874143,"z":2.1},{"x":5.001537618,"y":-7.225874143,"z":2.1},{"x":5.001537618,"y":-11.12,"z":2.1}],"width":0.2,"height":0.1},"riskLevel":"create-element"}];

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
    name: '示例box创建首层房间墙体',
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
    name: '示例box创建布置首层风管',
    category: 'mep',
    keywords: { zh: ['首层风管', '布置风管', '示例风管', '空调管', '暖通风管', '新风管', '送风管', '示例布置首层风管'], en: ['duct layout', 'hvac duct', 'ground floor duct', 'air duct', 'fresh air duct', 'supply duct'] },
    description: '按 AC28 文件首层已有构件参数创建 3 条新风路由（CreateDuct ×3）：贴顶标高 2.4m，矩形 600×300 / 500×300，waypoints 为实测坐标，同图层位置（MEP - 空调系统）。参数来自当前文件 GetElementsByType(MEPRoute) 读取结果。',
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
    name: '示例box创建首层双跑楼梯与平台楼板',
    category: 'building',
    keywords: {
      zh: ['示例楼梯', '示例首层楼梯', '创建楼梯', '首层楼梯', '建楼梯', '画楼梯', '示例创建首层楼梯', '楼梯楼板', '楼梯平台', '两段楼梯', '2段楼梯'],
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
      // Stable Archicad baseline readback is 3.5m for each flight.
      // Upper: x 1.093790198..4.593790198; lower: x 1.066209814..4.566209814.
      // STAIR-0 boundary: each CreateStair step uses a two-point straight baseline.
      const upperFlightWaypoints = [
        { x: 1.093790198, y: -3.47 },
        { x: 4.593790198, y: -3.47 }
      ].map(translatePoint);
      const lowerFlightWaypoints = [
        { x: 4.566209814, y: -5.02 },
        { x: 1.066209814, y: -5.02 }
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
            title: `\u{521b}\u{5efa}\u{4e0a}\u{8dd1}\u{697c}\u{68af}\u{6bb5} 10\u{6b65}\u{9ad8}1.5m\u{5bbd}1.2m\u{ff0c}baseLevel=1.5m\u{ff0c}3.5m\u{4e2d}\u{7ebf} (1.09,-3.47)->(4.59,-3.47)`,
            params: { start: upperFlightWaypoints[0], end: upperFlightWaypoints[upperFlightWaypoints.length - 1], waypoints: upperFlightWaypoints, totalHeight, baseLevel: upperFlightBaseLevel, stepNum, flightWidth, floorIndex, dryRun: true, confirmRequired: true },
            riskLevel: 'create-element'
          },
          {
            action: 'CreateStair',
            title: `\u{521b}\u{5efa}\u{4e0b}\u{8dd1}\u{697c}\u{68af}\u{6bb5} 10\u{6b65}\u{9ad8}1.5m\u{5bbd}1.2m\u{ff0c}baseLevel=0m\u{ff0c}3.5m\u{4e2d}\u{7ebf} (4.57,-5.02)->(1.07,-5.02)`,
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
  },
  {
    id: 'TPL-013',
    name: '示例box复制楼梯与平台楼板到2/3层',
    category: 'building',
    keywords: {
      zh: ['复制楼梯', '多楼层楼梯', '2层楼梯', '3层楼梯', '复制首层楼梯', '楼梯复制到二层三层', '二层三层楼梯', '复制楼梯到2层3层'],
      en: ['copy stair', 'multi-floor stair', 'stair on floor 2 and 3', 'replicate stair to floors', 'copy stair to upper floors']
    },
    description: '把首层双跑楼梯+平台楼板（TPL-003 参数）复制到楼层序号2和3（floorIndex=1,2，即第2、3层）。同图位置，相对楼层高度不变：平台 level=1.5m、下跑 baseLevel=0m、上跑 baseLevel=1.5m。共 6 步（每层 1 平台楼板 + 2 楼梯段）。targetFloors 可参数化。',
    generate: (params = {}) => {
      const offsetX = params.offsetX || 0;
      const offsetY = params.offsetY || 0;
      const stepNum = params.stepNum || 10;
      const totalHeight = params.totalHeight || 1.5;
      const flightWidth = params.flightWidth || 1.2;
      const targetFloors = Array.isArray(params.targetFloors) && params.targetFloors.length > 0 ? params.targetFloors : [1, 2];

      const translatePoint = (pt) => ({ x: pt.x + offsetX, y: pt.y + offsetY });
      const landingPolygon = [
        { x: -0.4, y: -5.62 },
        { x: 1.1, y: -5.62 },
        { x: 1.1, y: -2.87 },
        { x: -0.4, y: -2.87 }
      ].map(translatePoint);
      // STAIR-0 boundary: two separate straight flights, never a multi-vertex stair baseline.
      const upperFlightWaypoints = [
        { x: 1.093790198, y: -3.47 },
        { x: 4.593790198, y: -3.47 }
      ].map(translatePoint);
      const lowerFlightWaypoints = [
        { x: 4.566209814, y: -5.02 },
        { x: 1.066209814, y: -5.02 }
      ].map(translatePoint);

      const steps = [];
      for (const floorIndex of targetFloors) {
        const floorLabel = `楼层${floorIndex + 1}`;
        steps.push({
          action: 'CreateSlab',
          title: `${floorLabel} 楼梯平台楼板 level=1.5m 厚0.24m 范围1.5×2.75m`,
          params: { polygon: landingPolygon, thickness: 0.24, level: 1.5, floorIndex, dryRun: true, confirmRequired: true },
          riskLevel: 'create-element'
        });
        steps.push({
          action: 'CreateStair',
          title: `${floorLabel} 上跑楼梯段 10步高1.5m宽1.2m baseLevel=1.5m`,
          params: { start: upperFlightWaypoints[0], end: upperFlightWaypoints[upperFlightWaypoints.length - 1], waypoints: upperFlightWaypoints, totalHeight, baseLevel: 1.5, stepNum, flightWidth, floorIndex, dryRun: true, confirmRequired: true },
          riskLevel: 'create-element'
        });
        steps.push({
          action: 'CreateStair',
          title: `${floorLabel} 下跑楼梯段 10步高1.5m宽1.2m baseLevel=0m`,
          params: { start: lowerFlightWaypoints[0], end: lowerFlightWaypoints[lowerFlightWaypoints.length - 1], waypoints: lowerFlightWaypoints, totalHeight, baseLevel: 0.0, stepNum, flightWidth, floorIndex, dryRun: true, confirmRequired: true },
          riskLevel: 'create-element'
        });
      }

      return {
        userIntent: `复制首层楼梯与平台楼板到楼层序号2和3（floorIndex=${targetFloors.join(',')}），共 ${steps.length} 步`,
        steps
      };
    }
  },
  {
    id: 'TPL-014',
    name: '示例box在第2/3层创建外墙与楼板',
    category: 'building',
    keywords: {
      zh: ['创建墙楼板到2层3层', '创建首层到2层3层', '创建墙和楼板', '创建首层墙', '创建外围墙到2层3层', '创建外墙到二层三层', '把首层创建到2层3层', '把首层创建到二层三层', '复制墙楼板', '复制首层到2层3层', '复制外围墙到2层3层'],
      en: ['create shell on floors', 'create walls and slab on floors', 'create ground floor on upper floors', 'create shell to floor 2 and 3', 'replicate shell to floors', 'copy walls and slab to floors']
    },
    description: '按「该层墙 → 该层楼板」从低到高在第 2/3 层创建 8 面外墙 + 12 块楼板（共 20 步）。外墙厚 0.3m（第 2 层高 3.0m、第 3 层高 4.0m）；楼板厚 0.3m，轮廓取自当前模型实测（二层 4 块、三层 8 块，含三层高位/屋面标高那组 4 块），参考面 level 已按「顶面相对楼层标高」修正（实测 0→0.10、3→3.10）。每步自包含坐标，不依赖 GUID，跨项目可用。',
    generate: (params = {}) => {
      const targetFloors = Array.isArray(params.targetFloors) && params.targetFloors.length > 0 ? params.targetFloors : [1, 2];

      // 外墙（实测参照线；厚度全 0.3m）：方向标签用于标题
      const walls = [
        { id: 'south', label: '南墙', start: { x: -5.99, y: -11.37 }, end: { x: 9.31, y: -11.37 } },
        { id: 'north', label: '北墙', start: { x: -5.99, y: 2.93 }, end: { x: 9.31, y: 2.93 } },
        { id: 'west', label: '西墙', start: { x: -5.99, y: -11.37 }, end: { x: -5.99, y: 2.93 } },
        { id: 'east', label: '东墙', start: { x: 9.31, y: -11.37 }, end: { x: 9.31, y: 2.93 } }
      ];
      const wallThickness = 0.3;
      const slabThickness = 0.3;

      // 楼板平面轮廓：实测 4 块拼成整层（南 / 西 / 东 / 东南补块）
      // 坐标保留毫米精度：4.594 不可写成 4.59（差 4mm）
      const SLAB_PLANES = [
        [{ x: -6.14, y: -11.52 }, { x: 9.46, y: -11.52 }, { x: 9.46, y: -5.72 }, { x: -6.14, y: -5.72 }],
        [{ x: -6.14, y: -5.72 }, { x: -0.5, y: -5.72 }, { x: -0.5, y: 3.08 }, { x: -6.14, y: 3.08 }],
        [{ x: -0.5, y: -3.02 }, { x: 9.46, y: -3.02 }, { x: 9.46, y: 3.08 }, { x: -0.5, y: 3.08 }],
        [{ x: 4.594, y: -5.72 }, { x: 9.46, y: -5.72 }, { x: 9.46, y: -3.02 }, { x: 4.594, y: -3.02 }]
      ];
      const planes = (level) => SLAB_PLANES.map((polygon) => ({ level, polygon }));

      // 各层实测数据：第 2 层（floorIndex=1）墙高 3.0m + 楼面标高 4 块；
      //               第 3 层（floorIndex=2）墙高 4.0m + 楼面标高 4 块 + 屋面/高位标高 4 块
      // CreateSlab 的 level 落在板顶面，故写「顶面相对楼层标高」（0.10 / 3.10），不是元素里的 0 / 3。
      const FLOOR_SPEC = {
        1: { wallHeight: 3, slabs: planes(0.1) },
        2: { wallHeight: 4, slabs: [...planes(0.1), ...planes(3.1)] }
      };
      // 其它楼层（调用方显式指定时）回落到通用规格：墙高 3m + 楼面标高 4 块
      const fallbackSpec = { wallHeight: 3, slabs: planes(0.1) };

      const steps = [];
      for (const floorIndex of targetFloors) {
        const spec = FLOOR_SPEC[floorIndex] || fallbackSpec;
        const floorLabel = `第 ${floorIndex + 1} 层`;
        for (const w of walls) {
          steps.push({
            action: 'CreateWall',
            title: `${floorLabel} ${w.label} (${w.start.x},${w.start.y})→(${w.end.x},${w.end.y}) h=${spec.wallHeight}m`,
            params: {
              start: w.start,
              end: w.end,
              thickness: wallThickness,
              height: spec.wallHeight,
              floorIndex,
              dryRun: false,
              confirmRequired: true
            },
            riskLevel: 'low-mutation'
          });
        }
        spec.slabs.forEach((slab, index) => {
          steps.push({
            action: 'CreateSlab',
            title: `${floorLabel} 楼板 ${index + 1}/${spec.slabs.length} 厚${slabThickness}m level=${slab.level}m（参考面=板顶面，相对楼层）`,
            params: {
              polygon: slab.polygon,
              thickness: slabThickness,
              level: slab.level,
              floorIndex,
              dryRun: false,
              confirmRequired: true
            },
            riskLevel: 'low-mutation'
          });
        });
      }

      return {
        userIntent: `在第 ${targetFloors.map(i => i + 1).join(' 和 ')} 层按「墙 → 楼板」从低到高创建外墙与楼板（floorIndex=${targetFloors.join(',')}），共 ${steps.length} 步`,
        steps
      };
    }
  },
  {
    id: 'TPL-015',
    name: '带高程网面地形',
    category: 'building',
    keywords: {
      zh: ['创建网面', '网面地形', '带高程网面', '地形网面'],
      en: ['create mesh', 'terrain mesh', 'elevated mesh', 'mesh terrain']
    },
    description: '使用二维边界点和逐顶点相对高程预览创建 Archicad Mesh。源码与离线契约已完成，待 AC28/AC29 APX 重编及实机验证。',
    generate: (params = {}) => ({
      userIntent: '预览创建带逐顶点高程的网面地形',
      steps: [{
        action: 'CreateMesh',
        title: '预览带高程网面地形',
        params: {
          polygon: params.polygon || {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 8 },
              { x: 0, y: 8 }
            ],
            heights: [0, 1.2, 0.8, 0]
          },
          level: params.level ?? 0,
          floorIndex: params.floorIndex ?? 0,
          dryRun: true,
          confirmRequired: false
        },
        riskLevel: 'create-element'
      }]
    })
  },
  {
    id: 'TPL-016',
    name: '挤出变形体',
    category: 'building',
    keywords: {
      zh: ['创建变形体', '挤出变形体', '多边形挤出', '创建morph'],
      en: ['create morph', 'extruded morph', 'extrude polygon', 'solid morph']
    },
    description: '将简单二维多边形垂直挤出为 Solid Morph。源码与离线契约已完成，待 AC28/AC29 APX 重编及实机验证。',
    generate: (params = {}) => ({
      userIntent: '预览创建二维多边形挤出变形体',
      steps: [{
        action: 'CreateMorph',
        title: '预览挤出变形体',
        params: {
          polygon: params.polygon || [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 3 },
            { x: 0, y: 3 }
          ],
          baseLevel: params.baseLevel ?? 0,
          extrudeHeight: params.extrudeHeight ?? 2.5,
          floorIndex: params.floorIndex ?? 0,
          dryRun: true,
          confirmRequired: false
        },
        riskLevel: 'create-element'
      }]
    })
  },
  {
    id: 'TPL-017',
    name: '按收藏夹预览创建墙体',
    category: 'building',
    keywords: {
      zh: ['按收藏夹建墙', '收藏夹创建墙', '使用收藏夹建墙', '按收藏夹创建墙体'],
      en: ['create wall from favorite', 'wall from favorite', 'place wall favorite', 'favorite wall']
    },
    description: '先读取并核对墙体收藏夹，再以 dry-run 预览 CreateFromFavorite。收藏夹名称来自用户参数或语义索引，不在模板中硬编码。',
    generate: (params = {}) => {
      const favoriteName = typeof params.favoriteName === 'string' && params.favoriteName.trim() ? params.favoriteName.trim() : undefined;
      const selector = favoriteName ? { favoriteName } : {};
      return {
        userIntent: '读取墙体收藏夹并预览按收藏夹创建墙体',
        inputRequirements: { favoriteName: '必须选择 elementType=Wall 的收藏夹；缺失或多候选时不得继续写入。' },
        steps: [
          {
            action: 'GetFavorite', title: '读取并核对墙体收藏夹', params: selector,
            descriptorName: 'mepbridge.get_favorite', commandNamespace: 'MEPBridge', commandName: 'GetFavorite',
            requiredInputs: ['favoriteName'], expectedElementType: 'Wall', riskLevel: 'read'
          },
          {
            action: 'CreateFromFavorite', title: '预览按收藏夹创建墙体',
            params: { ...selector, start: params.start || { x: 0, y: 0 }, end: params.end || { x: 6, y: 0 }, floorIndex: params.floorIndex ?? 0, dryRun: true, confirmRequired: false },
            descriptorName: 'mepbridge.create_from_favorite', commandNamespace: 'MEPBridge', commandName: 'CreateFromFavorite',
            requiredInputs: ['favoriteName'], expectedElementType: 'Wall', riskLevel: 'write'
          }
        ]
      };
    }
  },
  {
    id: 'TPL-018',
    name: '按截面预览创建梁柱',
    category: 'building',
    keywords: {
      zh: ['按截面建梁', '按截面建柱', '截面创建梁柱', '使用复合截面创建梁', '使用复合截面创建柱'],
      en: ['create beam from profile', 'create column from profile', 'profile beam and column', 'complex profile beam', 'complex profile column']
    },
    description: '先读取截面管理器，再用当前项目唯一解析的 profileGuid 预览创建梁和柱；不硬编码截面 GUID 或 index。',
    generate: (params = {}) => {
      const selector = typeof params.profileGuid === 'string' && params.profileGuid.trim() ? { profileGuid: params.profileGuid.trim() } : {};
      return {
        userIntent: '读取复合截面并预览按截面创建梁柱',
        inputRequirements: { profileGuid: '必须从 GetProfiles 或语义索引中唯一解析；缺失或多候选时不得继续写入。' },
        steps: [
          {
            action: 'GetProfiles', title: '读取可用复合截面', params: {},
            descriptorName: 'mepbridge.get_profiles', commandNamespace: 'MEPBridge', commandName: 'GetProfiles', riskLevel: 'read'
          },
          {
            action: 'CreateBeam', title: '预览按截面创建梁',
            params: { start: params.beamStart || { x: 0, y: 0 }, end: params.beamEnd || { x: 6, y: 0 }, ...selector, dryRun: true, confirmRequired: false },
            descriptorName: 'mepbridge.create_beam', commandNamespace: 'MEPBridge', commandName: 'CreateBeam',
            requiredInputs: ['profileGuid'], riskLevel: 'create-element'
          },
          {
            action: 'CreateColumn', title: '预览按截面创建柱',
            params: { position: params.columnPosition || { x: 0, y: 3 }, height: params.columnHeight ?? 3, floorIndex: params.floorIndex ?? 0, ...selector, dryRun: true, confirmRequired: false },
            descriptorName: 'mepbridge.create_column', commandNamespace: 'MEPBridge', commandName: 'CreateColumn',
            requiredInputs: ['profileGuid'], riskLevel: 'create-element'
          }
        ]
      };
    }
  },
  {
    id: 'TPL-019',
    name: '批量预览设置图层',
    category: 'modify',
    keywords: {
      zh: ['批量设置图层模板', '批量预览设置图层', '选中构件批量改图层', '批量设置图层'],
      en: ['batch set layer template', 'preview batch layer change', 'change selected elements layer']
    },
    description: '先读取选择集和项目图层，再以 dry-run 预览批量设置图层。元素 GUID 与目标图层必须来自当前项目上下文。',
    generate: (params = {}) => {
      const elementGuids = Array.isArray(params.elementGuids) ? params.elementGuids.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()) : [];
      const selector = typeof params.layerGuid === 'string' && params.layerGuid.trim()
        ? { layerGuid: params.layerGuid.trim() }
        : (typeof params.layerName === 'string' && params.layerName.trim() ? { layerName: params.layerName.trim() } : {});
      return {
        userIntent: '读取选择集与图层并预览批量设置图层',
        inputRequirements: {
          elementGuids: '必须来自当前 Archicad 选择集或用户明确提供的当前项目元素。',
          targetLayer: '必须通过 layerGuid 或 layerName 唯一解析；不得使用 layer index。'
        },
        steps: [
          {
            action: 'GetSelectedElements', title: '读取待修改的当前选择集', params: { onlyEditable: true, includeAabb: false, includeMepInfo: false },
            descriptorName: 'mepbridge.get_selected_element_details', commandNamespace: 'MEPBridge', commandName: 'GetSelectedElements', riskLevel: 'read'
          },
          {
            action: 'GetLayers', title: '读取项目图层', params: {},
            descriptorName: 'mepbridge.get_layers', commandNamespace: 'MEPBridge', commandName: 'GetLayers', riskLevel: 'read'
          },
          {
            action: 'SetLayerBatch', title: '预览批量设置图层', params: { elementGuids, ...selector, dryRun: true, confirmRequired: false },
            descriptorName: 'mepbridge.set_layer_batch', commandNamespace: 'MEPBridge', commandName: 'SetLayerBatch',
            requiredInputs: ['elementGuids', 'layerGuid|layerName'], riskLevel: 'write'
          }
        ]
      };
    }
  },
  {
    id: 'TPL-020',
    name: '预览指派分类',
    category: 'modify',
    keywords: {
      zh: ['指派分类模板', '预览指派分类', '给选中构件设置分类', '指派分类'],
      en: ['assign classification template', 'preview classification assignment', 'classify selected element']
    },
    description: '先读取选择集和分类系统/条目，再以 dry-run 预览指派分类；所有 GUID 均来自当前项目上下文。',
    generate: (params = {}) => {
      const selector = {};
      for (const key of ['elementGuid', 'systemGuid', 'assignItemGuid']) {
        if (typeof params[key] === 'string' && params[key].trim()) selector[key] = params[key].trim();
      }
      return {
        userIntent: '读取选择集与分类并预览指派分类',
        inputRequirements: {
          elementGuid: '必须来自当前 Archicad 选择集或用户明确提供的当前项目元素。',
          assignItemGuid: '必须从 GetClassifications 或语义索引中唯一解析；不得使用分类 index。'
        },
        steps: [
          {
            action: 'GetSelectedElements', title: '读取待分类的当前选择集', params: { onlyEditable: true, includeAabb: false, includeMepInfo: false },
            descriptorName: 'mepbridge.get_selected_element_details', commandNamespace: 'MEPBridge', commandName: 'GetSelectedElements', riskLevel: 'read'
          },
          {
            action: 'GetClassifications', title: '读取分类系统与根条目', params: { includeRootItems: true },
            descriptorName: 'mepbridge.get_classifications', commandNamespace: 'MEPBridge', commandName: 'GetClassifications', riskLevel: 'read'
          },
          {
            action: 'AssignClassification', title: '预览指派分类',
            params: { ...selector, replaceExisting: params.replaceExisting !== false, dryRun: true, confirmRequired: false },
            descriptorName: 'mepbridge.assign_classification', commandNamespace: 'MEPBridge', commandName: 'AssignClassification',
            requiredInputs: ['elementGuid', 'assignItemGuid'], riskLevel: 'write'
          }
        ]
      };
    }
  },
  {
    id: 'TPL-021',
    name: '示例创建box结构机电建筑',
    category: 'building',
    keywords: {
      zh: ['示例创建box结构机电建筑', '创建box结构机电建筑', 'box结构机电建筑', '结构机电建筑', '整体示例建筑', 'box整体示例', '创建整体示例'],
      en: ['sample box structural mep building', 'build complete box sample', 'structural mep building sample', 'box structural mep building']
    },
    description: '组合示例：先完成全部主体（柱梁 60：层0→屋面 + 楼梯 9：首层3+2/3层6），再逐层「墙 → 机电 → 楼板」（首层 墙19+机电12；二层 墙4+机电12+楼板4；三层 墙4+机电12+楼板8），共 144 步。二层/三层机电为首层实测管线上移 3.0m/6.0m 重复创建（层高 3.0m），每层机电插在该层楼板之前。各子块为已实测的示例box配方。',
    generate: (params = {}) => {
      const byId = (id) => BUILTIN_TEMPLATES.find((t) => t.id === id);
      const take = (id, genParams) => {
        const tpl = byId(id);
        if (!tpl || typeof tpl.generate !== 'function') throw new Error('composite sub-template missing: ' + id);
        const plan = tpl.generate({ ...(params || {}), ...(genParams || {}) });
        return Array.isArray(plan.steps) ? plan.steps : [];
      };

      // 冻结结构柱梁按楼层分组（柱→梁；层0 仅柱 12，层1/2 柱12+梁8，层3 屋面仅梁 8）
      const structFor = (floorIndex) => BOX_STRUCT_STEPS
        .filter((s) => s.params.floorIndex === floorIndex)
        .map((s) => ({ ...s, params: { ...s.params }, commandNamespace: 'MEPBridge', commandName: s.action }));

      // 首层机电（12：风管11 + 桥架1，实测 z）。二层/三层 = 同形复制、标高整体上移
      // 层高 3.0m（实测：层1顶 3.0 / 层2顶 6.0 / 屋面顶 9.0），waypoints z 为绝对模型坐标。
      const mepFor = (floorIndex) => {
        const floorLabel = ['首层', '二层', '三层'][floorIndex];
        const rise = floorIndex * 3.0;
        return BOX_MEP_STEPS.map((s) => ({
          ...s,
          title: `${floorLabel} ${s.title}`.replace(/z=([\d.]+)m/, (_, z) => `z=${(Number(z) + rise).toFixed(1)}m`),
          params: {
            ...s.params,
            waypoints: s.params.waypoints.map((pt) => ({ ...pt, z: Number((pt.z + rise).toFixed(3)) }))
          },
          commandNamespace: 'MEPBridge',
          commandName: s.action
        }));
      };

      const stairSteps = take('TPL-003');     // 首层楼梯 3（含平台楼板，随楼梯块走）
      const stairCopySteps = take('TPL-013'); // 2/3层楼梯 6
      const stairCopyFor = (floorIndex) => stairCopySteps.filter((s) => s.params.floorIndex === floorIndex);
      const wallSteps = take('TPL-001');      // 首层墙体 19
      const shellSteps = take('TPL-014');     // 2/3层墙+楼板 20
      const shellFor = (floorIndex, action) => shellSteps
        .filter((s) => s.params.floorIndex === floorIndex && s.action === action);

      // 主体先行（层0→屋面层）：柱梁 → 楼梯（首层 + 2/3层复制），共 69 步
      // 再逐层「墙 → 机电 → 楼板」（机电插在每层楼板之前），共 75 步
      const steps = [
        // —— 主体柱梁楼梯 ——
        ...structFor(0),            // 首层柱 12
        ...stairSteps,              // 首层楼梯 3
        ...structFor(1),            // 二层柱梁 20
        ...stairCopyFor(1),         // 二层楼梯 3
        ...structFor(2),            // 三层柱梁 20
        ...stairCopyFor(2),         // 三层楼梯 3
        ...structFor(3),            // 屋面梁 8
        // —— 逐层：墙 → 机电 → 楼板 ——
        ...wallSteps, ...mepFor(0),                                       // 首层：墙19 + 机电12
        ...shellFor(1, 'CreateWall'), ...mepFor(1), ...shellFor(1, 'CreateSlab'), // 二层：墙4 + 机电12 + 楼板4
        ...shellFor(2, 'CreateWall'), ...mepFor(2), ...shellFor(2, 'CreateSlab')  // 三层：墙4 + 机电12 + 楼板8
      ];
      return {
        userIntent: '示例创建box结构机电建筑（主体柱梁楼梯先行 → 逐层 墙→机电→楼板，共 144 步）',
        steps
      };
    }
  }

];

const ENGLISH_TEMPLATE_METADATA = {
  'TPL-001': {
    name: 'Sample box: ground-floor room walls',
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
    name: 'Sample box: ground-floor duct layout',
    description: 'Creates three measured fresh-air duct routes on the ground floor.',
    userIntent: 'Lay out three sample ground-floor fresh-air duct routes',
    stepLabels: [
      'Fresh-air duct 1 - south route',
      'Fresh-air duct 2 - west route',
      'Fresh-air duct 3 - north route',
    ],
  },
  'TPL-003': {
    name: 'Sample box: ground-floor stair with landing slab',
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
  'TPL-013': {
    name: 'Sample box: copy stair and landing to floors 2/3',
    description: 'Copies the two-flight stair and landing slab (TPL-003 parameters) to floor index 1 and 2 (the 2nd and 3rd stories). Same plan position; relative-to-story heights are preserved (landing level=1.5m, lower flight baseLevel=0m, upper flight baseLevel=1.5m).',
    userIntent: 'Replicate the ground-floor stair and landing slab to floors 2 and 3',
    stepLabels: [
      'Floor 2 landing slab',
      'Floor 2 upper stair flight',
      'Floor 2 lower stair flight',
      'Floor 3 landing slab',
      'Floor 3 upper stair flight',
      'Floor 3 lower stair flight',
    ],
  },
  'TPL-014': {
    name: 'Sample box: exterior walls and slabs on floors 2/3',
    description: 'Creates 8 outer walls + 12 slabs bottom-up on floors 2 and 3 (20 steps, "walls of the floor, then slabs of the floor"). Wall thickness 0.3m (floor 2 height 3.0m, floor 3 height 4.0m); slab thickness 0.3m with outlines measured from the current model (4 slabs on floor 2, 8 on floor 3 including the 4 high/roof-level ones). Slab reference level is corrected to the top surface relative to the home story (0→0.10, 3→3.10). Each step is self-contained with coordinates, no GUID dependency, works across projects.',
    userIntent: 'Create outer walls and slabs on floors 2 and 3',
    stepLabels: [
      'Floor 2 south wall',
      'Floor 2 north wall',
      'Floor 2 west wall',
      'Floor 2 east wall',
      'Floor 2 slab 1/4',
      'Floor 2 slab 2/4',
      'Floor 2 slab 3/4',
      'Floor 2 slab 4/4',
      'Floor 3 south wall',
      'Floor 3 north wall',
      'Floor 3 west wall',
      'Floor 3 east wall',
      'Floor 3 slab 1/8',
      'Floor 3 slab 2/8',
      'Floor 3 slab 3/8',
      'Floor 3 slab 4/8',
      'Floor 3 slab 5/8 (high)',
      'Floor 3 slab 6/8 (high)',
      'Floor 3 slab 7/8 (high)',
      'Floor 3 slab 8/8 (high)',
    ],
  },
  'TPL-015': {
    name: 'Elevated terrain mesh',
    description: 'Previews an Archicad Mesh from a 2D boundary and per-vertex relative elevations. Source and offline contract are complete; AC28/AC29 APX rebuild and runtime verification remain pending.',
    userIntent: 'Preview an elevated terrain mesh',
    stepLabels: ['Preview elevated terrain mesh'],
  },
  'TPL-016': {
    name: 'Extruded Morph',
    description: 'Previews a simple solid Morph created by vertically extruding a 2D polygon. Source and offline contract are complete; AC28/AC29 APX rebuild and runtime verification remain pending.',
    userIntent: 'Preview an extruded solid Morph',
    stepLabels: ['Preview extruded solid Morph'],
  },
  'TPL-017': {
    name: 'Preview a wall from a Favorite',
    description: 'Reads and verifies a Wall Favorite, then previews CreateFromFavorite without hard-coded Favorite identifiers.',
    userIntent: 'Read a Wall Favorite and preview creating a wall from it',
    stepLabels: ['Read and verify the Wall Favorite', 'Preview wall creation from the Favorite'],
  },
  'TPL-018': {
    name: 'Preview profile-based beam and column',
    description: 'Reads complex profiles, then previews a beam and column using a profile GUID resolved from the current project.',
    userIntent: 'Read complex profiles and preview a profile-based beam and column',
    stepLabels: ['Read available complex profiles', 'Preview a profile-based beam', 'Preview a profile-based column'],
  },
  'TPL-019': {
    name: 'Preview batch layer assignment',
    description: 'Reads the current selection and project layers, then previews assigning a target layer to multiple elements.',
    userIntent: 'Read selected elements and layers, then preview a batch layer assignment',
    stepLabels: ['Read the editable selection', 'Read project layers', 'Preview the batch layer assignment'],
  },
  'TPL-020': {
    name: 'Preview classification assignment',
    description: 'Reads the current selection and project classifications, then previews assigning a classification item.',
    userIntent: 'Read selected elements and classifications, then preview classification assignment',
    stepLabels: ['Read the editable selection', 'Read classification systems and root items', 'Preview classification assignment'],
  },
  'TPL-021': {
    name: 'Sample box: full structural and MEP building',
    description: 'Composite sample in 144 steps: complete all primary structure first (columns/beams across all stories plus stairs), then per story walls -> MEP routes -> slabs (MEP always before the slabs). Floors 2/3 repeat the measured ground-floor MEP routes shifted up by 3.0m/6.0m.',
    userIntent: 'Create the complete sample box building (primary structure first, then per story walls, MEP before slabs)',
  }
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

  if (templateId === 'TPL-014') {
    if (step.action === 'CreateWall') {
      return `${label}: ${formatPoint(step.params?.start)} -> ${formatPoint(step.params?.end)}, ` +
        `thickness=${formatNumber(step.params?.thickness)}m, height=${formatNumber(step.params?.height)}m, floorIndex=${step.params?.floorIndex}`;
    }
    if (step.action === 'CreateSlab') {
      return `${label}: level=${formatNumber(step.params?.level)}m, ` +
        `thickness=${formatNumber(step.params?.thickness)}m, floorIndex=${step.params?.floorIndex}`;
    }
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
    let bestMatch = null;
    let bestKeywordLength = -1;
    for (const tpl of this.templates) {
      const allKeywords = [
        ...(tpl.keywords?.zh || []),
        ...(tpl.keywords?.en || [])
      ];
      for (const kw of allKeywords) {
        const normalizedKeyword = String(kw).toLowerCase();
        if (lower.includes(normalizedKeyword) && normalizedKeyword.length > bestKeywordLength) {
          bestMatch = tpl;
          bestKeywordLength = normalizedKeyword.length;
        }
      }
    }
    return bestMatch;
  }

  /**
   * 快速生成计划（命中模板时）
   * @returns {Object|null} { userIntent, steps } 或 null
   */
  tryGenerate(text, context = {}) {
    const tpl = this.match(text);
    if (!tpl) return null;
    return this._generateFromTemplate(tpl, text, context);
  }

  /**
   * 按模板 id 直接生成计划（如「TPL-014」这类编号引用）。
   * 与 tryGenerate 的区别：不经过关键词匹配 —— 用户明确给出的编号优先于任何文本猜测。
   */
  generateById(templateId, text = '', context = {}) {
    if (!templateId) return null;
    const wanted = String(templateId).trim().toUpperCase();
    const tpl = this.templates.find((t) => t && String(t.id).toUpperCase() === wanted);
    if (!tpl) return null;
    return this._generateFromTemplate(tpl, text, context);
  }

  _generateFromTemplate(tpl, text, context = {}) {
    try {
      // 从原文提取参数，再让显式传入的 templateParams 覆盖。
      //
      // 此前这里只读 `context.templateParams`，而全仓无任何调用方填充过该字段，
      // 于是 TPL-011「移动选中」恒生成 `deltaMm: {x:0,y:0,z:0}`，送到 Add-On
      // 必然被 `ZERO_DELTA` 拒绝——用户说的「向右移动 500mm」被整句丢弃。
      // 模板匹配优先于 descriptor 匹配（copilot-message.js 的顺序），
      // 所以这条路径不提参数就等于变换类命令永远拿不到参数。
      //
      // 提取器与 descriptor 路径共用 `nl-param-extractors.js`，避免两条路径
      // 对同一句话给出不同参数——那种不一致比参数缺失更难排查。
      const extracted = extractTemplateParams(text);
      const params = { ...extracted, ...(context.templateParams || {}) };
      const locale = normalizeUiLocale(context.locale || context.language);
      const plan = localizeGeneratedPlan(tpl, tpl.generate(params), locale);
      if (plan && plan.steps && plan.steps.length > 0) {
        const requiresStepRefinement = plan.requiresStepRefinement === true ||
          Boolean(plan.inputRequirements && Object.keys(plan.inputRequirements).length > 0);
        console.log(`[TaskTemplates] Template matched: ${tpl.id} (${tpl.name}), generated ${plan.steps.length} steps, extractedParams=${JSON.stringify(Object.keys(extracted))}`);
        return {
          ...plan,
          source: 'builtin-template',
          templateId: tpl.id,
          extractedParams: extracted,
          deterministic: !requiresStepRefinement,
          requiresStepRefinement
        };
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
      // 出厂编号（SYS-0NN）：面板「出厂模板」分组展示 + 聊天按编号直达用
      code: String(t.id || '').toUpperCase().startsWith('TPL-') ? 'SYS-' + String(t.id).slice(4) : null,
      name: normalizedLocale === 'en-US'
        ? (ENGLISH_TEMPLATE_METADATA[t.id]?.name || t.name)
        : t.name,
      category: t.category,
      description: normalizedLocale === 'en-US'
        ? (ENGLISH_TEMPLATE_METADATA[t.id]?.description || t.description || '')
        : (t.description || ''),
      // 需要用户先提供输入项（收藏夹 / 截面 / 选择集等）：面板据此提示"建议用聊天触发"
      needsInput: this._needsUserInput(t),
    }));
  }

  /** 模板是否需要额外输入项（只看 generate 返回的 inputRequirements，不调用 LLM） */
  _needsUserInput(template) {
    try {
      const plan = template.generate ? template.generate({}) : null;
      return Boolean(plan && plan.inputRequirements && Object.keys(plan.inputRequirements).length > 0);
    } catch (error) {
      return false;
    }
  }
}

module.exports = new TaskTemplateRegistry();

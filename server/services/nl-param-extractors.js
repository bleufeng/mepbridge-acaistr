// nl-param-extractors.js
// 自然语言参数提取器（共享模块）
//
// 为什么单列一个模块：这些函数原本只存在于 `ai-adapter.js` 内部，descriptor 匹配路径
// （`buildPlanFromDescriptor`）会调用它们，而**任务模板路径完全没有调用**——
// `task-templates.js:tryGenerate` 读 `context.templateParams`，但全仓无任何调用方
// 填充过该字段，于是 TPL-011「移动选中」恒生成 `deltaMm: {x:0,y:0,z:0}`，
// 送到 Add-On 必然被 `ZERO_DELTA` 拒绝。模板匹配优先于 descriptor 匹配，
// 所以「向右移动 500mm」这类请求永远丢失参数。
//
// 抽成共享模块而非在 task-templates 里复制一份，是因为提取规则一旦分叉，
// 两条路径就会对同一句话给出不同参数 —— 那种不一致比缺失更难排查。
//
// 2026-08-31 提取自 ai-adapter.js（逻辑保持不变，仅移动位置）。

'use strict';

// 从自然语言提取管道直径（mm）
// 支持 "100mm"、"100毫米"、"直径100"、"DN100"、"100mm水管" 等
function extractDiameterMm(text) {
  const dnMatch = text.match(/DN\s*(\d+(?:\.\d+)?)/i);
  if (dnMatch) return parseFloat(dnMatch[1]);

  const diaMatch = text.match(/(?:直径|diameter)\s*(\d+(?:\.\d+)?)\s*(mm|毫米)?/i);
  if (diaMatch) return parseFloat(diaMatch[1]);

  const mmMatch = text.match(/(\d+(?:\.\d+)?)\s*(mm|毫米)\s*(?:水管|管道|管|pipe|tube)?/i);
  if (mmMatch) return parseFloat(mmMatch[1]);

  return null;
}

// 从自然语言提取 Archicad 构件类型（用于 GetElementsByType）
function extractElementType(text) {
  const lowerText = text.toLowerCase();

  const typeMap = [
    { type: 'Wall', zh: ['墙', '墙体', '墙构件'] },
    { type: 'Column', zh: ['柱', '柱子', '柱构件'] },
    { type: 'Beam', zh: ['梁', '梁构件'] },
    { type: 'Slab', zh: ['板', '楼板', '板构件'] },
    { type: 'Roof', zh: ['屋顶', '屋面'] },
    { type: 'Window', zh: ['窗', '窗户'] },
    { type: 'Door', zh: ['门'] },
    { type: 'Object', zh: ['对象', '物件', '家具'] },
    { type: 'Lamp', zh: ['灯', '灯具'] },
    { type: 'Mesh', zh: ['网格', '地形'] },
    { type: 'Zone', zh: ['区域', '房间'] },
    { type: 'CurtainWall', zh: ['幕墙'] },
    { type: 'Shell', zh: ['壳体'] },
    { type: 'Skylight', zh: ['天窗'] }
  ];

  const enMap = [
    { type: 'Wall', en: ['wall', 'walls'] },
    { type: 'Column', en: ['column', 'columns'] },
    { type: 'Beam', en: ['beam', 'beams'] },
    { type: 'Slab', en: ['slab', 'slabs'] },
    { type: 'Roof', en: ['roof', 'roofs'] },
    { type: 'Window', en: ['window', 'windows'] },
    { type: 'Door', en: ['door', 'doors'] },
    { type: 'Object', en: ['object', 'objects'] },
    { type: 'Lamp', en: ['lamp', 'lamps'] },
    { type: 'Mesh', en: ['mesh', 'meshes'] },
    { type: 'Zone', en: ['zone', 'zones'] },
    { type: 'CurtainWall', en: ['curtainwall', 'curtain wall'] },
    { type: 'Shell', en: ['shell', 'shells'] },
    { type: 'Skylight', en: ['skylight', 'skylights'] }
  ];

  for (const item of typeMap) {
    for (const zh of item.zh) {
      if (text.includes(zh)) return item.type;
    }
  }

  for (const item of enMap) {
    for (const en of item.en) {
      const regex = new RegExp(`\\b${en}\\b`, 'i');
      if (regex.test(lowerText)) return item.type;
    }
  }

  return null;
}

// 从自然语言提取管道路径点
// 支持 "从(0,0,3)到(5,0,3)"、"起点(0,0,3) 终点(5,0,3)"
function extractWaypoints(text) {
  const fromToMatch = text.match(/从\s*[[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?\s*到\s*[[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?/);
  if (fromToMatch) {
    return {
      waypoints: [
        { x: parseFloat(fromToMatch[1]), y: parseFloat(fromToMatch[2]), z: parseFloat(fromToMatch[3]) },
        { x: parseFloat(fromToMatch[4]), y: parseFloat(fromToMatch[5]), z: parseFloat(fromToMatch[6]) }
      ],
      start: { x: parseFloat(fromToMatch[1]), y: parseFloat(fromToMatch[2]), z: parseFloat(fromToMatch[3]) },
      end: { x: parseFloat(fromToMatch[4]), y: parseFloat(fromToMatch[5]), z: parseFloat(fromToMatch[6]) }
    };
  }

  const startEndMatch = text.match(/起点\s*[[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?\s*终点\s*[[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?/);
  if (startEndMatch) {
    return {
      waypoints: [
        { x: parseFloat(startEndMatch[1]), y: parseFloat(startEndMatch[2]), z: parseFloat(startEndMatch[3]) },
        { x: parseFloat(startEndMatch[4]), y: parseFloat(startEndMatch[5]), z: parseFloat(startEndMatch[6]) }
      ],
      start: { x: parseFloat(startEndMatch[1]), y: parseFloat(startEndMatch[2]), z: parseFloat(startEndMatch[3]) },
      end: { x: parseFloat(startEndMatch[4]), y: parseFloat(startEndMatch[5]), z: parseFloat(startEndMatch[6]) }
    };
  }

  return null;
}

// 从自然语言提取位移（mm）
// 支持 "x=300,y=-200,z=100"、"z=3000"、"往上抬200"、"向右移动500mm" 等
function extractDelta(text) {
  const delta = { x: 0, y: 0, z: 0 };

  const axisPatterns = [
    { axis: 'x', regex: /x\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i },
    { axis: 'y', regex: /y\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i },
    { axis: 'z', regex: /z\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i }
  ];
  axisPatterns.forEach(({ axis, regex }) => {
    const m = text.match(regex);
    if (m) delta[axis] = parseFloat(m[1]);
  });

  const numberPattern = '(-?\\d+(?:\\.\\d+)?)';
  // 方向词表。`往` 与 `向` 都要收：ai-adapter.js 的原注释声称支持「往上抬200」，
  // 但原实现的 z 轴模式只有 `向上|上移|抬高|up`，`往上` 一直提取不出来（文档与实现不符）。
  const directionalPatterns = [
    { axis: 'x', sign: 1, words: '(?:(?:\\u5411|\\u5f80)?\\u53f3|right)' },
    { axis: 'x', sign: -1, words: '(?:(?:\\u5411|\\u5f80)?\\u5de6|left)' },
    { axis: 'y', sign: 1, words: '(?:(?:\\u5411|\\u5f80)?\\u524d|forward)' },
    { axis: 'y', sign: -1, words: '(?:(?:\\u5411|\\u5f80)?\\u540e|backward)' },
    { axis: 'z', sign: 1, words: '(?:(?:\\u5411|\\u5f80)\\u4e0a|\\u4e0a\\u79fb|\\u62ac\\u9ad8|up)' },
    { axis: 'z', sign: -1, words: '(?:(?:\\u5411|\\u5f80)\\u4e0b|\\u4e0b\\u79fb|\\u964d\\u4f4e|down)' }
  ];

  // 优先取紧邻方向词的数字，避免把楼层号当成移动距离
  if (!axisPatterns.some(({ regex }) => regex.test(text))) {
    // 方向词与数字之间常夹一个动词（"往上**抬**200"、"向右**挪**500"）。
    // 原实现只允许「移动」，所以注释里声称支持的「往上抬200」实际提取不出来。
    // 这里放宽为一小组动词，但仍要求紧邻 —— 放宽成任意字符会让
    // 「向右移动到第3层」把楼层号 3 当作位移。
    const verb = '(?:\\u79fb\\u52a8|\\u5e73\\u79fb|\\u504f\\u79fb|\\u62ac|\\u6311|\\u632a|\\u79fb|by|to|=|:)?';
    for (const pattern of directionalPatterns) {
      const afterDirection = new RegExp(`${pattern.words}\\s*${verb}\\s*${numberPattern}\\s*(?:mm|\\u6beb\\u7c73)?`, 'i');
      const beforeDirection = new RegExp(`${numberPattern}\\s*(?:mm|\\u6beb\\u7c73)?\\s*${pattern.words}`, 'i');
      const match = text.match(afterDirection) || text.match(beforeDirection);
      if (match) {
        const rawValue = parseFloat(match[1]);
        if (Number.isFinite(rawValue) && rawValue !== 0) {
          delta[pattern.axis] = pattern.sign * Math.abs(rawValue);
        }
        break;
      }
    }
  }

  return delta;
}

// 从自然语言提取目标楼层索引（0-based）
function extractTargetStoryIndex(text) {
  const normalized = String(text || '').toLowerCase();

  const words = {
    basement: -1,
    ground: 0,
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    sixth: 5,
    seventh: 6,
    eighth: 7,
    ninth: 8,
    tenth: 9
  };

  const explicitIndex = normalized.match(/(?:target\s*)?(?:story|storey|floor|level)\s*index\s*(?:=|:|to)?\s*(-?\d+)/i)
    || normalized.match(/targetStoryIndex\s*(?:=|:)\s*(-?\d+)/i)
    || normalized.match(/\u697c\u5c42\u7d22\u5f15\s*(?:=|:|\u4e3a)?\s*(-?\d+)/);
  if (explicitIndex) return Number(explicitIndex[1]);

  const storyValue = '(basement|ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|b\\d+|\\d+)';
  const contextual = normalized.match(new RegExp(`(?:story|storey|floor|level)\\s*(?:=|:|to|onto|on)?\\s*${storyValue}`, 'i'));
  const ordinalBefore = normalized.match(new RegExp(`${storyValue}(?:st|nd|rd|th)?\\s*(?:story|storey|floor|level)`, 'i'));
  const compact = normalized.match(/\b(b\d+|\d+f|f\d+)\b/i);
  const chineseMatches = Array.from(normalized.matchAll(/(?:\u7b2c\s*)?(\d+|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u9996])\s*\u5c42/g));

  let raw = null;
  if (contextual) raw = contextual[1];
  else if (ordinalBefore) raw = ordinalBefore[1];
  else if (compact) raw = compact[1];
  else if (chineseMatches.length > 0) raw = chineseMatches[chineseMatches.length - 1][1];
  if (!raw) return null;

  const chineseWords = {
    '\u9996': 0,
    '\u4e00': 0,
    '\u4e8c': 1,
    '\u4e09': 2,
    '\u56db': 3,
    '\u4e94': 4,
    '\u516d': 5,
    '\u4e03': 6,
    '\u516b': 7,
    '\u4e5d': 8,
    '\u5341': 9
  };

  if (Object.prototype.hasOwnProperty.call(words, raw)) return words[raw];
  if (Object.prototype.hasOwnProperty.call(chineseWords, raw)) return chineseWords[raw];

  const basementMatch = raw.match(/^b(\d+)$/i);
  if (basementMatch) return -Number(basementMatch[1]);

  const floorMatch = raw.match(/^(?:f)?(\d+)(?:f)?$/i);
  if (!floorMatch) return null;

  const oneBasedFloor = Number(floorMatch[1]);
  if (!Number.isFinite(oneBasedFloor)) return null;
  return Math.max(0, oneBasedFloor - 1);
}

// 从自然语言提取旋转角度（弧度）与方向
//
// Archicad 的 RotateSelectedElements 用弧度、逆时针为正。中文习惯说「顺时针转 90 度」，
// 所以必须同时解析角度值与方向，否则会转到反方向 —— 而反方向的结果同样"成功"，
// 属于静默错模型，比报错更难发现。
function extractRotationAngle(text) {
  const source = String(text || '');

  // 显式弧度优先（"1.5708 弧度" / "angle=1.5708rad"）
  const radMatch = source.match(/(-?\d+(?:\.\d+)?)\s*(?:rad|radian|弧度)/i);
  let degrees = null;
  if (radMatch) {
    const radians = parseFloat(radMatch[1]);
    if (Number.isFinite(radians) && radians !== 0) return applyRotationSign(radians, source);
  }

  const degMatch = source.match(/(-?\d+(?:\.\d+)?)\s*(?:°|度|deg|degree|degrees)/i);
  if (degMatch) degrees = parseFloat(degMatch[1]);

  if (degrees === null || !Number.isFinite(degrees) || degrees === 0) return null;
  return applyRotationSign((degrees * Math.PI) / 180, source);
}

function applyRotationSign(value, source) {
  const clockwise = /顺时针|clockwise|cw\b/i.test(source);
  const counterClockwise = /逆时针|counter\s*clockwise|counterclockwise|ccw\b/i.test(source);
  const magnitude = Math.abs(value);
  // 未说明方向时沿用原文符号；说了顺时针则取负（Archicad 逆时针为正）
  if (clockwise && !counterClockwise) return -magnitude;
  if (counterClockwise) return magnitude;
  return value;
}

/**
 * 从一句自然语言提取任务模板可能需要的全部参数。
 *
 * **只写入确实识别到的键** —— 未识别的键不出现在返回值里，使模板的
 * `params.X || 默认值` 兜底仍然生效。若在此处塞入零值/占位值，
 * 就会重演「模板恒生成 deltaMm 全零」这个 bug：调用方无法区分
 * 「用户没说」与「用户说了但没解析出来」。
 *
 * @param {string} text 用户原始输入
 * @returns {Object} 仅含识别到的参数键
 */
function extractTemplateParams(text) {
  const params = {};
  const source = String(text || '');
  if (!source.trim()) return params;

  const delta = extractDelta(source);
  const hasDelta = delta && (delta.x !== 0 || delta.y !== 0 || delta.z !== 0);
  if (hasDelta) {
    params.deltaMm = delta;
    // 复制类模板用 offsetMm 表达同一语义，一并提供以免模板各自再解析一遍
    params.offsetMm = delta;
  }

  const angle = extractRotationAngle(source);
  if (angle !== null) params.angle = angle;

  const storyIndex = extractTargetStoryIndex(source);
  if (storyIndex !== null) {
    params.targetStoryIndex = storyIndex;
    params.floorIndex = storyIndex;
  }

  // 直径与位移共用「数字 + mm」这一模式，`向右移动 500mm` 会被 extractDiameterMm
  // 误读成 diameterMm=500。位移已识别时不再猜直径 —— 传错的直径会静默改变管径，
  // 比缺参数更糟。管道类模板本身就要求显式说明「DN…」或「直径…」。
  if (!hasDelta) {
    const diameterMm = extractDiameterMm(source);
    if (diameterMm !== null) params.diameterMm = diameterMm;
  }

  const elementType = extractElementType(source);
  if (elementType !== null) params.elementType = elementType;

  const waypoints = extractWaypoints(source);
  if (waypoints) Object.assign(params, waypoints);

  return params;
}

module.exports = {
  extractDiameterMm,
  extractElementType,
  extractWaypoints,
  extractDelta,
  extractTargetStoryIndex,
  extractRotationAngle,
  extractTemplateParams
};

'use strict';

// CAD-0: read-only phase-zero recognition of Archicad layer names.
// Suggestions are deterministic rule matches only; they never mutate a project
// and low-confidence or ambiguous results must always be reviewed.

const SCHEMA_VERSION = 'cad0-1';
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
const AMBIGUITY_CONFIDENCE_THRESHOLD = 0.6;

const CATEGORY_RULES = [
  { category: 'wall', keywords: ['wall', 'walls', '墙', '墙体'], confidence: 0.98 },
  { category: 'column', keywords: ['column', 'columns', '柱', '柱子'], confidence: 0.98 },
  { category: 'beam', keywords: ['beam', 'beams', '梁'], confidence: 0.98 },
  { category: 'slab', keywords: ['slab', 'slabs', '楼板', '板'], confidence: 0.96 },
  { category: 'roof', keywords: ['roof', 'roofs', '屋顶', '屋面'], confidence: 0.98 },
  { category: 'stair', keywords: ['stair', 'stairs', 'staircase', '楼梯'], confidence: 0.98 },
  { category: 'door', keywords: ['door', 'doors', '门'], confidence: 0.98 },
  { category: 'window', keywords: ['window', 'windows', '窗', '窗户'], confidence: 0.98 },
  { category: 'curtain-wall', keywords: ['curtainwall', 'curtain wall', 'curtain-wall', '幕墙'], confidence: 0.98 },
  { category: 'railing', keywords: ['railing', 'railings', '栏杆', '扶手'], confidence: 0.98 },
  { category: 'shell', keywords: ['shell', 'shells', '壳体'], confidence: 0.97 },
  { category: 'grid', keywords: ['grid', 'grids', 'axis', 'axes', '轴网', '轴线'], confidence: 0.97 },
  { category: 'opening', keywords: ['opening', 'openings', 'hole', 'holes', '洞口', '开洞'], confidence: 0.96 },
  { category: 'dimension', keywords: ['dimension', 'dimensions', 'dim', '标注', '尺寸'], confidence: 0.97 },
  { category: 'text', keywords: ['text', 'texts', 'annotation', 'annotations', '文本', '文字', '注释'], confidence: 0.95 },
  { category: 'label', keywords: ['label', 'labels', 'tag', 'tags', '标签'], confidence: 0.94 },
  { category: 'zone', keywords: ['zone', 'zones', 'room', 'rooms', '空间', '房间', '区域'], confidence: 0.95 },
  { category: 'mep-plumbing', keywords: ['pipe', 'pipes', 'plumbing', 'water', 'drain', '给水', '排水', '水管', '喷淋'], confidence: 0.96 },
  { category: 'mep-hvac', keywords: ['duct', 'ducts', 'hvac', 'vent', 'ventilation', '空调', '通风', '风管', '新风'], confidence: 0.96 },
  { category: 'mep-electrical', keywords: ['cable', 'wiring', 'wire', 'electrical', 'lighting', '电气', '电线', '电缆', '照明', '插座'], confidence: 0.96 },
  { category: 'mep-fire', keywords: ['fire', 'sprinkler', '消防', '喷淋', '灭火'], confidence: 0.94 },
  { category: 'site', keywords: ['site', 'terrain', 'landscape', 'road', '场地', '地形', '景观', '道路'], confidence: 0.95 },
  { category: 'structure', keywords: ['structure', 'structural', 'framing', '结构', '承重'], confidence: 0.92 },
  { category: 'architecture', keywords: ['architecture', 'architectural', 'building', '建筑', '室内', '装修'], confidence: 0.9 },
  { category: 'furniture', keywords: ['furniture', 'fixture', 'fixtures', '家具', '设备'], confidence: 0.94 },
  { category: 'cad', keywords: ['cad', 'draft', 'drafting', 'drafting-aid', '二维', '制图'], confidence: 0.88 },
  { category: 'background', keywords: ['background', 'reference', 'references', '底图', '参考'], confidence: 0.88 },
  { category: 'safety', keywords: ['safety', 'protection', '防护', '安全'], confidence: 0.92 }
];

function normalizeName (name) {
  return String(name || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeToken (token) {
  return String(token || '').replace(/[_\-]+/g, '').toLowerCase();
}

function scoreRule (rule, normalizedName) {
  let best = 0;
  let matchedKeyword = null;
  for (const keyword of rule.keywords) {
    const normalizedKeyword = normalizeName(keyword);
    const tokenKeyword = normalizeToken(keyword);
    let score = 0;

    if (normalizedName === normalizedKeyword) score = 1;
    else if (normalizedName.split(' ').some((token) => normalizeToken(token) === tokenKeyword)) score = 0.95;
    else if (normalizedName.includes(` ${normalizedKeyword} `)) score = 0.85;
    else if (normalizedKeyword.length >= 2 && normalizedName.includes(normalizedKeyword)) score = normalizedKeyword.length >= 3 ? 0.8 : 0.7;
    // Single-character CJK keywords are unambiguous domain terms; a low
    // substring score would incorrectly force obvious names into review.
    else if (normalizedKeyword.length === 1 && normalizedName.includes(normalizedKeyword)) score = 0.95;

    if (score > best) {
      best = score;
      matchedKeyword = keyword;
    }
  }
  return { score: best, keyword: matchedKeyword };
}

function recognizeLayerName (name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    return {
      category: null,
      confidence: 0,
      matchedKeywords: [],
      ambiguity: null,
      ruleCount: 0
    };
  }

  const candidates = CATEGORY_RULES
    .map((rule) => ({ rule, match: scoreRule(rule, normalizedName) }))
    .filter((candidate) => candidate.match.score > 0)
    .sort((left, right) => right.match.score - left.match.score || right.rule.confidence - left.rule.confidence);

  if (candidates.length === 0) {
    return {
      category: null,
      confidence: 0,
      matchedKeywords: [],
      ambiguity: null,
      ruleCount: 0
    };
  }

  const topScore = candidates[0].match.score;
  const tied = candidates.filter((candidate) => Math.abs(candidate.match.score - topScore) < 1e-9);
  const semanticTypes = new Set([
    'wall', 'column', 'beam', 'slab', 'roof', 'stair', 'door', 'window',
    'curtain-wall', 'railing', 'shell', 'grid', 'opening', 'dimension',
    'text', 'label', 'zone'
  ]);
  const semanticWinners = tied.filter((candidate) => semanticTypes.has(candidate.rule.category));
  if (semanticWinners.length === 1) {
    const winner = semanticWinners[0];
    return {
      category: winner.rule.category,
      confidence: winner.match.score * winner.rule.confidence,
      matchedKeywords: [winner.match.keyword],
      ambiguity: tied.map((candidate) => candidate.rule.category),
      ruleCount: tied.length
    };
  }
  if (tied.length > 1) {
    return {
      category: null,
      confidence: topScore * tied[0].rule.confidence,
      matchedKeywords: tied.map((candidate) => candidate.match.keyword),
      ambiguity: tied.map((candidate) => candidate.rule.category),
      ruleCount: tied.length
    };
  }

  const winner = candidates[0];
  return {
    category: winner.rule.category,
    confidence: winner.match.score * winner.rule.confidence,
    matchedKeywords: [winner.match.keyword],
    ambiguity: null,
    ruleCount: 1
  };
}

function failure (errorType, message, detail, httpStatus = 400) {
  return { ok: false, errorType, message, detail, httpStatus };
}

function validateLayersPayload (payload) {
  if (!payload || typeof payload !== 'object') {
    return failure('INVALID_LAYERS_PAYLOAD', 'GetLayers must return an object');
  }
  if (!Array.isArray(payload.layers)) {
    return failure('INVALID_LAYERS_PAYLOAD', 'GetLayers response.layers must be an array');
  }
  for (const [index, layer] of payload.layers.entries()) {
    if (!layer || typeof layer !== 'object') {
      return failure('INVALID_LAYER', `layers[${index}] must be an object`, { index });
    }
    if (typeof layer.name !== 'string' || !layer.name.trim()) {
      return failure('INVALID_LAYER_NAME', `layers[${index}].name must be a non-empty string`, { index });
    }
    if (layer.guid !== undefined && typeof layer.guid !== 'string') {
      return failure('INVALID_LAYER_GUID', `layers[${index}].guid must be a string`, { index });
    }
    if (layer.index !== undefined && !Number.isInteger(layer.index)) {
      return failure('INVALID_LAYER_INDEX', `layers[${index}].index must be an integer`, { index });
    }
  }
  return { ok: true };
}

function summarizeCategories (layers) {
  const categories = new Map();
  for (const layer of layers) {
    const category = layer.recognition.category || 'unrecognized';
    categories.set(category, (categories.get(category) || 0) + 1);
  }
  const output = {};
  for (const category of Array.from(categories.keys()).sort()) {
    output[category] = categories.get(category);
  }
  return output;
}

function createCadLayerRecognitionService (deps = {}) {
  const getLayers = deps.getLayers;
  if (typeof getLayers !== 'function') {
    throw new Error('cad-layer-recognition requires an injectable getLayers()');
  }
  const now = deps.now || (() => Date.now());

  async function recognizeLayers (input) {
    const request = input && typeof input === 'object' ? input : {};
    if (request.layers !== undefined) {
      const hasCaptureField = request.targetPort !== undefined || request.targetProject !== undefined;
      if (hasCaptureField) {
        return failure('LAYERS_AND_TARGET_FIELDS_CONFLICT', 'Provide either layers or target fields, not both');
      }
      if (!Array.isArray(request.layers)) {
        return failure('INVALID_LAYERS_INPUT', 'request.layers must be an array');
      }
    }

    let payload;
    if (request.layers === undefined) {
      const captured = await getLayers({
        targetPort: request.targetPort,
        targetProject: request.targetProject
      });
      if (!captured || captured.ok !== true) {
        const errorType = captured && captured.errorType ? captured.errorType : 'GET_LAYERS_FAILED';
        const httpStatus = captured && captured.httpStatus ? captured.httpStatus : 502;
        return failure(errorType, `GetLayers failed: ${captured ? captured.message || errorType : 'unknown error'}`, captured && captured.detail, httpStatus);
      }
      payload = captured.layers;
    } else {
      payload = { layers: request.layers };
    }

    const validated = validateLayersPayload(payload);
    if (!validated.ok) return validated;

    const layers = payload.layers.map((layer, index) => {
      const recognition = recognizeLayerName(layer.name);
      const isAmbiguous = Array.isArray(recognition.ambiguity) && recognition.ambiguity.length > 1;
      const reviewRequired = recognition.category === null || recognition.confidence < REVIEW_CONFIDENCE_THRESHOLD;
      return {
        index: layer.index ?? index,
        guid: layer.guid,
        name: layer.name,
        conClassId: layer.conClassId,
        recognition: {
          category: recognition.category,
          confidence: Number(recognition.confidence.toFixed(4)),
          matchedKeywords: recognition.matchedKeywords,
          matchingRule: recognition.category
            ? `keyword:${recognition.matchedKeywords[0]}->${recognition.category}`
            : (isAmbiguous ? 'ambiguous-keyword-match' : 'no-keyword-match'),
          ambiguity: recognition.ambiguity,
          reviewRequired
        }
      };
    });

    const report = {
      documentType: 'mepbridge-cad-layer-recognition',
      schemaVersion: SCHEMA_VERSION,
      analyzedAt: new Date(now()).toISOString(),
      source: {
        mode: request.layers === undefined ? 'archicad-get-layers' : 'provided-layers',
        targetPort: request.targetPort ?? null,
        targetProject: request.targetProject ?? null
      },
      policy: {
        readOnly: true,
        reviewConfidenceThreshold: REVIEW_CONFIDENCE_THRESHOLD,
        ambiguityConfidenceThreshold: AMBIGUITY_CONFIDENCE_THRESHOLD,
        suggestionOnly: true
      },
      summary: {
        layerCount: layers.length,
        recognizedCount: layers.filter((layer) => layer.recognition.category !== null).length,
        reviewRequiredCount: layers.filter((layer) => layer.recognition.reviewRequired).length,
        byCategory: summarizeCategories(layers)
      },
      layers
    };

    return { ok: true, report, warnings: [] };
  }

  return { recognizeLayers };
}

module.exports = {
  createCadLayerRecognitionService,
  recognizeLayerName,
  SCHEMA_VERSION,
  REVIEW_CONFIDENCE_THRESHOLD,
  AMBIGUITY_CONFIDENCE_THRESHOLD,
  CATEGORY_RULES
};

'use strict';

const archicadClient = require('./archicad-client');

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

let cacheTTLms = DEFAULT_CACHE_TTL_MS;
let activeIndex = null;
const cacheByKey = new Map();
const inFlightByKey = new Map();

function successful(data) {
  return { success: true, data: Array.isArray(data) ? data : [] };
}

function failed(response) {
  return { success: false, error: response?.error || 'Command failed' };
}

const INDEX_BUILDERS = {
  stories: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetStories');
    if (!response.success) return failed(response);
    const stories = Array.isArray(response.data?.stories) ? response.data.stories : [];
    return successful(stories.map((story) => ({
      index: story.index ?? story.floorIndex,
      name: story.name ?? story.uName,
      level: story.level
    })));
  },

  libraries: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetLibraries');
    if (!response.success) return failed(response);
    const libraries = Array.isArray(response.data?.libraries) ? response.data.libraries : [];
    return successful(libraries.map((library) => ({
      name: library.name,
      path: library.path,
      active: library.active
    })));
  },

  mepSystems: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetAvailableSystems', { domain: 'All' });
    if (!response.success) return failed(response);
    const systems = Array.isArray(response.data?.systems) ? response.data.systems : [];
    return successful(systems.map((system) => ({
      index: system.index ?? system.mepSystemIndex,
      name: system.name ?? system.mepSystemName,
      domain: system.domain,
      isForPiping: system.isForPiping,
      isForDuctwork: system.isForDuctwork,
      isForCabling: system.isForCabling
    })));
  },

  mepSizes: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetAvailableSizes');
    if (!response.success) return failed(response);
    const referenceSets = Array.isArray(response.data?.referenceSets) ? response.data.referenceSets : [];
    return successful(referenceSets.map((referenceSet) => ({
      name: referenceSet.referenceSetName,
      referenceSetName: referenceSet.referenceSetName,
      referenceIds: Array.isArray(referenceSet.referenceIds) ? referenceSet.referenceIds : []
    })));
  },

  favorites: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetFavorites');
    if (!response.success) return failed(response);
    const favorites = Array.isArray(response.data?.favorites) ? response.data.favorites : [];
    return successful(favorites.map((favorite) => ({
      name: favorite.name,
      favoriteName: favorite.name,
      elementType: favorite.elementType,
      folder: Array.isArray(favorite.folder) ? favorite.folder : []
    })));
  },

  profiles: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetProfiles');
    if (!response.success) return failed(response);
    const profiles = Array.isArray(response.data?.profiles) ? response.data.profiles : [];
    return successful(profiles.map((profile) => ({
      index: profile.index,
      name: profile.name,
      guid: profile.guid
    })));
  },

  classifications: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetClassifications', {
      includeRootItems: true
    });
    if (!response.success) return failed(response);
    const systems = Array.isArray(response.data?.systems) ? response.data.systems : [];
    const items = [];
    for (const system of systems) {
      items.push({
        kind: 'system',
        name: system.name,
        guid: system.guid,
        systemGuid: system.guid,
        description: system.description,
        editionVersion: system.editionVersion
      });
      for (const item of Array.isArray(system.rootItems) ? system.rootItems : []) {
        items.push({
          kind: 'item',
          name: item.name || item.id,
          id: item.id,
          guid: item.guid,
          itemGuid: item.guid,
          systemGuid: system.guid,
          systemName: system.name
        });
      }
    }
    return successful(items);
  },

  layers: async () => {
    const response = await archicadClient.executeCommand('MEPBridge.GetLayers');
    if (!response.success) return failed(response);
    const layers = Array.isArray(response.data?.layers) ? response.data.layers : [];
    return successful(layers.map((layer) => ({
      index: layer.index,
      name: layer.name,
      guid: layer.guid,
      conClassId: layer.conClassId
    })));
  },

  gsmObjects: async () => ({
    success: true,
    skipped: true,
    reason: 'no real GSM enumeration command is currently available',
    data: []
  }),

  propertyDefinitions: async (options) => {
    const elementGuid = String(options?.elementGuid || '').trim();
    if (!elementGuid) {
      return {
        success: true,
        skipped: true,
        reason: 'elementGuid is required because property definitions are element-specific.',
        data: []
      };
    }

    const response = await archicadClient.executeCommand('MEPBridge.GetElementPropertyDefinitions', {
      elementGuid,
      filter: 'All'
    });
    if (!response.success) return failed(response);
    const definitions = Array.isArray(response.data?.definitions) ? response.data.definitions : [];
    return successful(definitions.map((definition) => ({
      name: definition.name,
      propertyName: definition.name,
      groupName: definition.groupName,
      guid: definition.guid ?? definition.propertyGuid ?? definition.definitionGuid,
      propertyGuid: definition.guid ?? definition.propertyGuid ?? definition.definitionGuid,
      valueType: definition.valueType,
      collectionType: definition.collectionType,
      elementGuid
    })));
  }
};

function normalizeOptions(optionsOrForceRefresh) {
  if (typeof optionsOrForceRefresh === 'boolean') {
    return { forceRefresh: optionsOrForceRefresh, elementGuid: '' };
  }
  const options = optionsOrForceRefresh && typeof optionsOrForceRefresh === 'object'
    ? optionsOrForceRefresh
    : {};
  return {
    forceRefresh: options.forceRefresh === true,
    elementGuid: String(options.elementGuid || options.routeGuid || '').trim()
  };
}

function getCacheKey(options) {
  return options.elementGuid ? `element:${options.elementGuid.toLowerCase()}` : 'project';
}

async function performBuild(options, cacheKey) {
  const startedAt = new Date().toISOString();
  const sectionNames = Object.keys(INDEX_BUILDERS);
  const results = await Promise.allSettled(
    sectionNames.map((name) => INDEX_BUILDERS[name](options))
  );

  const index = {
    builtAt: startedAt,
    cacheKey,
    context: options.elementGuid ? { elementGuid: options.elementGuid } : {},
    sections: {},
    summary: {
      total: 0,
      sections: sectionNames.length,
      succeeded: 0,
      failed: 0,
      skipped: 0
    }
  };

  results.forEach((result, resultIndex) => {
    const name = sectionNames[resultIndex];
    if (result.status === 'rejected') {
      index.sections[name] = {
        state: 'failed',
        items: [],
        count: 0,
        error: String(result.reason?.message || result.reason || 'unknown')
      };
      index.summary.failed++;
      return;
    }

    const value = result.value || {};
    if (!value.success) {
      index.sections[name] = {
        state: 'failed',
        items: [],
        count: 0,
        error: String(value.error || 'unknown')
      };
      index.summary.failed++;
      return;
    }

    const items = Array.isArray(value.data) ? value.data : [];
    if (value.skipped) {
      index.sections[name] = {
        state: 'skipped',
        items,
        count: items.length,
        reason: value.reason
      };
      index.summary.skipped++;
      return;
    }

    index.sections[name] = { state: 'ready', items, count: items.length };
    index.summary.succeeded++;
    index.summary.total += items.length;
  });

  const entry = { index, timestamp: Date.now() };
  cacheByKey.set(cacheKey, entry);
  activeIndex = index;
  return index;
}

function buildIndex(optionsInput = {}) {
  const options = normalizeOptions(optionsInput);
  const cacheKey = getCacheKey(options);
  const existing = inFlightByKey.get(cacheKey);
  if (existing) return existing;

  const buildPromise = performBuild(options, cacheKey)
    .finally(() => inFlightByKey.delete(cacheKey));
  inFlightByKey.set(cacheKey, buildPromise);
  return buildPromise;
}

async function getIndex(optionsInput = {}) {
  const options = normalizeOptions(optionsInput);
  const cacheKey = getCacheKey(options);
  const cached = cacheByKey.get(cacheKey);
  const cacheIsFresh = cached && cacheTTLms > 0 && Date.now() - cached.timestamp < cacheTTLms;

  if (!options.forceRefresh && cacheIsFresh) {
    activeIndex = cached.index;
    return { ...cached.index, fromCache: true };
  }

  const existing = inFlightByKey.get(cacheKey);
  if (existing) return existing;
  return buildIndex(options);
}

function resetCache() {
  cacheByKey.clear();
  activeIndex = null;
}

function setCacheTTL(ms) {
  cacheTTLms = Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_CACHE_TTL_MS;
}

function getState() {
  return {
    initialized: activeIndex !== null,
    building: inFlightByKey.size > 0,
    cacheEntries: cacheByKey.size,
    cacheTTLms,
    builtAt: activeIndex?.builtAt || null,
    cacheKey: activeIndex?.cacheKey || null
  };
}

function itemSearchValues(item) {
  return [
    item?.name,
    item?.favoriteName,
    item?.referenceSetName,
    item?.propertyName,
    item?.groupName,
    item?.id,
    item?.systemName
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

function searchInSection(sectionName, keyword, index = activeIndex) {
  if (!index || !keyword) return [];
  const section = index.sections?.[sectionName];
  if (section?.state !== 'ready') return [];
  const items = section.items;
  if (!Array.isArray(items)) return [];
  const normalizedKeyword = String(keyword).trim().toLowerCase();
  if (!normalizedKeyword) return [];
  return items.filter((item) => itemSearchValues(item).some((value) => value.includes(normalizedKeyword)));
}

function resolveByName(sectionName, name, index = activeIndex) {
  if (!index || !name) return null;
  const section = index.sections?.[sectionName];
  if (section?.state !== 'ready') return null;
  const items = section.items;
  if (!Array.isArray(items)) return null;
  const normalizedName = String(name).trim().toLowerCase();
  return items.find((item) => itemSearchValues(item).some((value) => value === normalizedName)) || null;
}

function matchText(index, text) {
  const normalizedText = String(text || '').toLowerCase();
  if (!normalizedText) return {};

  const matches = {};
  for (const [sectionName, section] of Object.entries(index.sections || {})) {
    if (!Array.isArray(section.items) || section.state !== 'ready') continue;
    const ranked = section.items
      .map((item) => {
        const values = itemSearchValues(item).filter((value) => value.length >= 2);
        const matchedValue = values
          .filter((value) => normalizedText.includes(value))
          .sort((left, right) => right.length - left.length)[0];
        return matchedValue ? { item, score: matchedValue.length } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    if (ranked.length > 0) matches[sectionName] = ranked[0].item;
  }
  return matches;
}

function buildCompactSummary(index, matches) {
  const sectionCounts = Object.entries(index.sections || {})
    .filter(([, section]) => section.state === 'ready')
    .map(([name, section]) => `${name}:${section.count}`);

  const compactMatches = {};
  for (const [name, item] of Object.entries(matches)) {
    compactMatches[name] = Object.fromEntries(
      Object.entries(item).filter(([key, value]) =>
        ['name', 'index', 'guid', 'favoriteName', 'elementType', 'domain', 'systemGuid',
          'itemGuid', 'propertyGuid', 'groupName', 'propertyName', 'floorIndex'].includes(key) &&
        value !== undefined && value !== null
      )
    );
  }

  return {
    builtAt: index.builtAt,
    sectionCounts: sectionCounts.join(', '),
    matches: compactMatches,
    failedSections: Object.entries(index.sections || {})
      .filter(([, section]) => section.state === 'failed')
      .map(([name]) => name),
    skippedSections: Object.entries(index.sections || {})
      .filter(([, section]) => section.state === 'skipped')
      .map(([name]) => name)
  };
}

async function createContext(text, options = {}) {
  const index = await getIndex(options);
  const matches = matchText(index, text);
  return buildCompactSummary(index, matches);
}

module.exports = {
  getIndex,
  resetCache,
  setCacheTTL,
  getState,
  searchInSection,
  resolveByName,
  createContext,
  matchText,
  _buildIndex: buildIndex,
  _INDEX_BUILDERS: INDEX_BUILDERS,
  _DEFAULT_CACHE_TTL_MS: DEFAULT_CACHE_TTL_MS
};

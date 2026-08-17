'use strict';

const SOURCES = new Set(['favorite', 'projectLibrary']);
const STATUSES = new Set(['resolved', 'ambiguous', 'not_found', 'invalid', 'unsupported']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  return text(value).toLowerCase();
}

function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function isGsmObject(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isGsm === true || item.isGSM === true) return true;
  const kind = normalized(item.kind || item.type || item.objectType || item.libraryPartType);
  if (kind === 'gsm' || kind === 'object' || kind === 'librarypart') {
    return normalized(item.extension) === '.gsm' ||
      normalized(item.fileExtension) === '.gsm' ||
      normalized(item.libraryPartName).endsWith('.gsm') ||
      normalized(item.name).endsWith('.gsm');
  }
  return normalized(item.extension) === '.gsm' ||
    normalized(item.fileExtension) === '.gsm' ||
    normalized(item.libraryPartName).endsWith('.gsm') ||
    normalized(item.name).endsWith('.gsm');
}

function identityOf(item, source) {
  const guid = text(item.gsmGuid || item.libraryPartGuid || item.guid || item.id);
  const name = text(item.gsmName || item.libraryPartName || item.name || item.favoriteName);
  return {
    source,
    guid: guid || undefined,
    name: name || undefined,
    libraryPartGuid: text(item.libraryPartGuid || item.gsmGuid || item.guid) || undefined,
    libraryPartName: text(item.libraryPartName || item.gsmName || item.name) || undefined,
    libraryName: text(item.libraryName || item.library || item.libraryTitle) || undefined,
    libraryPath: text(item.libraryPath || item.path) || undefined,
    favoriteName: source === 'favorite' ? text(item.favoriteName || item.name) || undefined : undefined
  };
}

function exactNameCandidates(item, identity, source) {
  const candidates = [
    source === 'favorite' ? item.favoriteName : undefined,
    item.name,
    item.gsmName,
    item.libraryPartName,
    identity.name,
    identity.favoriteName,
    identity.libraryPartName
  ]
    .map(text)
    .filter(Boolean);
  return [...new Set(candidates.map(normalized))];
}

function candidateCatalog(catalog, source) {
  if (!catalog || typeof catalog !== 'object') return null;
  const raw = source === 'favorite' ? catalog.favorites : catalog.projectLibrary;
  if (!Array.isArray(raw)) return null;
  return raw;
}

function result(status, details = {}) {
  return {
    ok: status === 'resolved',
    status,
    mode: 'offline/catalog resolution',
    realtime: false,
    archicadRequired: false,
    ...details
  };
}

function resolveGsmObject(input = {}) {
  const objectRef = input.objectRef && typeof input.objectRef === 'object'
    ? input.objectRef
    : input;
  const source = text(objectRef.source);
  const guid = text(objectRef.guid);
  const name = text(objectRef.name);

  if (!SOURCES.has(source)) {
    return result('invalid', {
      code: 'INVALID_SOURCE',
      message: 'objectRef.source is required and must be favorite or projectLibrary.'
    });
  }
  if (!guid && !name) {
    return result('invalid', {
      code: 'MISSING_SELECTOR',
      message: 'Provide objectRef.guid or objectRef.name.'
    });
  }
  if (guid && !isGuid(guid)) {
    return result('invalid', {
      code: 'INVALID_GUID',
      message: 'objectRef.guid must be a valid Archicad GUID.'
    });
  }

  const catalog = candidateCatalog(input.catalog, source);
  if (!catalog) {
    return result('invalid', {
      code: 'CATALOG_REQUIRED',
      message: `A ${source} catalog/fixture is required for offline resolution.`,
      searchScope: source
    });
  }

  const normalizedCatalog = catalog
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ item, identity: identityOf(item, source) }));
  const gsmCandidates = source === 'projectLibrary'
    ? normalizedCatalog.filter(({ item }) => isGsmObject(item))
    : normalizedCatalog;

  if (source === 'projectLibrary' && gsmCandidates.length !== normalizedCatalog.length) {
    const rejectedCount = normalizedCatalog.length - gsmCandidates.length;
    if (gsmCandidates.length === 0) {
      return result('unsupported', {
        code: 'NON_GSM_LIBRARY_PART',
        message: 'projectLibrary resolution only accepts GSM objects; all catalog entries were non-GSM.',
        searchScope: source,
        rejectedCount
      });
    }
  }

  const matches = gsmCandidates.filter(({ item, identity }) => {
    if (guid) return normalized(identity.guid) === normalized(guid);
    return exactNameCandidates(item, identity, source).includes(normalized(name));
  });

  if (matches.length === 0) {
    return result('not_found', {
      code: 'OBJECT_NOT_FOUND',
      message: `No exact GSM object match was found in ${source}.`,
      searchScope: source,
      selector: guid ? { guid } : { name }
    });
  }
  if (matches.length > 1) {
    return result('ambiguous', {
      code: 'AMBIGUOUS_OBJECT',
      message: `Multiple exact GSM object matches were found in ${source}; user selection is required.`,
      searchScope: source,
      candidates: matches.map(({ identity }) => identity)
    });
  }

  return result('resolved', {
    code: 'OBJECT_RESOLVED',
    message: 'GSM object resolved from the supplied offline catalog.',
    searchScope: source,
    object: matches[0].identity
  });
}

module.exports = {
  resolveGsmObject,
  isGsmObject,
  identityOf,
  STATUSES
};

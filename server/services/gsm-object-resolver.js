'use strict';

const SOURCES = new Set(['favorite', 'projectLibrary']);
const STATUSES = new Set(['resolved', 'ambiguous', 'not_found', 'invalid', 'unsupported', 'stale']);

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
  const raw = source === 'favorite'
    ? catalog.favorites
    : Array.isArray(catalog.projectLibrary)
      ? catalog.projectLibrary
      // Normalize the direct GetGsmObjectCatalog APX response so callers can
      // pass it through without manually reshaping {source, objects}.
      : catalog.source === 'projectLibrary' ? catalog.objects : undefined;
  if (!Array.isArray(raw)) return null;
  return raw;
}

function normalizeGsmCatalogResponse(response) {
  if (!response || typeof response !== 'object') return null;
  if (response.source !== 'projectLibrary' || !Array.isArray(response.objects)) return null;
  return {
    ...response,
    projectLibrary: response.objects
  };
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

function catalogMetadata(catalog) {
  const metadata = catalog?.metadata && typeof catalog.metadata === 'object' ? catalog.metadata : {};
  return {
    projectGuid: text(metadata.projectGuid || catalog?.projectGuid),
    projectId: text(metadata.projectId || catalog?.projectId),
    revision: text(metadata.revision || catalog?.revision),
    generatedAt: text(metadata.generatedAt || catalog?.generatedAt),
    expiresAt: text(metadata.expiresAt || catalog?.expiresAt)
  };
}

function expectedContext(input) {
  const context = input?.context && typeof input.context === 'object' ? input.context : {};
  return {
    projectGuid: text(context.projectGuid || input?.projectGuid),
    projectId: text(context.projectId || input?.projectId),
    catalogRevision: text(context.catalogRevision || input?.catalogRevision)
  };
}

function validateCatalogContext(input, catalog, nowMs) {
  const metadata = catalogMetadata(catalog);
  const expected = expectedContext(input);
  const missingContextFields = [
    expected.projectGuid && !metadata.projectGuid ? 'projectGuid' : null,
    expected.projectId && !metadata.projectId ? 'projectId' : null,
    expected.catalogRevision && !metadata.revision ? 'revision' : null
  ].filter(Boolean);
  if (missingContextFields.length > 0) {
    return result('stale', {
      code: 'CATALOG_CONTEXT_REQUIRED',
      message: 'The caller supplied a project/revision context that the GSM catalog cannot prove; refresh it before resolving an object.',
      expectedContext: expected,
      catalogContext: metadata,
      missingContextFields
    });
  }
  for (const key of ['projectGuid', 'projectId']) {
    if (expected[key] && metadata[key] && normalized(expected[key]) !== normalized(metadata[key])) {
      return result('stale', {
        code: 'CATALOG_PROJECT_MISMATCH',
        message: `The supplied catalog belongs to a different ${key}; refresh it after switching projects.`,
        expectedContext: expected,
        catalogContext: metadata
      });
    }
  }
  if (expected.catalogRevision && metadata.revision && expected.catalogRevision !== metadata.revision) {
    return result('stale', {
      code: 'CATALOG_REVISION_MISMATCH',
      message: 'The supplied catalog revision is stale; refresh the catalog before resolving an object.',
      expectedContext: expected,
      catalogContext: metadata
    });
  }

  const expiresAt = Date.parse(metadata.expiresAt);
  if (metadata.expiresAt && Number.isFinite(expiresAt) && expiresAt <= nowMs) {
    return result('stale', {
      code: 'CATALOG_EXPIRED',
      message: 'The supplied GSM catalog has expired; refresh it before resolving an object.',
      catalogContext: metadata
    });
  }

  const maxCatalogAgeMs = typeof input?.maxCatalogAgeMs === 'number' ? input.maxCatalogAgeMs : Number.NaN;
  const generatedAt = Date.parse(metadata.generatedAt);
  if (Number.isFinite(maxCatalogAgeMs) && maxCatalogAgeMs >= 0 && metadata.generatedAt &&
      Number.isFinite(generatedAt) && nowMs - generatedAt > maxCatalogAgeMs) {
    return result('stale', {
      code: 'CATALOG_TOO_OLD',
      message: 'The supplied GSM catalog exceeds maxCatalogAgeMs; refresh it before resolving an object.',
      catalogContext: metadata,
      catalogAgeMs: nowMs - generatedAt,
      maxCatalogAgeMs
    });
  }
  return null;
}

function hasFavoriteGsmIdentity(identity) {
  return isGuid(identity.libraryPartGuid) && Boolean(identity.libraryPartName);
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

  const contextFailure = validateCatalogContext(input, input.catalog, Number.isFinite(input.nowMs) ? input.nowMs : Date.now());
  if (contextFailure) return { ...contextFailure, searchScope: source };

  const normalizedCatalog = catalog
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ item, identity: identityOf(item, source) }));
  const gsmCandidates = source === 'projectLibrary'
    ? normalizedCatalog.filter(({ item }) => isGsmObject(item))
    : normalizedCatalog;

  if (source === 'projectLibrary' && gsmCandidates.length !== normalizedCatalog.length && gsmCandidates.length === 0) {
    return result('unsupported', {
      code: 'NON_GSM_LIBRARY_PART',
      message: 'projectLibrary resolution only accepts GSM objects; all catalog entries were non-GSM.',
      searchScope: source,
      rejectedCount: normalizedCatalog.length
    });
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
        .sort((left, right) => `${left.guid || ''}:${left.name || ''}`.localeCompare(`${right.guid || ''}:${right.name || ''}`))
    });
  }

  const resolved = matches[0].identity;
  if (source === 'favorite' && !hasFavoriteGsmIdentity(resolved)) {
    return result('unsupported', {
      code: 'FAVORITE_GSM_IDENTITY_REQUIRED',
      message: 'The favorite matched by name but does not expose a usable GSM libraryPartGuid and libraryPartName.',
      searchScope: source,
      favorite: resolved
    });
  }

  return result('resolved', {
    code: 'OBJECT_RESOLVED',
    message: 'GSM object resolved from the supplied offline catalog.',
    searchScope: source,
    catalogContext: catalogMetadata(input.catalog),
    object: resolved
  });
}

module.exports = {
  resolveGsmObject,
  isGsmObject,
  identityOf,
  normalizeGsmCatalogResponse,
  validateCatalogContext,
  STATUSES
};

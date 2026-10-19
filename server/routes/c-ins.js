'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - C-INS Router (Instance Snapshot, A/B Diff & Visual Review)
 * Task C-INS-01 ~ C-INS-05 (Read-Only Service Layer Wire-Up)
 */

const express = require('express');
const axios = require('axios');
const {
  describeAllInstances,
} = require('../services/archicad-instances');
const {
  synthesizeInstanceIdentity,
  verifySequentialSwitch,
  verifyDistinctInstances,
  listInstances,
} = require('../services/instance-registry');
const {
  buildD2Snapshot,
  verifySnapshotIntegrity,
} = require('../services/d2-snapshot-service');
const {
  compareSnapshotsAB,
} = require('../services/ab-diff-engine');
const {
  buildAnnotationsForDiffSession,
} = require('../services/diff-annotation-builder');
const {
  updateReviewItemState,
  checkStale,
  exportReportJSON,
  exportSummaryTable,
  exportReviewSVG,
} = require('../services/diff-review-store');

// Active session cache in memory with LRU & TTL bounds (V18R-I-1 / C-5)
const MAX_SESSIONS = 50;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const activeSessions = new Map(); // sessionId -> { session, createdAt, lastAccessedAt }

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, entry] of activeSessions.entries()) {
    if (now - entry.lastAccessedAt > SESSION_TTL_MS) {
      activeSessions.delete(id);
    }
  }
}

function getStoredSession(sessionId) {
  pruneExpiredSessions();
  const entry = activeSessions.get(sessionId);
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  return entry.session;
}

function setStoredSession(sessionId, session) {
  pruneExpiredSessions();
  if (activeSessions.size >= MAX_SESSIONS) {
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, entry] of activeSessions.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      activeSessions.delete(oldestId);
    }
  }
  activeSessions.set(sessionId, {
    session,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
}

function createCInsRouter(options = {}) {
  const router = express.Router();
  const post = options.post || ((url, data, config) => axios.post(url, data, config));

  /**
   * GET /api/c-ins/instances
   * Discover and list active Archicad instances and session cache
   */
  router.get('/instances', async (req, res) => {
    try {
      const liveInstances = await describeAllInstances({ post, probeTimeout: 1000, describeTimeout: 2000 });
      const cached = listInstances();
      res.json({
        ok: true,
        instances: liveInstances,
        cached,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: 'DISCOVERY_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/c-ins/snapshot
   * Build d2-snapshot-v1 document with quantization and SHA-256 integrity
   */
  router.post('/snapshot', (req, res) => {
    try {
      const { sourceInstance, stories, rawElements, snapshotId } = req.body || {};
      const snapshot = buildD2Snapshot({
        sourceInstance,
        stories: stories || [],
        rawElements: rawElements || [],
        snapshotId,
      });

      res.json({
        ok: true,
        snapshot,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: 'SNAPSHOT_BUILD_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/c-ins/diff
   * Run three-tier A/B matching and automatic revision cloud annotation
   */
  router.post('/diff', (req, res) => {
    try {
      const { snapshotA, snapshotB, diffSessionId, mode } = req.body || {};

      if (!snapshotA || !snapshotB) {
        return res.status(400).json({
          ok: false,
          error: 'MISSING_SNAPSHOTS',
          message: 'diff endpoint requires both snapshotA and snapshotB in request body',
        });
      }

      // Mode A sequential switch validation
      if (mode === 'sequential') {
        const check = verifySequentialSwitch(snapshotA.sourceInstance, snapshotB.sourceInstance);
        if (!check.ok) {
          return res.status(400).json(check);
        }
      }

      // Mode B dual instance distinctness validation
      if (mode === 'dual_instance') {
        const check = verifyDistinctInstances(snapshotA.sourceInstance, snapshotB.sourceInstance);
        if (!check.ok) {
          return res.status(400).json(check);
        }
      }

      // 1. Run three-tier matching engine
      const diffSession = compareSnapshotsAB(snapshotA, snapshotB, { diffSessionId });

      // 2. Generate revision clouds, ghost overlays and spatial clusters
      const annotatedSession = buildAnnotationsForDiffSession(diffSession);

      // Cache session in memory with LRU & TTL bounding (V18R-I-1 / C-5)
      setStoredSession(annotatedSession.diffSessionId, annotatedSession);

      res.json({
        ok: true,
        diffSession: annotatedSession,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: 'DIFF_CALCULATION_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/c-ins/review/update
   * Update review state for a diffItem (confirmed / ignored / adjusted)
   */
  router.post('/review/update', (req, res) => {
    try {
      const { sessionId, diffId, status, reviewedBy, userNote } = req.body || {};
      const session = getStoredSession(sessionId);

      if (!session) {
        return res.status(404).json({
          ok: false,
          error: 'SESSION_NOT_FOUND',
          message: `Diff session '${sessionId}' not found`,
        });
      }

      const updatedItem = updateReviewItemState(session, diffId, {
        status,
        reviewedBy,
        userNote,
      });

      res.json({
        ok: true,
        item: updatedItem,
      });
    } catch (err) {
      const statusCode = err.code === 'STALE_FINGERPRINT_REJECTED' ? 409 : 400;
      res.status(statusCode).json({
        ok: false,
        error: err.code || 'REVIEW_UPDATE_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * POST /api/c-ins/review/check-stale
   * Anti-tamper verification against current model elements
   */
  router.post('/review/check-stale', (req, res) => {
    try {
      const { sessionId, currentElements } = req.body || {};
      const session = getStoredSession(sessionId);

      if (!session) {
        return res.status(404).json({
          ok: false,
          error: 'SESSION_NOT_FOUND',
          message: `Diff session '${sessionId}' not found`,
        });
      }

      checkStale(session, currentElements || []);

      res.json({
        ok: true,
        session,
        staleCount: session.staleCount || 0,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: 'STALE_CHECK_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * DELETE /api/c-ins/session/:sessionId
   * Evict an active diff review session from cache (V18R-I-1 / C-5)
   */
  router.delete('/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const deleted = activeSessions.delete(sessionId);
    res.json({
      ok: true,
      deleted,
      sessionId,
    });
  });

  /**
   * GET /api/c-ins/export/:sessionId
   * Export structured JSON report, Markdown summary table, or vector SVG
   */
  router.get('/export/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const format = (req.query.format || 'json').toLowerCase();
    const session = getStoredSession(sessionId);

    if (!session) {
      return res.status(404).json({
        ok: false,
        error: 'SESSION_NOT_FOUND',
        message: `Diff session '${sessionId}' not found`,
      });
    }

    if (format === 'markdown' || format === 'md') {
      const table = exportSummaryTable(session);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.send(table);
    }

    if (format === 'svg') {
      const svg = exportReviewSVG(session);
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      return res.send(svg);
    }

    // Default: JSON report
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(exportReportJSON(session));
  });

  return router;
}

module.exports = createCInsRouter();
module.exports.createCInsRouter = createCInsRouter;
module.exports._activeSessions = activeSessions;
module.exports._getStoredSession = getStoredSession;
module.exports._setStoredSession = setStoredSession;
module.exports._pruneExpiredSessions = pruneExpiredSessions;

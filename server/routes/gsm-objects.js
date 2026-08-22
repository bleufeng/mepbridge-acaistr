'use strict';

const express = require('express');
const { resolveGsmObject } = require('../services/gsm-object-resolver');

const router = express.Router();

router.post('/resolve', (req, res) => {
  const outcome = resolveGsmObject({
    objectRef: req.body?.objectRef,
    catalog: req.body?.catalog,
    context: req.body?.context,
    maxCatalogAgeMs: req.body?.maxCatalogAgeMs
  });
  const statusCode = outcome.status === 'invalid' ? 400 : outcome.status === 'stale' ? 409 : 200;
  res.status(statusCode).json(outcome);
});

module.exports = router;

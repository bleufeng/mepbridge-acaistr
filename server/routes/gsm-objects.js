'use strict';

const express = require('express');
const { resolveGsmObject } = require('../services/gsm-object-resolver');

const router = express.Router();

router.post('/resolve', (req, res) => {
  const outcome = resolveGsmObject({
    objectRef: req.body?.objectRef,
    catalog: req.body?.catalog
  });
  res.status(outcome.status === 'invalid' ? 400 : 200).json(outcome);
});

module.exports = router;

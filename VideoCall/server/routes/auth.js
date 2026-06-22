const express = require('express');
const router = express.Router();

// Placeholder for auth routes
router.get('/me', (req, res) => {
  res.json({ message: "Auth route placeholder" });
});

module.exports = router;

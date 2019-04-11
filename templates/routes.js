const router = require('express').Router();

router.use('/', (req, res, next) => {
  res.send({ title: 'Express' });
});

module.exports = router;

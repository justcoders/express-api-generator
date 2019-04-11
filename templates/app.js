const express = require('express');
const logger = require('morgan');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => res.send({}));

app.use('/', require('./routes'));

// catch 404 and forward to error handler
app.use((req, res, next) => {
  let err = {
    status: 404
  };
  next(err);
});

// error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500);
  res.send(req.app.get('env') === 'development' ? err : {});
});

module.exports = app;

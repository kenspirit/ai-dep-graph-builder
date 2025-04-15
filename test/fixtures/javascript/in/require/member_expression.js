const logger = require('./logger').logger;

function simpleExternal() {
  return logger.info('Hello world!');
}

module.exports = {
  simpleExternal
};

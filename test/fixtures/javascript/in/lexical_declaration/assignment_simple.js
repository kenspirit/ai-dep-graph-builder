import _ from 'lodash';

function simpleAssigment() {
  const a = _.uniqueId('something');
  return a;
}

module.exports = {
  simpleAssigment
};

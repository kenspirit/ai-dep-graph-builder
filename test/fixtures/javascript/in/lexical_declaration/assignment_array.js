import _ from 'lodash';

function simpleAssigment() {
  const a = [_.uniqueId('something'), _.sample([1, 2, 3])];
  return a;
}

module.exports = {
  simpleAssigment
};

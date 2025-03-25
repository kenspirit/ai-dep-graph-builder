import _ from 'lodash';

function simpleExternal() {
  return _.uniq(_.map([1, 2, 3], () => 1));
}

module.exports = {
  simpleExternal
};

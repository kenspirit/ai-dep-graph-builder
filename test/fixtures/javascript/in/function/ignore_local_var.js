import _ from 'lodash';

function memberProperty(data, toParse) {
  const obj = _.pick(data.toJSON(), ['a', 'b', 'c']);
  if (toParse) {
    obj.b = JSON.parse(data.b);
  }
  return obj;
}

module.exports = {
  memberProperty
}

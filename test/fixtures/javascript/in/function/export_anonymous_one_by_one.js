import _ from 'lodash';

module.exports.memberProperty = (data, toParse) => {
  const obj = _.pick(data.toJSON(), ['a', 'b', 'c']);
  if (toParse) {
    obj.b = JSON.parse(data.b);
  }
  return obj;
}

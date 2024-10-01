import { GraphBuilder } from '../../../graph-builder.js';
import config from '../../../sample.config.js';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

async function getDescendants(vertex) {
  return graphBuilder.getDescendants(vertex);
}

async function getAncestors(vertex) {
  return graphBuilder.getAncestors(vertex);
}

async function getVerticesByIds(ids) {
  return graphBuilder.getVerticesByIds(ids);
}

export {
  graphBuilder,
  getDescendants,
  getAncestors,
  getVerticesByIds
};

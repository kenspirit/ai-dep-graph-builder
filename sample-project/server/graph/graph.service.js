import { GraphBuilder } from '../../../graph-builder.js';
import { default as config} from '../../../sample.config.js';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

async function getDescendants(vertex) {
  return graphBuilder.getDescendants(vertex);
}

async function getAncestors(vertex) {
  return graphBuilder.getAncestors(vertex);
}

export {
  graphBuilder,
  getDescendants,
  getAncestors
};

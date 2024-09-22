import { graphBuilder } from '../graph/graph.service.js';

async function getEdge(from, to) {
  return graphBuilder.getEdge(from, to);
}

async function createEdge(edge) {
  return graphBuilder.createEdge(edge);
}

export {
  getEdge,
  createEdge
};

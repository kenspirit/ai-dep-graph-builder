import { graphBuilder } from '../graph/graph.service.js';

async function getVerticesByCategory(category) {
  return graphBuilder.getVerticesByCategory(category);
}

async function createVertex(vertex) {
  return graphBuilder.createVertex(vertex);
}

export {
  getVerticesByCategory,
  createVertex
};

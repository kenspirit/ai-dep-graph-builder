import * as vertexService from './vertex.service.js';

async function getVerticesByCategory(req, res) {
  const { category } = req.query;
  const vertices = await vertexService.getVerticesByCategory(category);
  res.json(vertices);
}

async function createVertex(req, res) {
  const vertex = await vertexService.createVertex(req.body);
  res.json(vertex);
}

export {
  getVerticesByCategory,
  createVertex
};

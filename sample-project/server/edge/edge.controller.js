import * as edgeService from './edge.service.js';

async function getEdge(req, res) {
  const { from, to } = req.query;
  const edge = await edgeService.getEdge(from, to);
  res.json(edge);
}

async function createEdge(req, res) {
  const edge = await edgeService.createEdge(req.body);
  res.json(edge);
}

export {
  getEdge,
  createEdge
};

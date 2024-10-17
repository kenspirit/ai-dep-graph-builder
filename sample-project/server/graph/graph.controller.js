import * as graphService from './graph.service.js';

async function getDescendants(req, res) {
  const vertices = await graphService.getDescendants(req.query);
  res.json(vertices);
}

async function getAncestors(req, res) {
  const vertices = await graphService.getAncestors(req.query);
  res.json(vertices);
}

export {
  getDescendants,
  getAncestors
};

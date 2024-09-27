import * as graphService from './graph.service.js';

async function getDescendants(req, res) {
  const descendants = await graphService.getDescendants(req.query);
  res.json(descendants);
}

async function getAncestors(req, res) {
  const ancestors = await graphService.getAncestors(req.query);
  res.json(ancestors);
}

export {
  getDescendants,
  getAncestors
};

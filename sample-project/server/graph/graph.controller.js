import * as graphService from './graph.service.js';

function getDepth(req) {
  const depth = req.query.depth ? parseInt(req.query.depth, 10) : 0;
  if (isNaN(depth) || depth < 0) {
    return 0;
  }
  return depth;
}

async function getDescendants(req, res) {
  const vertices = await graphService.getDescendants(req.query, req.query.dependencyType, req.query.hasSourceCode, getDepth(req));
  res.json(vertices);
}

async function getAncestors(req, res) {
  const vertices = await graphService.getAncestors(req.query, req.query.dependencyType, req.query.hasSourceCode, getDepth(req));
  res.json(vertices);
}

async function getAll(req, res) {
  const vertices = await graphService.getAllAffected(req.query, req.query.dependencyType, req.query.hasSourceCode, getDepth(req));
  res.json(vertices);
}

export {
  getDescendants,
  getAncestors,
  getAll
};

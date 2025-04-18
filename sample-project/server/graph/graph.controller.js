import * as graphService from './graph.service.js';

function getOptions(req) {
  let depth = req.query.depth ? parseInt(req.query.depth, 10) : 0;
  if (isNaN(depth) || depth < 0) {
    depth = 0;
  }
  let minFnRowCount = req.query.minFnRowCount ? parseInt(req.query.minFnRowCount, 10) : 0;
  if (isNaN(minFnRowCount) || minFnRowCount < 0) {
    minFnRowCount = 0;
  }
  return { hasSourceCode: req.hasSourceCode || true, depth, minFnRowCount };
}

async function getDescendants(req, res) {
  const vertices = await graphService.getDescendants(req.query, req.query.dependencyType, getOptions(req));
  res.json(vertices);
}

async function getAncestors(req, res) {
  const vertices = await graphService.getAncestors(req.query, req.query.dependencyType, getOptions(req));
  res.json(vertices);
}

async function getAll(req, res) {
  const vertices = await graphService.getAllAffected(req.query, req.query.dependencyType, getOptions(req));
  res.json(vertices);
}

async function getByModuleRowNumber(req, res) {
  const vertex = await graphService.getComponentByRowNumber(req.query.systemModule, parseInt(req.query.rowNumber));

  if (!vertex || vertex.length === 0) {
    return res.json({
      vertices: [],
      links: [],
      categories: [
        { name: 'Class' },
        { name: 'Function' },
        { name: 'Field' },
        { name: 'API' }
      ]
    });
  }

  const direction = req.params.direction;
  let vertices;
  if (direction === 'descendants') {
    vertices = await graphService.getDescendants(vertex[0], req.query.dependencyType, getOptions(req));
  } else if (direction === 'ancestors') {
    vertices = await graphService.getAncestors(vertex[0], req.query.dependencyType, getOptions(req));
  } else if (direction === 'all') {
    vertices = await graphService.getAllAffected(vertex[0], req.query.dependencyType, getOptions(req));
  }

  res.json(vertices);
}

export {
  getDescendants,
  getAncestors,
  getAll,
  getByModuleRowNumber
};

import _ from 'lodash';
import * as graphService from './graph.service.js';

/*
 * Massaged result for graph chart rendering
 * {
      "vertices": [
        // Vertex Schema
      ],
      "links": [
        {
          "source": "1", // Vertex id
          "target": "0"
        }
      ],
      "categories": [ // Vertex type
        { name: 'Class' },
        { name: 'Function' },
        { name: 'Field' },
        { name: 'API' }
      ]
    }
 */
async function _massageResult(result) {
  const allIds = result.reduce((acc, item) => { 
    acc.push(...item.paths);
    return acc;
  }, []);
  const uniqueIds = [...new Set(allIds)];
  const vertices = uniqueIds.length > 0 ? await graphService.getVerticesByIds(uniqueIds) : [];

  const categories = [
    { name: 'Class' },
    { name: 'Function' },
    { name: 'Field' },
    { name: 'API' }
  ];

  const links = result.reduce((acc, item) => {
    for (let i = 0; i < item.paths.length - 1; i++) {
      acc.push({
        source: item.paths[i],
        target: item.paths[i + 1]
      });
    }
    return acc;
  }, []);

  return { vertices, links, categories };
}

async function getDescendants(req, res) {
  const descendants = await graphService.getDescendants(req.query);
  const vertices = await _massageResult(descendants);
  res.json(vertices);
}

async function getAncestors(req, res) {
  const ancestors = await graphService.getAncestors(req.query);
  const vertices = await _massageResult(ancestors);
  res.json(vertices);
}

export {
  getDescendants,
  getAncestors
};

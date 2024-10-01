import _ from 'lodash';
import * as graphService from './graph.service.js';

/*
 * Massaged result for graph chart rendering
 * {
      "nodes": [
        {
          "id": "0",
          "name": "Myriel",
          "symbolSize": 19.12381, // File - 12, Function/Field - 4, API - 8
          "value": 28.685715,
          "category": 0
        }
      ],
      "links": [
        {
          "source": "1",
          "target": "0"
        }
      ],
      "categories": [
        {
          "name": "A"
        }
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
    { name: 'File' },
    { name: 'Function' },
    { name: 'Field' },
    { name: 'API' }
  ];

  const nodes = vertices.map(vertex => ({
    id: vertex['@rid'],
    name: vertex.name,
    symbolSize: vertex.type === 'File' ? 12 : vertex.type === 'Function' || vertex.type === 'Field' ? 4 : 8,
    value: vertex.type,
    category: _.findIndex(categories, { name: vertex.type })
  }));
  
  const links = result.reduce((acc, item) => {
    for (let i = 0; i < item.paths.length - 1; i++) {
      acc.push({
        source: item.paths[i],
        target: item.paths[i + 1]
      });
    }
    return acc;
  }, []);

  return { nodes, links, categories };
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

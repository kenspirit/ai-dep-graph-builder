import { GraphBuilder } from '../../../graph-builder.js';
import config from '../../../sample.config.js';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
graphBuilder.initGraph();

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
  const vertices = uniqueIds.length > 0 ? await getVerticesByIds(uniqueIds) : [];

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

async function getDescendants(vertex, dependencyType = 'Function', options) {
  const result = await graphBuilder.getDescendants(vertex, dependencyType, options);
  return _massageResult(result);
}

async function getAncestors(vertex, dependencyType = 'Function', options) {
  const result = await graphBuilder.getAncestors(vertex, dependencyType, options);
  return _massageResult(result);
}

async function getAllAffected(vertex, dependencyType = 'Function', options) {
  const descendants = await graphBuilder.getDescendants(vertex, dependencyType, options);
  const ancestors = await graphBuilder.getAncestors(vertex, dependencyType, options);
  return _massageResult(ancestors.concat(descendants));
}

async function getVerticesByIds(ids) {
  return graphBuilder.getVerticesByIds(ids);
}

async function getComponentByRowNumber(systemModule, rowNumber) {
  return graphBuilder.getComponentByRowNumber(systemModule, rowNumber);
}

export {
  graphBuilder,
  getDescendants,
  getAncestors,
  getAllAffected,
  getVerticesByIds,
  getComponentByRowNumber
};

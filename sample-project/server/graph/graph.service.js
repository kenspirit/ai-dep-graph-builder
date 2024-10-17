import { GraphBuilder } from '../../../graph-builder.js';
import config from '../../../sample.config.js';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

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

async function getDescendants(vertex) {
  const result = await graphBuilder.getDescendants(vertex);
  return _massageResult(result);
}

async function getAncestors(vertex) {
  const result = await graphBuilder.getAncestors(vertex);
  return _massageResult(result);
}

async function getVerticesByIds(ids) {
  return graphBuilder.getVerticesByIds(ids);
}

export {
  graphBuilder,
  getDescendants,
  getAncestors,
  getVerticesByIds
};

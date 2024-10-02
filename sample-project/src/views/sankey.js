import { nameOfVertex } from './vertex-util.js'

function _sankeyData(graphData) {
  return graphData.vertices.map((vertex) => {
    return { name: nameOfVertex(vertex) };
  });
}

function _sankeyLinks(graphData) {
  const vertexMap = graphData.vertices.reduce((acc, vertex) => {
    acc[vertex['@rid']] = nameOfVertex(vertex)
    return acc;
  }, {});

  return graphData.links.map(({ source, target }) => {
    return { source: vertexMap[source], target: vertexMap[target], value: 0.1 };
  })
}

export function getSankeyOptions(graphData) {
  return {
    title: {
      text: 'Code Dependency'
    },
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove'
    },
    series: [
      {
        type: 'sankey',
        data: _sankeyData(graphData),
        links: _sankeyLinks(graphData),
        emphasis: {
          focus: 'adjacency'
        },
        levels: [
          {
            depth: 0,
            itemStyle: {
              color: '#fbb4ae'
            },
            lineStyle: {
              color: 'source',
              opacity: 0.6
            }
          },
          {
            depth: 1,
            itemStyle: {
              color: '#b3cde3'
            },
            lineStyle: {
              color: 'source',
              opacity: 0.6
            }
          },
          {
            depth: 2,
            itemStyle: {
              color: '#ccebc5'
            },
            lineStyle: {
              color: 'source',
              opacity: 0.6
            }
          },
          {
            depth: 3,
            itemStyle: {
              color: '#decbe4'
            },
            lineStyle: {
              color: 'source',
              opacity: 0.6
            }
          }
        ],
        lineStyle: {
          curveness: 0.5
        }
      }
    ]
  };
}

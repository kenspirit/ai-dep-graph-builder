import { nameOfVertex } from './vertex-util.js'

function _convertVertexTree(vertexId, { vertices, links }) {
  const vertex = vertices.find((item) => item['@rid'] === vertexId);
  const childrenIds = new Set(links.filter((item) => item.source === vertexId).map((item) => item.target));
  const children = [];
  for (const childId of childrenIds.values()) {
    children.push(_convertVertexTree(childId, { vertices, links }))
  }

  return {
    name: nameOfVertex(vertex),
    children
  }
}

export function getTreeOptions(graphData, direction) {
  const data = graphData.links.length === 0 ? [] : [_convertVertexTree(graphData.links[0].source, graphData)];

  return {
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove'
    },
    series: [
      {
        type: 'tree',
        data,
        left: '2%',
        right: '2%',
        top: '8%',
        bottom: '20%',
        symbol: 'emptyCircle',
        orient: direction === 'ancestors' ? 'BT' : 'TB',
        expandAndCollapse: true,
        label: {
          position: 'bottom',
          verticalAlign: 'middle',
          align: 'center',
          fontSize: 9
        },
        leaves: {
          label: {
            position: 'bottom',
            verticalAlign: 'middle',
            align: 'center'
          }
        },
        animationDurationUpdate: 750
      }
    ]
  };
}

import _ from 'lodash';
import gremlin from 'gremlin';
const __ = gremlin.process.statics;
const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const PlainTextSaslAuthenticator = gremlin.driver.auth.PlainTextSaslAuthenticator;

function _setPojoProperty(pojo, vertex, propertyName, defaultValue) {
  if (vertex.properties[propertyName]) {
    pojo[propertyName] = vertex.properties[propertyName][0].value;
  } else if (typeof defaultValue !== 'undefined') {
    pojo[propertyName] = defaultValue;
  }
}

const VERTEX_PROPERTIES = new Map()
  .set('name', undefined)
  .set('systemModule', undefined)
  .set('microService', undefined)
  .set('type', undefined)
  .set('description', undefined)
  .set('sourceCode', undefined)
  .set('language', undefined)
  .set('fileName', undefined)
  .set('visibility', undefined)
  .set('public', false)
  .set('startRow', undefined)
  .set('endRow', undefined)
  .set('businessModules', [])
  .set('dependencies', []);

function vertexToPojo(vertex) {
  if (!vertex) {
    return;
  }

  const pojo = {
    id: vertex.id,
    category: _.lowerFirst(vertex.label)
  };

  VERTEX_PROPERTIES.forEach((defaultValue, propertyName) => {
    _setPojoProperty(pojo, vertex, propertyName, defaultValue);
  });

  return pojo;
}

function edgeToPojo(edge) {
  if (!edge) {
    return;
  }

  return {
    id: edge.id,
    label: edge.label,
    outVertexId: edge.outV.id,
    inVertexId: edge.inV.id
  };
}

class Gremlin {
  constructor({ host = 'localhost', port = 8182, username, password }) {
    const authenticator = new PlainTextSaslAuthenticator(username, password);
    const connectionOptions = {
      mimeType: 'application/vnd.gremlin-v3.0+json',
      authenticator,
    };

    this.g = traversal().withRemote(new DriverRemoteConnection(`ws://${host}:${port}/gremlin`, connectionOptions));
  }

  async initGraph() {
    console.warn('This is intended for multi-model DB to initialize schema if required.  Gremlin does not require this.');
    return true;
  }

  async startSession() {
    // this.tx = this.g.tx();
    // return this.tx.begin();
  }

  async commitSession() {
    if (!this.tx) {
      return;
    }
    return this.tx.commit();
  }

  async rollbackSession() {
    if (!this.tx) {
      return;
    }
    await this.tx.rollback();
    this.tx = null;
  }

  async createVertex(vertex) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    let traversal = this.g.addV(_.upperFirst(vertex.category))
      .property('name', vertex.name);

    if (vertex.type) {
      traversal = traversal.property('type', vertex.type);
    }

    // Add category-specific properties
    switch (vertex.category) {
      case 'systemModule':
        if (!vertex.microService) {
          throw new Error('MicroService is required for systemModule vertex');
        }
        traversal = traversal
          .property('microService', vertex.microService)
          .property('businessModules', vertex.businessModules || [])
          .property('fileName', vertex.fileName)
          .property('language', vertex.language);
        break;
      case 'component':
        if (!vertex.microService || !vertex.systemModule) {
          throw new Error('MicroService and systemModule are required for component vertex');
        }
        traversal = traversal
          .property('microService', vertex.microService)
          .property('systemModule', vertex.systemModule)
          .property('sourceCode', vertex.sourceCode)
          .property('description', vertex.description)
          .property('public', vertex.public || false)
          .property('visibility', vertex.visibility)
          .property('fileName', vertex.fileName)
          .property('language', vertex.language)
          .property('startRow', vertex.startRow)
          .property('endRow', vertex.endRow);
        break;
    }

    const vertices = await traversal.toList();
    return vertexToPojo[vertices[0]];
  }

  async updateVertex(vertex) {
    if (!vertex.id) {
      throw new Error('Vertex id is required for update');
    }

    let traversal = this.g.V(vertex.id);

    switch (vertex.category) {
      case 'component':
        traversal = traversal
          .property('sourceCode', vertex.sourceCode)
          .property('description', vertex.description)
          .property('type', vertex.type)
          .property('public', vertex.public)
          .property('visibility', vertex.visibility)
          .property('fileName', vertex.fileName)
          .property('language', vertex.language)
          .property('startRow', vertex.startRow)
          .property('endRow', vertex.endRow);
        break;
      case 'systemModule':
        traversal = traversal
          .property('businessModules', vertex.businessModules)
          .property('fileName', vertex.fileName)
          .property('language', vertex.language);
        break;
    }

    const vertices = await traversal.toList();
    return vertexToPojo(vertices[0]);
  }

  async getVertex(vertex) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    let traversal = this.g.V()
      .hasLabel(_.upperFirst(vertex.category))
      .has('name', vertex.name);

    if (vertex.category === 'systemModule') {
      if (!vertex.microService) {
        throw new Error('MicroService is required for systemModule vertex');
      }
      traversal = traversal.has('microService', vertex.microService);
    } else if (vertex.category === 'component') {
      if (!vertex.microService || !vertex.systemModule) {
        throw new Error('MicroService and systemModule are required for component vertex');
      }
      traversal = traversal
        .has('microService', vertex.microService)
        .has('systemModule', vertex.systemModule);
    }

    const vertices = await traversal.toList();
    return vertices.map(vertexToPojo)[0];
  }

  async getVerticesByIds(ids) {
    const vertices = await this.g.V(ids).toList();
    return vertices.map(vertexToPojo);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    let traversal = this.g.V()
      .hasLabel('Component')
      .has('name', gremlin.process.TextP.containing(name))
      .has('language', language);

    if (systemModule) {
      traversal = traversal.has('systemModule', gremlin.process.TextP.containing(systemModule));
    }

    const vertices = await traversal.toList();
    return vertices.map(vertexToPojo);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    if (!Number.isInteger(rowNumber) || rowNumber < 0) {
      throw new Error('Row number must be a positive integer');
    }

    const vertices = await this.g.V()
      .hasLabel('Component')
      .has('systemModule', gremlin.process.TextP.containing(systemModule))
      .has('startRow', gremlin.process.P.lte(rowNumber))
      .has('endRow', gremlin.process.P.gte(rowNumber))
      .toList();

    return vertices.map(vertexToPojo);
  }

  async getVerticesByCategory(category) {
    return (await this.g.V().hasLabel(category).toList()).map(vertexToPojo);
  }

  async getVerticesByTypesWithDescription(category, types) {
    const vertices = await this.g.V()
      .hasLabel(category)
      .has('type', gremlin.process.P.within(types))
      .has('description')
      .toList();
    
    return vertices.map(vertexToPojo);
  }

  async createEdgeByVertices(fromVertex, toVertex) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }

    const edges = await this.g.addE('Uses')
      .from_(__.V(fromVertex.id))
      .to(__.V(toVertex.id))
      .toList();
    
    return edgeToPojo(edges[0]);
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const edges = await this.g.E()
      .hasLabel('Uses')
      .where(__.outV().hasId(fromVertex.id))
      .where(__.inV().hasId(toVertex.id))
      .toList();

    return edgeToPojo(edges[0]);
  }

  _isSubPath(pathA, pathB) {
    if (pathA.length > pathB.length) {
      return false;
    }
    return pathA.every((vertex, index) => vertex === pathB[index]);
  }

  _removeSubPaths(result, depth) {
    // Sample data
    // [
    //   { "result": ["#105:0"] },
    //   { "result": ["#105:0", "#114:0"] },
    //   { "result": ["#105:0", "#84:0"] },
    //   { "result": ["#105:0", "#114:0", "#111:0"] },
    //   { "result": ["#105:0", "#114:0", "#111:0", "#87:0"] }
    // ]

    // Sort the result by the length of the path
    result.sort((a, b) => a.result.length - b.result.length);
    if (depth > 0) {
      result = result.map(path => {
        return {
          result: path.result.slice(0, depth + 1)
        };
      });
    }

    // Remove the sub-paths
    const uniquePaths = [];
    result.forEach((path, index) => {
      if (!_.find(result, (other) => this._isSubPath(path.result, other.result), index + 1)) {
        uniquePaths.push(path.result);
      }
    });

    return Array.from(uniquePaths).map(path => ({ paths: path }));
  }

  async _traverseGraph(direction, vertex, type, hasSourceCode, depth) {
    let traversal = this.g.V()
      .hasLabel(_.upperFirst(vertex.category))
      .has('name', vertex.name);

    if (vertex.category === 'component') {
      traversal = traversal.has('systemModule', vertex.systemModule);
    }
    traversal = traversal[direction]('Uses');

    let repeatCriteria = __[direction]('Uses');
    if (type) {
      traversal = traversal.has('type', type);
      repeatCriteria = repeatCriteria.has('type', type);
    }
    if (hasSourceCode) {
      traversal = traversal.has('sourceCode', gremlin.process.P.neq(null)).has('sourceCode', gremlin.process.P.neq(''));
      repeatCriteria = repeatCriteria.has('sourceCode', gremlin.process.P.neq(null)).has('sourceCode', gremlin.process.P.neq(''));
    }

    traversal = traversal.emit().repeat(repeatCriteria);
    if (depth > 0) {
      traversal = traversal.times(depth);
    }
    traversal = traversal.path().dedup();

    const result = await traversal.toList();
    return this._removeSubPaths(result, depth);
  }

  async getDescendants(vertex, type, hasSourceCode, depth = 0) {
    return this._traverseGraph('out', vertex, type, hasSourceCode, depth);
  }

  async getAncestors(vertex, type, hasSourceCode, depth = 0) {
    return this._traverseGraph('in', vertex, type, hasSourceCode, depth);
  }
}

export default Gremlin;

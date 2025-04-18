import _ from 'lodash';
import { Database } from 'arangojs';

function vertexToPojo(vertex) {
  if (!vertex) {
    return;
  }

  const pojo = {
    id: vertex._id,
    category: _.lowerFirst(vertex._type || vertex._id.split('/')[0])
  };

  // Copy all properties except internal ArangoDB ones
  Object.keys(vertex).forEach(key => {
    if (!key.startsWith('_')) {
      pojo[key] = vertex[key];
    }
  });

  return pojo;
}

function edgeToPojo(edge) {
  if (!edge) {
    return;
  }

  return {
    id: edge._id,
    label: 'Uses',
    outVertexId: edge._from,
    inVertexId: edge._to
  };
}

class ArangoDB {
  constructor({ host = 'localhost', port = 8529, database, username, password }) {
    this.db = new Database({
      url: `http://${host}:${port}`,
      databaseName: database,
      auth: { username, password }
    });

    // Collections we'll be using
    this.collections = {
      businessModule: this.db.collection('BusinessModule'),
      microService: this.db.collection('MicroService'),
      systemModule: this.db.collection('SystemModule'),
      component: this.db.collection('Component'),
      uses: this.db.collection('Uses')
    };

    this.dummyTrx = {
      commit: () => {},
      abort: () => {},
      step: async (fn) => {
        return fn();
      }
    };
  }

  async initGraph() {
    // Create collections if they don't exist
    for (const [name, collection] of Object.entries(this.collections)) {
      const exists = await collection.exists();
      if (!exists) {
        if (name === 'uses') {
          await this.db.createEdgeCollection(collection.name);
        } else {
          await this.db.createCollection(collection.name);
        }
      }
    }

    // Create indexes
    await this.collections.component.ensureIndex({
      type: 'hash',
      fields: ['microService', 'systemModule', 'name'],
      unique: true
    });

    await this.collections.systemModule.ensureIndex({
      type: 'hash',
      fields: ['microService', 'name'],
      unique: true
    });

    return true;
  }

  async startSession() {
    // TODO: Implement transaction management
    // this.trx = this.db.beginTransaction(_.map(this.collections, collection => collection.name));
    // return this.trx.id;
  }

  async commitSession() {
    if (!this.trx) {
      return;
    }
    this.trx.commit();
    this.trx = this.dummyTrx;
    return;
  }

  async rollbackSession() {
    if (!this.trx) {
      return;
    }
    this.trx.abort();
    this.trx = this.dummyTrx;
    return;
  }

  getCollection(collectionName) {
    return this.collections[collectionName];
  }

  async createVertex(vertex) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    const collection = this.getCollection(vertex.category);
    if (!collection) {
      throw new Error(`Invalid vertex category: ${vertex.category}`);
    }

    const doc = { ...vertex, _type: _.upperFirst(vertex.category) };
    delete doc.dependencies;
    delete doc.category;
    delete doc.id;

    const result = await collection.save(doc);
    return vertexToPojo({ ...doc, id: result._id });
  }

  async updateVertex(vertex) {
    if (!vertex.id) {
      throw new Error('Vertex id is required for update');
    }

    const collection = this.getCollection(vertex.category);
    if (!collection) {
      throw new Error(`Invalid vertex category: ${vertex.category}`);
    }

    const doc = { ...vertex };
    delete doc.dependencies;
    delete doc.category;
    const id = doc.id;
    delete doc.id;

    await collection.update(id, doc);
    return vertexToPojo({ ...doc, id, _type: _.upperFirst(vertex.category) });
  }

  async getVertex(vertex, sessionId) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    const collection = this.getCollection(vertex.category);
    const query = `
      FOR v IN ${collection.name}
      FILTER v.name == @name
      ${vertex.category === 'systemModule' ? 'FILTER v.microService == @microService' : ''}
      ${vertex.category === 'component' ? 'FILTER v.microService == @microService && v.systemModule == @systemModule' : ''}
      RETURN v
    `;

    const params = _.pick(vertex, ['name', 'microService', 'systemModule']);
    const cursor = await this.db.query(query, params);
    const result = await cursor.next();
    return vertexToPojo(result);
  }

  async getVerticesByIds(ids) {
    const query = `
  FOR doc IN DOCUMENT(@ids)
  RETURN doc
`;

    const cursor = await this.db.query(query, { ids });
    const result = await cursor.all();
    return result.map(vertexToPojo);
  }

  async createEdgeByVertices(fromVertex, toVertex) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }

    const edge = {
      _from: fromVertex.id,
      _to: toVertex.id
    };

    const result = await this.getCollection('uses').save(edge);
    return edgeToPojo({ ...edge, _id: result._id });
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const query = `
      FOR e IN Uses
      FILTER e._from == @from && e._to == @to
      RETURN e
    `;

    const cursor = await this.db.query(query, {
      from: fromVertex.id,
      to: toVertex.id
    });

    const result = await cursor.next();
    return edgeToPojo(result);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    const query = `
      FOR v IN Component
      FILTER CONTAINS(v.name, @name) 
      FILTER v.language == @language
      ${systemModule ? 'FILTER CONTAINS(v.systemModule, @systemModule)' : ''}
      RETURN v
    `;

    const cursor = await this.db.query(query, { 
      name,
      language,
      systemModule
    });
    
    const results = await cursor.all();
    return results.map(vertexToPojo);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    if (!Number.isInteger(rowNumber) || rowNumber < 0) {
      throw new Error('Row number must be a positive integer');
    }

    const query = `
      FOR v IN Component
      FILTER CONTAINS(v.systemModule, @systemModule)
      FILTER v.startRow <= @rowNumber && v.endRow >= @rowNumber
      RETURN v
    `;

    const cursor = await this.db.query(query, { 
      systemModule,
      rowNumber
    });
    
    const results = await cursor.all();
    return results.map(vertexToPojo);
  }

  async getVerticesByCategory(category) {
    const collection = this.getCollection(category);
    if (!collection) {
      throw new Error(`Invalid category: ${category}`);
    }

    const query = `
      FOR v IN ${collection.name}
      RETURN v
    `;

    const cursor = await this.db.query(query);
    const results = await cursor.all();
    return results.map(vertexToPojo);
  }

  async getVerticesByTypesWithDescription(category, types) {
    const collection = this.getCollection(category);
    if (!collection) {
      throw new Error(`Invalid category: ${category}`);
    }

    const query = `
      FOR v IN ${collection.name}
      FILTER v.type IN @types
      FILTER v.description != null
      RETURN v
    `;

    const cursor = await this.db.query(query, { types });
    const results = await cursor.all();
    return results.map(vertexToPojo);
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

  async _traverseGraph(direction, vertex, type, options) {
    const collection = this.getCollection(vertex.category);
    if (!collection) {
      throw new Error(`Invalid category: ${vertex.category}`);
    }

// FOR v IN Component
//   FILTER v.name == 'request'
//   FILTER v.systemModule == '/common/utils/consoleService.util.js'
//   FOR related, edge, path IN 0..100 INBOUND v Uses
//     FILTER related.type == 'Function'

//     RETURN {
//       result: path.vertices[*]._id
//     }
    const query = `
FOR v IN ${collection.name}
  FILTER v.name == @name
  ${vertex.category === 'component' ? 'FILTER v.systemModule == @systemModule' : ''}
  FOR related, edge, path IN 0..${options.depth || 100} ${direction} v Uses
    ${type ? 'FILTER related.type == @type' : ''}
    ${options.hasSourceCode ? 'FILTER related.sourceCode != null' : ''}
    ${options.minFnRowCount > 0 ? `FILTER related.endRow - related.startRow >= ${options.minFnRowCount}` : ''}
    RETURN { 
      result: path.vertices[*]._id
    }`;

    const cursor = await this.db.query(query, {
      name: vertex.name,
      systemModule: vertex.systemModule,
      type
    });

    const result = await cursor.all();
    return this._removeSubPaths(result, options.depth);
  }

  async getDescendants(vertex, type, options) {
    return this._traverseGraph('OUTBOUND', vertex, type, options);
  }

  async getAncestors(vertex, type, options) {
    return this._traverseGraph('INBOUND', vertex, type, options);
  }
}

export default ArangoDB;

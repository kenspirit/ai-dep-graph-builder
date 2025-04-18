import _ from 'lodash';
import axios from 'axios';

const HEADER_SESSION_ID = 'arcadedb-session-id';

function vertexToPojo(vertex) {
  if (!vertex) {
    return;
  }

  vertex.category = _.lowerFirst(vertex['@type']);
  vertex.id = vertex['@rid'];
  delete vertex['@type'];
  delete vertex['@rid'];
  return vertex;
}

function edgeToPojo(edge) {
  if (!edge) {
    return;
  }

  return {
    id: edge['@rid'],
    label: edge['@type'],
    outVertexId: edge['@out'],
    inVertexId: edge['@in']
  };
}

class ArcadeDB {
  constructor({ host, port, database, username, password }) {
    this.database = database;

    const instance = axios.create({
      baseURL: `http://${host}:${port}/api/v1`,
      headers: {
        'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      }
    });
    instance.defaults.headers.post['Content-Type'] = 'application/json';

    this.connector = instance;
  }

  async initGraph() {
    const command = `
CREATE EDGE TYPE Uses IF NOT EXISTS;

CREATE VERTEX TYPE VertexBase IF NOT EXISTS;
CREATE PROPERTY VertexBase.name IF NOT EXISTS STRING;
CREATE PROPERTY VertexBase.type IF NOT EXISTS STRING;
CREATE PROPERTY VertexBase.description IF NOT EXISTS STRING;

CREATE VERTEX TYPE BusinessModule IF NOT EXISTS EXTENDS VertexBase;
CREATE VERTEX TYPE MicroService IF NOT EXISTS EXTENDS VertexBase;

CREATE VERTEX TYPE SystemModule IF NOT EXISTS EXTENDS VertexBase;
CREATE PROPERTY SystemModule.microService IF NOT EXISTS STRING;
CREATE PROPERTY SystemModule.businessModules IF NOT EXISTS LIST OF STRING;
CREATE PROPERTY SystemModule.fileName IF NOT EXISTS STRING;
CREATE PROPERTY SystemModule.language IF NOT EXISTS STRING;

CREATE VERTEX TYPE Component IF NOT EXISTS EXTENDS VertexBase;
CREATE PROPERTY Component.visibility IF NOT EXISTS STRING;
CREATE PROPERTY Component.public IF NOT EXISTS BOOLEAN;
CREATE PROPERTY Component.microService IF NOT EXISTS STRING;
CREATE PROPERTY Component.systemModule IF NOT EXISTS STRING;
CREATE PROPERTY Component.sourceCode IF NOT EXISTS STRING;
CREATE PROPERTY Component.fileName IF NOT EXISTS STRING;
CREATE PROPERTY Component.language IF NOT EXISTS STRING;
CREATE PROPERTY Component.startRow IF NOT EXISTS INTEGER;
CREATE PROPERTY Component.endRow IF NOT EXISTS INTEGER;

CREATE INDEX IF NOT EXISTS ON Component (microService, systemModule, name) UNIQUE;
CREATE INDEX IF NOT EXISTS ON SystemModule (microService, name) UNIQUE;`;
    await this._dbCommand('command', undefined, command, {}, 'sqlscript');
    return true;
  }

  async _dbCommand(operation, sessionId, command, params = {}, language = 'sql') {
    let data;
    let opts;

    if (command) {
      data = {};
      data.language = language;
      data.command = command;
      data.params = params;
    }
    if (sessionId) {
      opts = { headers: {} };
      opts.headers[HEADER_SESSION_ID] = sessionId;
    }

    try {
      const { data: responseData, status, headers: responseHeaders } = await this.connector.post(`/${operation}/${this.database}`, data, opts);
      if (![200, 204].includes(status)) {
        // Data might carry error message & exception info
        throw new Error(`Failed to ${operation} with command: ${command}.  Response: ${JSON.stringify(responseData)}`);
      }

      if (operation === 'begin') {
        if (responseHeaders && responseHeaders['arcadedb-session-id']) {
          return responseHeaders['arcadedb-session-id'];
        }
        throw new Error('No session created');
      }

      if (responseData && responseData.result) {
        // Extract result from response data
        return responseData.result;
      }

      return [];
    } catch (error) {
      console.log('error', error);
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = JSON.stringify(error.response.data);
      }
      throw new Error(`Failed to ${operation}: sessionId - ${sessionId}; data - ${JSON.stringify(data)}; response - ${errorMessage}`);
    }
  }

  async startSession() {
    return this._dbCommand('begin');
  }

  async commitSession(sessionId) {
    if (!sessionId) {
      return;
    }
    return this._dbCommand('commit', sessionId);
  }

  async rollbackSession(sessionId) {
    if (!sessionId) {
      return;
    }
    return this._dbCommand('rollback', sessionId);
  }

  _getVertexCommand(vertex) {
    switch (vertex.category) {
      case 'businessModule':
        return `CREATE VERTEX BusinessModule SET name = :name, type = :type;`;
      case 'microService':
        return `CREATE VERTEX MicroService SET name = :name, type = :type;`;
      case 'systemModule':
        return `CREATE VERTEX SystemModule SET name = :name, type = :type, businessModules = :businessModules, microService = :microService, fileName = :fileName, language = :language;`;
      case 'component':
        return `CREATE VERTEX Component SET name = :name, type = :type, microService = :microService, systemModule = :systemModule, sourceCode = :sourceCode,
 description = :description, public = :public, visibility = :visibility, fileName = :fileName, language = :language,
 startRow = :startRow, endRow = :endRow;`;
    }
  }

  async createVertex(vertex, sessionId) {
    const command = this._getVertexCommand(vertex);
    const result = await this._dbCommand('command', sessionId, command, vertex);
    return vertexToPojo(result[0]);
  }

  _getVertexUpdateCommand(vertex) {
    switch (vertex.category) {
      case 'component':
        return `UPDATE Component SET type = :type, sourceCode = :sourceCode, description = :description, public = :public, visibility = :visibility,
  fileName = :fileName, language = :language, startRow = :startRow, endRow = :endRow
  WHERE @rid = ${vertex.id};`;
      case 'systemModule':
        return `UPDATE SystemModule SET type = :type, description = :description, businessModules = :businessModules, fileName = :fileName, language = :language WHERE @rid = ${vertex.id};`;
      default:
        return `UPDATE ${_.upperFirst(vertex.category)} SET type = :type, description = :description WHERE @rid = ${vertex.id};`;
    }
  }

  async updateVertex(vertex, sessionId) {
    const command = this._getVertexUpdateCommand(vertex);
    return this._dbCommand('command', sessionId, command, vertex)[0];
  }

  _getVertexQuery(vertex) {
    switch (vertex.category) {
      case 'businessModule':
        return `SELECT FROM BusinessModule WHERE name = :name;`;
      case 'microService':
        return `SELECT FROM MicroService WHERE name = :name;`;
      case 'systemModule':
        return `SELECT FROM SystemModule WHERE name = :name AND microService = :microService;`;
      case 'component':
        return `SELECT FROM Component WHERE name = :name AND microService = :microService AND systemModule = :systemModule`;
    }
  }

  async getVertex(vertex, sessionId) {
    const result = await this._dbCommand('query', sessionId, this._getVertexQuery(vertex), vertex);
    return result.map(vertexToPojo)[0];
  }

  async getVerticesByIds(ids) {
    const result = await this._dbCommand('query', undefined, `SELECT FROM [${ids.join(', ')}]`);
    return result.map(vertexToPojo);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    const params = { name: `%${name}%`, language };
    let sql = `SELECT FROM Component WHERE name LIKE :name AND language = :language`;
    if (systemModule) {
      sql += ` AND systemModule LIKE :systemModule`;
      params.systemModule = `%${systemModule}%`;
    }

    const result = await this._dbCommand('query', undefined, sql, params);
    return result.map(vertexToPojo);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    const params = { rowNumber, systemModule: `%${systemModule}%` };
    const sql = `SELECT FROM Component WHERE systemModule LIKE :systemModule AND startRow <= :rowNumber AND endRow >= :rowNumber`;

    const result = await this._dbCommand('query', undefined, sql, params);
    return result.map(vertexToPojo);
  }

  async getVerticesByCategory(category) {
    const result = await this._dbCommand('query', undefined, `SELECT FROM ${category};`);
    return result.map(vertexToPojo);
  }

  async getVerticesByTypesWithDescription(category, types) {
    const result = await this._dbCommand('query', undefined, `SELECT FROM ${category} WHERE type IN :types AND description is not null;`, { types });
    return result.map(vertexToPojo);
  }

  async createEdgeByVertices(fromVertex, toVertex, sessionId) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }
    const command = `CREATE EDGE Uses FROM ${fromVertex.id} TO ${toVertex.id};`;
    const [createdEdge] = await this._dbCommand('command', sessionId, command);
    return createdEdge;
  }

  async _dbQuery(operation, query, language = 'sql') {
    try {
      const { data: responseData, status } = await this.connector.get(`/${operation}/${this.database}/${language}/${encodeURIComponent(query)}`);
      if (![200, 204].includes(status)) {
        // Data might carry error message & exception info
        throw new Error(`Failed to ${operation} with command: ${command}.  Response: ${JSON.stringify(responseData)}`);
      }

      if (responseData && responseData.result) {
        // Extract result from response data
        return responseData.result;
      }

      return [];
    } catch (error) {
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = JSON.stringify(error.response.data);
      }
      throw new Error(`Failed to ${operation}: query - ${JSON.stringify(query)}; response - ${errorMessage}`);
    }
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const edge = { from: fromVertex.id, to: toVertex.id };
    const query = `SELECT FROM Uses WHERE @out = '${edge.from}' AND @in = '${edge.to}';`
    const result = await this._dbCommand('query', undefined, query, edge);
    return edgeToPojo(result[0]);
  }

  _getGremlinVertexQuery(vertex) {
    let query = `g.V().hasLabel('${_.upperFirst(vertex.category)}').has('name', '${vertex.name}')`;
    if (vertex.category === 'component') {
      query = `${query}.has('systemModule', '${vertex.systemModule}')`;
    }
    return query;
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
    const typeFilter = type ? `.has('type', '${type}')` : '';
    const sourceCodeFilter = options.hasSourceCode ? `.has('sourceCode', P.neq(null)).has('sourceCode', P.neq(''))` : '';
    const rowCountFilter = options.minFnRowCount > 0 ? `
    .filter(
      	__.sack(assign).by(__.values('endRow'))
          .sack(minus).by(__.values('startRow'))
          .sack().is(P.gte(${options.minFnRowCount}))
      )` : '';
    const depthLimit = options.depth > 0 ? `.times(${options.depth})` : '';
    const query = `${this._getGremlinVertexQuery(vertex)}.${direction}('Uses')${typeFilter}${sourceCodeFilter}.emit().repeat(__.${direction}('Uses')${typeFilter}${sourceCodeFilter}${rowCountFilter})${depthLimit}.path().dedup()`;
    const result = await this._dbCommand('query', undefined, query, undefined, 'gremlin');
    return this._removeSubPaths(result, options.depth);
  }

  async getDescendants(vertex, type, options) {
    return this._traverseGraph('out', vertex, type, options);
  }

  async getAncestors(vertex, type, options) {
    return this._traverseGraph('in', vertex, type, options);
  }
}

export default ArcadeDB;

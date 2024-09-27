import _ from 'lodash';
import axios from 'axios';

const HEADER_SESSION_ID = 'arcadedb-session-id';

function assignCategory(vertex) {
  if (!vertex) {
    return;
  }
  vertex.category = _.lowerFirst(vertex['@type']);
  delete vertex['@type'];
  return vertex;
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

CREATE VERTEX TYPE Component IF NOT EXISTS EXTENDS VertexBase;
CREATE PROPERTY Component.microService IF NOT EXISTS STRING;
CREATE PROPERTY Component.systemModule IF NOT EXISTS STRING;
CREATE PROPERTY Component.sourceCode IF NOT EXISTS STRING;

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
        return `CREATE VERTEX SystemModule SET name = :name, type = :type, businessModules = :businessModules, microService = :microService;`;
      case 'component':
        return `CREATE VERTEX Component SET name = :name, type = :type, microService = :microService, systemModule = :systemModule, sourceCode = :sourceCode;`;
    }
  }

  async createVertex(vertex, sessionId) {
    const command = this._getVertexCommand(vertex);
    const result = await this._dbCommand('command', sessionId, command, vertex);
    return result.map(assignCategory);
  }

  _getVertexUpdateCommand(vertex) {
    switch (vertex.category) {
      case 'component':
        return `UPDATE Component WHERE @rid = ${vertex['@rid']} SET sourceCode = :sourceCode;`;
      case 'systemModule':
        return `UPDATE SystemModule WHERE @rid = ${vertex['@rid']} SET businessModules = :businessModules;`;
    }
  }

  async updateVertex(vertex, sessionId) {
    const command = this._getVertexUpdateCommand(vertex);
    const result = await this._dbCommand('command', sessionId, command, vertex);
    return result.map(assignCategory);
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

  async getVertex(vertex) {
    const result = await this._dbCommand('query', undefined, this._getVertexQuery(vertex), vertex);
    return result.map(assignCategory)[0];
  }

  async getVerticesByIds(ids) {
    const result = await this._dbCommand('query', undefined, `SELECT FROM [${ids.join(', ')}]`);
    return result.map(assignCategory);
  }

  async getVerticesByCategory(category) {
    const result = await this._dbCommand('query', undefined, `SELECT FROM ${category};`);
    return result.map(assignCategory);
  }

  async createEdgeByVertices(fromVertex, toVertex, sessionId) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }
    const command = `CREATE EDGE Uses FROM ${fromVertex['@rid']} TO ${toVertex['@rid']};`;
    const [createdEdge] = await this._dbCommand('command', sessionId, command);
    return createdEdge;
  }

  async _dbQuery(operation, query) {
    try {
      const { data: responseData, status } = await this.connector.get(`/${operation}/${this.database}/sql/`);
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
    const edge = { from: fromVertex['@rid'], to: toVertex['@rid'] };
    const query = `SELECT FROM Uses WHERE @out = '${edge.from}' AND @in = '${edge.to}';`
    const result = await this._dbCommand('query', undefined, query, edge);
    return result[0];
  }

  _getGremlinVertexQuery(vertex) {
    let query = `g.V().hasLabel('${_.upperFirst(vertex.category)}').has('name', '${vertex.name}')`;
    if (vertex.category === 'component') {
      query = `${query}.has('systemModule', '${vertex.systemModule}')`;
    }
    return query;
  }

  async getDescendants(vertex) {
    const query = `${this._getGremlinVertexQuery(vertex)}.emit().repeat(__.out('Uses')).path()`;
    const result = await this._dbCommand('query', undefined, query, vertex, 'gremlin');
    // Sample data
    // [
    //   { "result": ["#105:0"] },
    //   { "result": ["#105:0", "#114:0"] },
    //   { "result": ["#105:0", "#84:0"] },
    //   { "result": ["#105:0", "#114:0", "#111:0"] },
    //   { "result": ["#105:0", "#114:0", "#111:0", "#87:0"] }
    // ]
    return result;
  }

  async getAncestors(vertex) {
    const query = `${this._getGremlinVertexQuery(vertex)}.emit().repeat(__.in('Uses')).path()`;
    const result = await this._dbCommand('query', undefined, query, vertex, 'gremlin');
    // Sample data
    // [
    //   { "result": ["#105:0"] },
    //   { "result": ["#105:0", "#114:0"] },
    //   { "result": ["#105:0", "#114:0", "#111:0"] }
    // ]
    return result;
  }
}

export default ArcadeDB;

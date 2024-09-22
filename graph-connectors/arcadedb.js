import axios from 'axios';

const HEADER_SESSION_ID = 'arcadedb-session-id';

class ArcadeDB {
  constructor({ host, port, database, username, password }) {
    console.log('ArcadeDB constructor', { host, port, database, username, password });
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
    await this.dbCommand('command', undefined, command, {}, 'sqlscript');
    return true;
  }

  async dbCommand(operation, sessionId, command, params = {}, language = 'sql') {
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

  getVertexCommand(vertex) {
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

  async createVertex(vertex, outerSessionId) {
    let sessionId = outerSessionId;
    const result = [];

    try {
      if (!sessionId) {
        sessionId = await this.dbCommand('begin');
      }

      const command = this.getVertexCommand(vertex);
      const [parent] = await this.dbCommand('command', sessionId, command, vertex);
      if (parent) {
        // Sample format
        // {
        //   '@rid': '#36:0',
        //   '@type': 'MicroService',
        //   '@cat': 'v',
        //   name: 'pm_console_svc',
        //   type: 'backend'
        // }
        result.push(parent);
      } else {
        throw new Error('Failed to create vertex');
      }

      if (vertex.dependencies) {
        for (const dependency of vertex.dependencies) {
          const child = await this.createVertex(dependency, sessionId);
          for (const c of child) {
            result.push(c);
            const edge = await this.createEdge(parent, c, sessionId);
            if (edge) {
              result.push(edge);
            }
          }
        }
      }

      if (!outerSessionId) {
        await this.dbCommand('commit', sessionId);
      }
    } catch (error) {
      let errorMessage = error.message;
      try {
        !!sessionId && await this.dbCommand('rollback', sessionId);
      } catch (error) {
        errorMessage = `Failed to rollback due to ${error.message} after: ${errorMessage}`;
      }
      throw new Error(`Failed to create vertex: ${errorMessage}`);
    }

    return result;
  }

  getVertexQuery(vertex) {
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

  async getVerticesByCategory(category) {
    const result = await this.dbCommand('query', undefined, `SELECT FROM ${category};`);
    return result;
  }

  async getOneVertex(vertex) {
    const result = await this.dbCommand('query', undefined, this.getVertexQuery(vertex), vertex);
    return result[0];
  }

  getEdgeCommand(edge) {
    return `CREATE EDGE Uses FROM ${edge.from} TO ${edge.to};`;
  }

  async createEdge(fromVertex, toVertex, sessionId) {
    const edge = { from: fromVertex['@rid'], to: toVertex['@rid'] };
    const existingEdge = await this.getOneEdge(edge);
    if (existingEdge) {
      return existingEdge;
    }
    const command = this.getEdgeCommand(edge);
    const [createdEdge] = await this.dbCommand('command', sessionId, command);
    return createdEdge;
  }

  async dbQuery(operation, query, params = {}) {
    try {
      const { data: responseData, status, headers: responseHeaders } = await this.connector.get(`/${operation}/${this.database}/sql/`, data, opts);
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
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = JSON.stringify(error.response.data);
      }
      throw new Error(`Failed to ${operation}: sessionId - ${sessionId}; data - ${JSON.stringify(data)}; response - ${errorMessage}`);
    }
  }

  getEdgeQuery(edge) {
    return `SELECT FROM Uses WHERE @out = '${edge.from}' AND @in = '${edge.to}';`;
  }

  async getOneEdge(edge) {
    const result = await this.dbCommand('query', undefined, this.getEdgeQuery(edge), edge);
    return result[0];
  }
}

export default ArcadeDB;

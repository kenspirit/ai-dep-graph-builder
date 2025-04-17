import Arango from './graph-connectors/arango.js';
import Arcadedb from './graph-connectors/arcadedb.js';
import Gremlin from './graph-connectors/gremlin.js';
import { VERTEX_SCHEMA, VERTEX_QUERY_SCHEMA, UPDATABLE_FIELDS } from './graph-constants.js';

const GRAPH_CONNECTOR_TYPES = {
  GREMLIN: Gremlin,
  ARCADEDB: Arcadedb,
  ARANGO: Arango
};

class GraphBuilder {
  constructor(connectionType, connectionOptions = { host, port, database, username, password }) {
    this.connector = new GRAPH_CONNECTOR_TYPES[connectionType](connectionOptions);
  }

  async initGraph() {
    return this.connector.initGraph();
  }

  _fillMissingProperties(vertex) {
    if (!vertex.dependencies) {
      return;
    }

    for (const dependency of vertex.dependencies) {
      // Auto-assign microService & systemModule for child vertices if empty
      if (dependency.category === 'systemModule') {
        dependency.microService = vertex.name;
      } else if (dependency.category === 'component') {
        dependency.microService = vertex.microService;
        if (!dependency.systemModule) {
          dependency.systemModule = vertex.systemModule;
        }
      }

      this._fillMissingProperties(dependency);
    }
  }

  _updateVertexFields(existingVertex, vertex) {
    for (const field of UPDATABLE_FIELDS) {
      if (typeof vertex[field] === 'undefined') {
        continue;
      }

      existingVertex[field] = vertex[field];
    }
  }

  async createVertex(vertex, outerSessionId) {
    this._fillMissingProperties(vertex);

    const { error } = VERTEX_SCHEMA.validate(vertex);
    if (error) {
      throw new Error(error);
    }

    let sessionId = outerSessionId;
    const result = [];

    try {
      if (!sessionId) {
        sessionId = await this.connector.startSession();
      }

      let parent;
      const existingVertex = await this.getVertex(vertex, sessionId);
      if (existingVertex) {
        this._updateVertexFields(existingVertex, vertex);
        await this.connector.updateVertex(existingVertex, sessionId);
        result.push(existingVertex);

        parent = existingVertex;
      } else {
        const created = await this.connector.createVertex(vertex, sessionId);
        if (created) {
          parent = created;
        } else {
          throw new Error('Failed to create vertex');
        }
      }

      result.push(parent);

      if (vertex.dependencies) {
        for (const dependency of vertex.dependencies) {
          // Recursively create child vertices
          const child = await this.createVertex(dependency, sessionId);
          for (const c of child) {
            result.push(c);
            await this.connector.createEdgeByVertices(parent, c, sessionId);
          }
        }
      }

      if (!outerSessionId) {
        await this.connector.commitSession(sessionId);
      }
    } catch (error) {
      let errorMessage = error.message;
      try {
        !!sessionId && await this.connector.rollbackSession(sessionId);
      } catch (error) {
        errorMessage = `${errorMessage}.  Rollback error: ${error.message}.`;
      }
      throw new Error(`Failed to create vertex: ${errorMessage}.`);
    }

    return result;
  }

  async getVertex(vertex, sessionId) {
    const { error } = VERTEX_QUERY_SCHEMA.validate(vertex);
    if (error) {
      throw new Error(error);
    }
    return this.connector.getVertex(vertex, sessionId);
  }

  async createEdgeByVertices(fromVertex, toVertex, sessionId) {
    const from = await this.getVertex(fromVertex, sessionId);
    const to = await this.getVertex(toVertex, sessionId);
    if (!from || !to) {
      throw new Error(`Creating Edge: Vertex ${!!from ? 'to' : 'from'} not found.  ${!!from ? JSON.stringify(toVertex) : JSON.stringify(fromVertex)}`);
    }

    return this.connector.createEdgeByVertices(from, to, sessionId);
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const from = await this.getVertex(fromVertex);
    const to = await this.getVertex(toVertex);
    if (!from || !to) {
      throw new Error(`Vertex not found.  From: ${JSON.stringify(fromVertex)}; To: ${JSON.stringify(toVertex)}`);
    }

    return this.connector.getEdgeByVertices(from, to);
  }

  async getVerticesByIds(ids) {
    return this.connector.getVerticesByIds(ids);
  }

  async getVerticesByCategory(category) {
    return this.connector.getVerticesByCategory(category);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    return this.connector.getComponentByNameAndLanguage(name, language, systemModule);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    return this.connector.getComponentByRowNumber(systemModule, rowNumber);
  }

  async getVerticesByTypesWithDescription(category, types) {
    return this.connector.getVerticesByTypesWithDescription(category, types);
  }

  async getDescendants(vertex, type, hasSourceCode, depth = 0) {
    // Format should be as below and the sub-paths, such as [1, 2], should not be included.
    // The paths should be the vertex identifiers.
    // [
    //   { paths: [1, 2, 3] },
    //   { paths: [1, 2, 4] },
    //   { paths: [1, 5, 6] }
    // ]

    // If depth is 0, it means all descendants should be retrieved.
    // If depth is 1, it means only direct children should be retrieved.
    return this.connector.getDescendants(vertex, type, hasSourceCode, depth);
  }

  async getAncestors(vertex, type, hasSourceCode, depth = 0) {
    return this.connector.getAncestors(vertex, type, hasSourceCode, depth);
  }
}

function registerGraphConnector(connectionType, connector) {
  GRAPH_CONNECTOR_TYPES[connectionType] = connector;
}

export {
  GraphBuilder,
  registerGraphConnector
};

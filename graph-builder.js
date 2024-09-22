import joi from 'joi';
import Arcadedb from './graph-connectors/arcadedb.js';
import Gremlin from './graph-connectors/gremlin.js';

const GRAPH_CONNECTOR_TYPES = {
  GREMLIN: Gremlin,
  ARCADEDB: Arcadedb
};

const VERTEX_SCHEMA = joi.object({
  category: joi.string().required().valid('businessModule', 'microService', 'systemModule', 'component'),
  name: joi.string().required(),
  type: joi.string().required(), // -- Class / File / UI / Function / Field / Interface (API URL/Queue/Table/Store Procedure)
  description: joi.string().required(),
  dependencies: joi.array().items(joi.link('#vertex')),
  sourceCode: joi.string().when('category', {
    is: 'component',
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  businessModules: joi.array().when('category', {
    is: 'systemModule',
    then: joi.array().items(joi.string()).required(),
    otherwise: joi.forbidden()
  }),
  microService: joi.string().when('category', {
    is: joi.string().valid('component', 'systemModule'),
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  systemModule: joi.string().when('category', {
    is: 'component',
    then: joi.required(),
    otherwise: joi.forbidden()
  })
}).id('vertex');

const VERTEX_QUERY_SCHEMA = joi.object({
  category: joi.string().required().valid('businessModule', 'microService', 'systemModule', 'component'),
  name: joi.string().required(),
  microService: joi.string().when('category', {
    is: joi.string().valid('component', 'systemModule'),
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  systemModule: joi.string().when('category', {
    is: 'component',
    then: joi.required(),
    otherwise: joi.forbidden()
  })
}).unknown(true);

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
      // Auto-assign microService & systemModule for child vertices
      if (dependency.category === 'systemModule') {
        dependency.microService = vertex.name;
      } else if (dependency.category === 'component') {
        dependency.microService = vertex.microService;
        dependency.systemModule = vertex.name;
      }

      this._fillMissingProperties(dependency);
    }
  }

  async createVertex(vertex) {
    this._fillMissingProperties(vertex);

    const { error } = VERTEX_SCHEMA.validate(vertex);
    if (error) {
      throw new Error(error);
    }
    const createdInfo = await this.connector.createVertex(vertex);
    return createdInfo;
  }

  async getOneVertex(vertex) {
    const { error } = VERTEX_QUERY_SCHEMA.validate(vertex);
    if (error) {
      throw new Error(error);
    }
    return this.connector.getOneVertex(vertex);
  }

  async createEdge(fromVertex, toVertex) {
    const from = await this.getOneVertex(fromVertex);
    const to = await this.getOneVertex(toVertex);
    if (!from || !to) {
      throw new Error(`Vertex not found.  From: ${JSON.stringify(fromVertex)}; To: ${JSON.stringify(toVertex)}`);
    }

    return this.connector.createEdge(from, to);
  }

  async getVerticesByCategory(category) {
    return this.connector.getVerticesByCategory(category);
  }
}

function registerGraphConnector(connectionType, connector) {
  GRAPH_CONNECTOR_TYPES[connectionType] = connector;
}

export {
  VERTEX_SCHEMA,
  VERTEX_QUERY_SCHEMA,
  GraphBuilder,
  registerGraphConnector
};

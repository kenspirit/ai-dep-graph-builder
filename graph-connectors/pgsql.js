import _ from 'lodash';
import crypto from 'crypto';
import { types, Client } from "pg";
import { CharStreams, CommonTokenStream } from 'antlr4ts'
import { AgtypeLexer } from './antlr4/AgtypeLexer.js'
import { AgtypeParser } from './antlr4/AgtypeParser.js'
import CustomAgTypeListener from './antlr4/CustomAgTypeListener.js'
import { ParseTreeWalker } from 'antlr4ts/tree/index.js'

function AGTypeParse(input) {
  const chars = CharStreams.fromString(input)
  const lexer = new AgtypeLexer(chars)
  const tokens = new CommonTokenStream(lexer)
  const parser = new AgtypeParser(tokens)
  const tree = parser.agType()
  const printer = new CustomAgTypeListener()
  ParseTreeWalker.DEFAULT.walk(printer, tree)
  return printer.getResult()
}

async function setAGETypes(client, types) {
  await client.query(`
      CREATE EXTENSION IF NOT EXISTS age;
      LOAD 'age';
      SET search_path = ag_catalog, "$user", public;
  `)

  const oidResults = await client.query(`select typelem from pg_type where typname = '_agtype';`)

  if (oidResults.rows.length < 1) { throw new Error() }

  types.setTypeParser(oidResults.rows[0].typelem, AGTypeParse)
}

const ID_SEPARATOR = '|';


function _getEntityType(vertex) {
  switch (vertex.category) {
    case 'businessModule':
      return 'businessModule';
    case 'microService':
      return 'microService';
    case 'systemModule':
      return 'systemModule';
    default:
      return vertex.type;
  }
}

function _getEntityCategory(entity_type) {
  switch (entity_type) {
    case 'businessModule':
      return 'businessModule';
    case 'microService':
      return 'microService';
    case 'systemModule':
      return 'systemModule';
    default:
      return 'component';
  }
}

function vertexToPojo(vertex) {
  if (!vertex) {
    return;
  }
  const n = vertex.n;
  if (!n) {
    // Result from relation db
    return;
  }

  const properties = n.get('properties') || new Map();

  return {
    id: n.get('id'),
    name: properties.get('entity_name'),
    category: _getEntityCategory(properties.get('entity_type')),
    type: properties.get('type'),
    microService: properties.get('micro_service'),
    systemModule: properties.get('system_module'),
    sourceCode: properties.get('content'),
    description: properties.get('description'),
    public: properties.get('public'),
    visibility: properties.get('visibility'),
    fileName: properties.get('file_path'),
    language: properties.get('language'),
    startRow: properties.get('start_row'),
    endRow: properties.get('end_row')
  };
}

function edgeToPojo(edge) {
  if (!edge) {
    return;
  }

  return {
    id: edge.id,
    label: edge.content || 'Uses',
    outVertexId: edge.target_id,
    inVertexId: edge.source_id,
    microService: edge.micro_service || ''
  };
}

function _hash(value) {
  // sha 256 hash function
  return crypto.createHash('sha256').update(value).digest('hex');
}

function _formatProperties(properties) {
  const props = [];
  for (const [key, value] of Object.entries(properties)) {
    // if (key === 'sourceCode' || key === 'content') {
    //   continue;
    // }
    const jsonValue = JSON.stringify(value);
    props.push(`\`${key}\`: ${_escapeParameterInGraphQuery(jsonValue)}`);
  }
  return `{${props.join(', ')}}`;
}

function vertexToAgProperties(workspace, vertex, entityId, currentTime) {
  const nodeProperties = {
    category: vertex.category,
    entity_id: entityId,
    entity_name: vertex.name,
    type: vertex.type,
    workspace: workspace,
    description: vertex.description || '',
    update_time: currentTime
  };

  switch (vertex.category) {
    case 'systemModule':
      nodeProperties.micro_service = vertex.microService || '';
      break;
    case 'component':
      nodeProperties.content = vertex.sourceCode || '';
      nodeProperties.description = vertex.description || '';
      nodeProperties.micro_service = vertex.microService || '';
      nodeProperties.system_module = vertex.systemModule || '';
      nodeProperties.language = vertex.language || '';
      nodeProperties.public = vertex.public || false;
      nodeProperties.visibility = vertex.visibility || '';
      nodeProperties.file_path = vertex.fileName || '';
      nodeProperties.start_row = vertex.startRow || 0;
      nodeProperties.end_row = vertex.endRow || 0;
      break;
  }

  return _formatProperties(nodeProperties);
}

function _escapeParameterInGraphQuery(param) {
  if (typeof param === 'string') {
    return param.replace(/'/g, "\\'");
  }
  return param;
}

class PostgresDB {
  constructor({ host, port, database, username, password, workspace = 'default', graphName = 'codegraph' }) {
    this.client = new Client({ host, port, database, user: username, password, ssl: { rejectUnauthorized: false } });
    this.workspace = workspace;
    this.graphName = graphName;
  }

  async initGraph() {
    await this.client.connect();
    await setAGETypes(this.client, types);

    const command = `
CREATE TABLE IF NOT EXISTS LIGHTRAG_VDB_ENTITY (
  id VARCHAR(255),
  workspace VARCHAR(255),
  entity_name VARCHAR(255),
  content TEXT,
  description TEXT NULL,
  entity_type VARCHAR(255),
  micro_service VARCHAR(255) NULL,
  system_module TEXT NULL,
  lang VARCHAR(255) NULL,
  public BOOLEAN default false,
  visibility VARCHAR(255) NULL,
  start_row INTEGER default 0,
  end_row INTEGER default 0,
  create_time TIMESTAMP(0) WITH TIME ZONE,
  update_time TIMESTAMP(0) WITH TIME ZONE,
  file_path TEXT NULL,
  CONSTRAINT LIGHTRAG_VDB_ENTITY_PK PRIMARY KEY (workspace, id)
);

CREATE TABLE IF NOT EXISTS LIGHTRAG_VDB_RELATION (
  id VARCHAR(255),
  workspace VARCHAR(255),
  source_id VARCHAR(256),
  target_id VARCHAR(256),
  micro_service VARCHAR(255) NULL,
  content TEXT,
  create_time TIMESTAMP(0) WITH TIME ZONE,
  update_time TIMESTAMP(0) WITH TIME ZONE,
  file_path TEXT NULL,
  CONSTRAINT LIGHTRAG_VDB_RELATION_PK PRIMARY KEY (workspace, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT * FROM information_schema.columns
     WHERE table_name='lightrag_vdb_entity' AND column_name='description'
  ) THEN
    alter table LIGHTRAG_VDB_ENTITY add description TEXT null;
    alter table LIGHTRAG_VDB_ENTITY add category varchar(255) null;
    alter table LIGHTRAG_VDB_ENTITY add entity_type varchar(255) null;
    alter table LIGHTRAG_VDB_ENTITY add micro_service varchar(255) null;
    alter table LIGHTRAG_VDB_ENTITY add system_module TEXT null;
    alter table LIGHTRAG_VDB_ENTITY add lang varchar(255) null;
    alter table LIGHTRAG_VDB_ENTITY add public BOOLEAN default false;
    alter table LIGHTRAG_VDB_ENTITY add visibility varchar(255) null;
    alter table LIGHTRAG_VDB_ENTITY add start_row INTEGER default 0;
    alter table LIGHTRAG_VDB_ENTITY add end_row INTEGER default 0;

    alter table LIGHTRAG_VDB_RELATION add micro_service varchar(255) null;
  END IF;
END $$;


DO $$
BEGIN
  IF NOT EXISTS (SELECT * FROM ag_catalog.ag_graph WHERE name = '${this.graphName}') THEN
    SELECT create_graph('${this.graphName}');
    SELECT create_vlabel('${this.graphName}', 'base');
    SELECT create_elabel('${this.graphName}', 'DIRECTED');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vertex_idx_node_id ON ${this.graphName}."_ag_label_vertex" (ag_catalog.agtype_access_operator(properties, '"entity_id"'::agtype));
CREATE INDEX IF NOT EXISTS edge_sid_idx ON ${this.graphName}."_ag_label_edge" (start_id);
CREATE INDEX IF NOT EXISTS edge_eid_idx ON ${this.graphName}."_ag_label_edge" (end_id);
CREATE INDEX IF NOT EXISTS edge_seid_idx ON ${this.graphName}."_ag_label_edge" (start_id,end_id);
CREATE INDEX IF NOT EXISTS directed_p_idx ON ${this.graphName}."DIRECTED" (id);
CREATE INDEX IF NOT EXISTS directed_eid_idx ON ${this.graphName}."DIRECTED" (end_id);
CREATE INDEX IF NOT EXISTS directed_sid_idx ON ${this.graphName}."DIRECTED" (start_id);
CREATE INDEX IF NOT EXISTS directed_seid_idx ON ${this.graphName}."DIRECTED" (start_id,end_id);
CREATE INDEX IF NOT EXISTS entity_p_idx ON ${this.graphName}."base" (id);
CREATE INDEX IF NOT EXISTS entity_idx_node_id ON ${this.graphName}."base" (ag_catalog.agtype_access_operator(properties, '"entity_id"'::agtype));
CREATE INDEX IF NOT EXISTS entity_node_id_gin_idx ON ${this.graphName}."base" using gin(properties);

CREATE INDEX IF NOT EXISTS entity_idx_entity_name ON ${this.graphName}."base" (ag_catalog.agtype_access_operator(properties, '"entity_name"'::agtype));
CREATE INDEX IF NOT EXISTS entity_idx_micro_service ON ${this.graphName}."base" (ag_catalog.agtype_access_operator(properties, '"micro_service"'::agtype));
CREATE INDEX IF NOT EXISTS entity_idx_system_module ON ${this.graphName}."base" (ag_catalog.agtype_access_operator(properties, '"system_module"'::agtype));

DO $$
BEGIN
  IF NOT EXISTS (SELECT * FROM ag_catalog.ag_graph WHERE name = '${this.graphName}') THEN
    ALTER TABLE ${this.graphName}."DIRECTED" CLUSTER ON directed_sid_idx;
  END IF;
END $$;
`;

    await this.client.query(command);

    await this.client.query('SET search_path TO ag_catalog, "$user", public;');
    return true;
  }

  async startSession() {
    await this.client.query('BEGIN');
    return 'default_session';
  }

  async commitSession(sessionId) {
    await this.client.query('COMMIT');
  }

  async rollbackSession(sessionId) {
    await this.client.query('ROLLBACK');
  }

  _getEntityId(vertex) {
    // systemModule could be quite long and cause the id to exceed 255 characters
    // It can be filePath name for javascript, and fullly qualified class name for Java
    let id = vertex.name;
    switch (vertex.category) {
      case 'systemModule':
        id = `${vertex.microService}${ID_SEPARATOR}${vertex.name}`;
      case 'component':
        id = `${vertex.microService}${ID_SEPARATOR}${vertex.systemModule}${ID_SEPARATOR}${vertex.name}`;
    }

    if (id.length > 255) {
      id = _hash(id);
    }
    return id;
  }

  async _queryOne(query, params, convertFn = vertexToPojo) {
    const result = await this.client.query(query, params);
    if (result && result.rows && result.rows.length > 0) {
      return convertFn(result.rows[0]);
    }

    return null;
  }

  async _queryMany(query, params, convertFn = vertexToPojo) {
    const result = await this.client.query(query, params);
    if (result && result.rows && result.rows.length > 0) {
      return result.rows.map(convertFn);
    }

    return [];
  }

  async _upsertGraphNode(vertex, entityId, currentTime) {
    const formattedProperties = vertexToAgProperties(this.workspace, vertex, entityId, currentTime);

    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
      MERGE (n:base {entity_id: "${entityId}"})
      SET n += ${formattedProperties}
      RETURN n
    $$) AS (n agtype)`;

    const result = await this._queryOne(graphQuery);
    return result;
  }

  async createVertex(vertex, sessionId) {
    const currentTime = new Date();
    const entityId = this._getEntityId(vertex);
    const entityType = _getEntityType(vertex);

    const query = `INSERT INTO LIGHTRAG_VDB_ENTITY (
      id, workspace, entity_name, content, description, entity_type, category,
      micro_service, system_module, lang, public, visibility, file_path,
      start_row, end_row, create_time, update_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (workspace, id)
    DO UPDATE SET
      content = EXCLUDED.content,
      description = EXCLUDED.description,
      entity_type = EXCLUDED.entity_type,
      public = EXCLUDED.public,
      visibility = EXCLUDED.visibility,
      file_path = EXCLUDED.file_path,
      start_row = EXCLUDED.start_row,
      end_row = EXCLUDED.end_row,
      update_time = EXCLUDED.update_time
    `;

    const params = [
      entityId,
      this.workspace,
      vertex.name,
      vertex.sourceCode,
      vertex.description,
      entityType,
      vertex.category || 'component',
      vertex.microService,
      vertex.systemModule,
      vertex.language,
      vertex.public || false,
      vertex.visibility || '',
      vertex.fileName || '',
      vertex.startRow || 0,
      vertex.endRow || 0,
      currentTime,
      currentTime
    ];

    await this._queryOne(query, params);

    return this._upsertGraphNode(vertex, entityId, currentTime);
  }

  async updateVertex(vertex, sessionId) {
    if (!vertex.id) {
      throw new Error('Vertex id is required for update');
    }

    const entityId = this._getEntityId(vertex);
    const currentTime = new Date();
    let query;
    let params;

    switch (vertex.category) {
      case 'component':
        query = "UPDATE LIGHTRAG_VDB_ENTITY SET content = $1, description = $2, entity_type = $3, public = $4, visibility = $5, file_path = $6, lang = $7, start_row = $8, end_row = $9, update_time = $10 WHERE workspace = $11 AND id = $12";
        params = [
          vertex.sourceCode,
          vertex.description,
          _getEntityType(vertex),
          vertex.public || false,
          vertex.visibility || '',
          vertex.fileName || '',
          vertex.language || '',
          vertex.startRow || 0,
          vertex.endRow || 0,
          currentTime,
          this.workspace,
          entityId
        ];
        break;
      case 'systemModule':
        query = "UPDATE LIGHTRAG_VDB_ENTITY SET description = $1, update_time = $2 WHERE workspace = $3 AND id = $4";
        params = [ vertex.description || '', currentTime, this.workspace, entityId ];
        break;
      default:
        query = "UPDATE LIGHTRAG_VDB_ENTITY SET description = $1, update_time = $2 WHERE workspace = $3 AND id = $4";
        params = [ vertex.description || '', currentTime, this.workspace, entityId ];
    }

    await this._queryOne(query, params);

    return this._upsertGraphNode(vertex, entityId, currentTime);
  }

  async getVertex(vertex, sessionId) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    let graphQuery;

    switch (vertex.category) {
      case 'component':
        graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
        MATCH (n:base) 
        WHERE n.entity_name = '${_escapeParameterInGraphQuery(vertex.name)}' 
        AND n.micro_service = '${vertex.microService || ''}'
        AND n.system_module = '${_escapeParameterInGraphQuery(vertex.systemModule) || ''}'
        AND n.workspace = '${this.workspace}'
        RETURN n
      $$) AS (n agtype)`;
        break;
      default:
        graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
        MATCH (n:base) 
        WHERE n.entity_name = '${_escapeParameterInGraphQuery(vertex.name)}' 
        AND n.category = '${vertex.category}'
        AND n.workspace = '${this.workspace}'
        RETURN n
      $$) AS (n agtype)`;
        break;
    }

    return this._queryOne(graphQuery);
  }

  async getVerticesByIds(ids) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return [];
    }

    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
      MATCH (n:base) 
      WHERE id(n) IN [${ids.join(',')}]
      AND n.workspace = '${this.workspace}'
      RETURN n
    $$) AS (n agtype)`;

    return this._queryMany(graphQuery);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    let graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
    MATCH (n:base) 
    WHERE n.entity_name =~ '.*${name}.*'
    AND n.language = '${language}'
    AND n.workspace = '${this.workspace}'`;

    if (systemModule) {
      graphQuery += `
    AND n.system_module =~ '.*${systemModule}.*'`;
    }

    graphQuery += `
    RETURN n
  $$) AS (n agtype)`;

    return this._queryMany(graphQuery);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
    MATCH (n:base) 
    WHERE n.system_module =~ '.*${systemModule}.*'
    AND n.start_row <= ${rowNumber}
    AND n.end_row >= ${rowNumber}
    AND n.workspace = '${this.workspace}'
    RETURN n
  $$) AS (n agtype)`;

    return this._queryMany(graphQuery);
  }

  async getVerticesByCategory(category) {
    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
      MATCH (n:base) 
      WHERE n.workspace = '${this.workspace}'
      AND n.category = '${category}'
      RETURN n
    $$) AS (n agtype)`;

    return this._queryMany(graphQuery);
  }

  async getVerticesByTypesWithDescription(category, types) {
    if (!types || !Array.isArray(types) || types.length === 0) {
      return [];
    }
    
    const placeholders = types.map((_, idx) => `$${idx + 3}`).join(', ');
    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
      MATCH (n:base) 
      WHERE n.workspace = '${this.workspace}'
      AND n.category = '${category}'
      AND n.type IN [${placeholders}]
      AND n.description IS NOT NULL
      RETURN n
    $$) AS (n agtype)`;

    return this._queryMany(graphQuery, types, vertexToPojo);
  }

  async createEdgeByVertices(fromVertex, toVertex, sessionId) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }

    const source_entity_id = this._getEntityId(fromVertex);
    const target_entity_id = this._getEntityId(toVertex);
    const id = _hash(`${source_entity_id}${ID_SEPARATOR}${target_entity_id}`);
    const currentTime = new Date();

    const query = `INSERT INTO LIGHTRAG_VDB_RELATION (id, workspace, source_id, target_id, micro_service, content, create_time, update_time)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (workspace, id)
    DO UPDATE SET
      content = EXCLUDED.content,
      update_time = EXCLUDED.update_time`;

    const params = [id, this.workspace, source_entity_id, target_entity_id, fromVertex.microService || '', 'Uses', currentTime, currentTime];

    await this._queryOne(query, params, edgeToPojo);

    // Create the edge in the graph
    const edgeProperties = {
      id: id,
      label: 'Uses',
      workspace: this.workspace,
      micro_service: fromVertex.microService || '',
      create_time: currentTime,
      update_time: currentTime
    };

    const formattedProperties = _formatProperties(edgeProperties);

    const createEdgeQuery = `SELECT * FROM cypher('${this.graphName}', $$
      MATCH (from:base {entity_id: "${source_entity_id}"})
      MATCH (to:base {entity_id: "${target_entity_id}"})
      CREATE (from)-[r:DIRECTED ${formattedProperties}]->(to)
      RETURN r
    $$) AS (r agtype)`;

    return this._queryOne(createEdgeQuery, [], edgeToPojo);
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const source_entity_id = this._getEntityId(fromVertex);
    const target_entity_id = this._getEntityId(toVertex);
    const query = `SELECT * FROM cypher('${this.graphName}', $$
      MATCH (from:base {entity_id: "${source_entity_id}"})-[r:DIRECTED]->(to:base {entity_id: "${target_entity_id}"})
      RETURN r
    $$) AS (r agtype)`;

    return this._queryOne(query, [], edgeToPojo);
  }

  _getCypherVertexQuery(vertex) {
    // 安全处理顶点名称，防止 SQL 注入
    const safeVertexName = _escapeParameterInGraphQuery(vertex.name);

    // 构建基本的 Cypher 查询来匹配顶点
    let query = `MATCH (n:base) WHERE n.entity_name = '${safeVertexName}' AND n.category = '${vertex.category}' AND n.workspace = '${this.workspace}'`;

    // 为组件类型顶点添加系统模块过滤器
    if (vertex.category === 'component' && vertex.systemModule) {
      const safeSystemModule = _escapeParameterInGraphQuery(vertex.systemModule);
      query += ` AND n.system_module = '${safeSystemModule}'`;

      // 如果有微服务信息，也添加到过滤条件中
      if (vertex.microService) {
        const safeMicroService = _escapeParameterInGraphQuery(vertex.microService);
        query += ` AND n.micro_service = '${safeMicroService}'`;
      }
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
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    // 获取起始顶点的 Cypher 查询
    const vertexQuery = this._getCypherVertexQuery(vertex);

    // 构建过滤条件
    let filterConditions = [];

    // 添加类型过滤
    if (type) {
      filterConditions.push(`target.type = '${type}'`);
    }

    // 添加源代码过滤
    if (options.hasSourceCode) {
      filterConditions.push(`target.content IS NOT NULL AND target.content <> ''`);
    }

    // 添加行数过滤
    if (options.minFnRowCount > 0) {
      filterConditions.push(`(target.end_row - target.start_row) >= ${options.minFnRowCount}`);
    }

    // 组合过滤条件
    const whereClause = filterConditions.length > 0
      ? `WHERE ${filterConditions.join(' AND ')}`
      : '';

    // 设置深度限制
    const pathDepth = options.depth > 0 ? `1..${options.depth}` : '1..';

    // 确定关系方向
    const relationDirection = direction === 'out' ? `-[r:DIRECTED*${pathDepth}]->` : `<-[r:DIRECTED*${pathDepth}]-`;

    // 构建完整的 Cypher 查询
    const graphQuery = `SELECT * FROM cypher('${this.graphName}', $$
      ${vertexQuery}
      MATCH path = (n)${relationDirection}(target:base)
      ${whereClause}
      RETURN r
    $$) AS (r agtype)`; // If return path instead of r, it will return the whole path object

    // 执行查询
    const result = await this._queryMany(graphQuery, [], (row) => row);

    // 处理结果
    const paths = [];

    for (const row of result) {
      const pathData = [];
      for (const edge of row.r) {
        if (!pathData.includes(edge.get("start_id"))) {
          pathData.push(edge.get("start_id"));
        }
        if (!pathData.includes(edge.get("end_id"))) {
          pathData.push(edge.get("end_id"));
        }
      }
      paths.push({ result: pathData });
    }

    return this._removeSubPaths(paths, options.depth);
  }

  async getDescendants(vertex, type, options) {
    return this._traverseGraph('out', vertex, type, options);
  }

  async getAncestors(vertex, type, options) {
    return this._traverseGraph('in', vertex, type, options);
  }
}

export default PostgresDB;

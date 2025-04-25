import _ from 'lodash';
import { MongoClient, BSON } from 'mongodb';

function vertexToPojo(vertex) {
  if (!vertex) {
    return;
  }

  return {
    id: vertex._id.toString(),
    category: vertex.category,
    name: vertex.name,
    type: vertex.type,
    description: vertex.description,
    microService: vertex.microService,
    systemModule: vertex.systemModule,
    sourceCode: vertex.sourceCode,
    language: vertex.language,
    fileName: vertex.fileName,
    visibility: vertex.visibility,
    public: vertex.public || false,
    startRow: vertex.startRow,
    endRow: vertex.endRow,
    businessModules: vertex.businessModules || []
  };
}

function edgeToPojo(edge) {
  if (!edge) {
    return;
  }

  return {
    id: edge._id.toString(),
    label: edge.label,
    toVertexId: edge.toVertexId.toString(),
    fromVertexId: edge.fromVertexId.toString(),
    microService: edge.microService || ''
  };
}

class MongoDB {
  constructor({ host = 'localhost', port = 27017, database, username, password }) {
    const auth = username && password ? `${username}:${encodeURIComponent(password)}@` : '';
    const uri = `mongodb://${auth}${host}:${port}`;
    this.client = new MongoClient(uri);
    this.dbName = database;
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    // Create collections for vertices and edges
    this.components = this.db.collection('components');
    this.uses = this.db.collection('uses');
  }

  async initGraph() {
    await this.connect();
    
    // Create indexes for efficient querying
    await this.components.createIndex({ category: 1 });
    await this.components.createIndex({ name: 1 });
    await this.components.createIndex({ 
      microService: 1, 
      systemModule: 1, 
      name: 1 
    }, { unique: true });
    
    await this.uses.createIndex({ 
      toVertexId: 1, 
      fromVertexId: 1, 
      label: 1 
    }, { unique: true });
    
    return true;
  }

  async startSession() {
    // TODO: MongoDB handles transactions at the client level
    // return this.client.startSession();
  }

  async commitSession(session) {
    if (session) {
      await session.commitTransaction();
      await session.endSession();
    }
  }

  async rollbackSession(session) {
    if (session) {
      await session.abortTransaction();
      await session.endSession();
    }
  }

  async createVertex(vertex) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    const doc = {
      category: _.lowerFirst(vertex.category),
      name: vertex.name,
      type: vertex.type
    };

    switch (doc.category) {
      case 'systemModule':
        if (!vertex.microService) {
          throw new Error('MicroService is required for systemModule vertex');
        }
        Object.assign(doc, {
          microService: vertex.microService,
          businessModules: vertex.businessModules || [],
          fileName: vertex.fileName,
          language: vertex.language
        });
        break;
      case 'component':
        if (!vertex.microService || !vertex.systemModule) {
          throw new Error('MicroService and systemModule are required for component vertex');
        }
        Object.assign(doc, {
          microService: vertex.microService,
          systemModule: vertex.systemModule,
          sourceCode: vertex.sourceCode,
          description: vertex.description,
          public: vertex.public || false,
          visibility: vertex.visibility,
          fileName: vertex.fileName,
          language: vertex.language,
          startRow: vertex.startRow,
          endRow: vertex.endRow
        });
        break;
    }

    const result = await this.components.insertOne(doc);
    doc._id = result.insertedId;
    return vertexToPojo(doc);
  }

  async updateVertex(vertex) {
    if (!vertex.id) {
      throw new Error('Vertex id is required for update');
    }

    const update = {
      $set: {
        type: vertex.type
      }
    };

    switch (vertex.category) {
      case 'component':
        Object.assign(update.$set, {
          sourceCode: vertex.sourceCode,
          description: vertex.description,
          public: vertex.public,
          visibility: vertex.visibility,
          fileName: vertex.fileName,
          language: vertex.language,
          startRow: vertex.startRow,
          endRow: vertex.endRow
        });
        break;
      case 'systemModule':
        Object.assign(update.$set, {
          businessModules: vertex.businessModules,
          fileName: vertex.fileName,
          language: vertex.language
        });
        break;
    }

    const result = await this.components.findOneAndUpdate(
      { _id: BSON.ObjectId.createFromHexString(vertex.id) },
      update,
      { returnDocument: 'after' }
    );

    return vertexToPojo(result);
  }

  async getVertex(vertex) {
    if (!vertex.name || !vertex.category) {
      throw new Error('Vertex name and category are required');
    }

    const query = {
      category: vertex.category,
      name: vertex.name
    };

    if (vertex.category === 'systemModule') {
      if (!vertex.microService) {
        throw new Error('MicroService is required for systemModule vertex');
      }
      query.microService = vertex.microService;
    } else if (vertex.category === 'component') {
      if (!vertex.microService || !vertex.systemModule) {
        throw new Error('MicroService and systemModule are required for component vertex');
      }
      query.microService = vertex.microService;
      query.systemModule = vertex.systemModule;
    }

    const result = await this.components.findOne(query);
    return vertexToPojo(result);
  }

  async getVerticesByIds(ids) {
    const objectIds = ids.map(id => BSON.ObjectId.createFromHexString(id));
    const results = await this.components.find({
      _id: { $in: objectIds }
    }).toArray();
    return results.map(vertexToPojo);
  }

  async getComponentByNameAndLanguage(name, language, systemModule) {
    const query = {
      category: 'component',
      name: { $regex: name, $options: 'i' },
      language: language
    };

    if (systemModule) {
      query.systemModule = { $regex: systemModule, $options: 'i' };
    }

    const results = await this.components.find(query).toArray();
    return results.map(vertexToPojo);
  }

  async getComponentByRowNumber(systemModule, rowNumber) {
    if (!Number.isInteger(rowNumber) || rowNumber < 0) {
      throw new Error('Row number must be a positive integer');
    }

    const query = {
      category: 'component',
      systemModule: { $regex: systemModule, $options: 'i' },
      startRow: { $lte: rowNumber },
      endRow: { $gte: rowNumber }
    };

    const results = await this.components.find(query).toArray();
    return results.map(vertexToPojo);
  }

  async getVerticesByCategory(category) {
    const results = await this.components.find({
      category
    }).toArray();
    return results.map(vertexToPojo);
  }

  async getVerticesByTypesWithDescription(category, types) {
    const results = await this.components.find({
      category,
      type: { $in: types },
      description: { $exists: true, $ne: null }
    }).toArray();
    return results.map(vertexToPojo);
  }

  async createEdgeByVertices(fromVertex, toVertex) {
    const existingEdge = await this.getEdgeByVertices(fromVertex, toVertex);
    if (existingEdge) {
      return existingEdge;
    }

    const edge = {
      label: 'Uses',
      fromVertexId: BSON.ObjectId.createFromHexString(fromVertex.id),
      toVertexId: BSON.ObjectId.createFromHexString(toVertex.id),
      fromVertexCategory: fromVertex.category,
      toVertexCategory: toVertex.category,
      fromVertexType: fromVertex.type,
      toVertexType: toVertex.type,
      microService: fromVertex.microService || ''
    };

    const result = await this.uses.insertOne(edge);
    edge._id = result.insertedId;
    return edgeToPojo(edge);
  }

  async getEdgeByVertices(fromVertex, toVertex) {
    const result = await this.uses.findOne({
      label: 'Uses',
      fromVertexId: BSON.ObjectId.createFromHexString(fromVertex.id),
      toVertexId: BSON.ObjectId.createFromHexString(toVertex.id)
    });
    return edgeToPojo(result);
  }

  _appendPath(paths, startVertexId, connectFrom, connectTo) {
    const followingVertexIds = _.remove(paths, path => path[connectFrom] === startVertexId);

    return _.map(followingVertexIds, connectTo);
  }

  _constructPaths(paths, startVertexId, connectFrom, connectTo) {
    const currentLevel = _.remove(paths, path => path[connectFrom] === startVertexId);
    const result = _.reduce(currentLevel, (acc, path) => {
      const currentPath = [path[connectFrom], path[connectTo]];
      const pathsAfter = this._appendPath(paths, path[connectTo], connectFrom, connectTo);

      if (pathsAfter.length === 0) {
        acc.push({
          paths: currentPath
        });
        return acc;
      }

      pathsAfter.forEach(pathAfter => {
        acc.push({
          paths: currentPath.concat(pathAfter),
        })
      });

      return acc;
    }, []);

    return result;
  }

  async _traverseGraph(direction, vertex, type, options) {
    const startVertex = await this.getVertex(vertex);
    if (!startVertex) return [];
    
    // Convert string ID to ObjectId if needed
    const startId = startVertex.id;
    
    // Configure direction-specific parameters for $graphLookup
    const connectFrom = direction === 'out' ? 'fromVertexId' : 'toVertexId';
    const connectTo = direction === 'out' ? 'toVertexId' : 'fromVertexId';

    // Main aggregation pipeline using $graphLookup
    const lookupOptions = {
      from: 'uses',                    // Edge collection
      startWith: '$_id',               // Start with current vertex ID
      connectFromField: connectTo,     // Connect from vertex ID
      connectToField: connectFrom,     // Connect to edge's source/target field based on direction
      depthField: 'depth',             // Include depth information
      as: 'paths'                      // Store connected edges here
    };
    if (options.depth > 0) {
      lookupOptions.maxDepth = options.depth - 1;
    }
    if (type) {
      lookupOptions.restrictSearchWithMatch = { fromVertexType: type, toVertexType: type };
    }

    const pipeline = [
      {
        $match: { _id: BSON.ObjectId.createFromHexString(startId) }
      },
      {
        $graphLookup: lookupOptions
      },
      {
        $project: {
          _id: 1,
          name: 1,
          category: 1,
          paths: 1
        }
      }
    ];

    // Execute the aggregation
    const results = await this.components.aggregate(pipeline).toArray();
    
    // Handle empty results
    if (results.length === 0 || !results[0].paths || results[0].paths.length === 0) {
      return [];
    }

    const allIds = [startId];
    let paths = results[0].paths.map(path => {
      const fromVertexId = path.fromVertexId.toString();
      const toVertexId = path.toVertexId.toString();
      if (allIds.indexOf(fromVertexId) === -1) {
        allIds.push(fromVertexId);
      }
      if (allIds.indexOf(toVertexId) === -1) {
        allIds.push(toVertexId);
      }
      return {
        fromVertexId,
        toVertexId
      }
    });

    const vertices = await this.getVerticesByIds(allIds);
    const verticeIdMatched = _.reduce(vertices, (ids, vertex) => {
      if (options.hasSourceCode && (!vertex.sourceCode || vertex.sourceCode.length === 0)) {
        return ids;
      }
      if (options.minFnRowCount && vertex.startRow && vertex.endRow && (vertex.endRow - vertex.startRow) < options.minFnRowCount) {
        return ids;
      }

      ids.push(vertex.id);
      return ids;
    }, []);
    paths = paths.filter(path => {
      return verticeIdMatched.includes(path[connectTo]);
    });

    // Format paths to match expected output format
    return this._constructPaths(paths, startId, connectFrom, connectTo);
  }

  async getDescendants(vertex, type, options) {
    return this._traverseGraph('out', vertex, type, options);
  }

  async getAncestors(vertex, type, options) {
    return this._traverseGraph('in', vertex, type, options);
  }

  async deleteAllByMicroService(microService) {
    // Delete all edges connected to components in this microservice
    await this.uses.deleteMany({ microService });

    // Delete all components in the microservice
    await this.components.deleteMany({
      microService
    });

    // Delete the microservice itself
    await this.components.deleteOne({
      category: 'microService',
      name: microService
    });

    return true;
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }
}

export default MongoDB;

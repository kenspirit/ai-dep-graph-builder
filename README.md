## Objective

Code dependency graph is always wanted, at least for me.

From Top-Down direction, it's great to know which parts of the system are needed to change when facing a business requirement change.  

From Bottom-Up direction, it's necessary to check which parts of the system might be impacted when one change is made.

Knowing code dependency can have better impact analysis and effort estimation.

This project is to build the code dependency graph with the asistance of AI.  Due to the dynamic characteristics of JavaScript, the dependency graph might not be completely accurate but we try to make it closed.


## Repo Components

This tool includes four major components:
1. API for graph data (Node, Edge) manipulation against Graph Database
  - Exported from `index.js`, mainly includes `GraphBuilder`, `AiProvider`, `AstParser` and some facilitated APIs
2. AI adaptors
  - Pre-defined `AiProvider` under directory `ai-providers`.
3. Sample project providing restful API for graph component manipulation and visualization UI
  - Under directory `sample-project`.  NO AI related feature.
4. Graph data generation script for the sample project.
  - Script `repo.graph.builder.js` which builds code dependency graph for the sample project as a demonstration for API usage.


## Usage

### JavaScript project

Invokes API provided by `index.js` like `repo.graph.builder.js` to contruct the code dependency and store to your graph database.

Sample configuration should be provided as:

```json
{
  graph: {
    type: 'ARCADEDB',
    connectionOptions: {
      host: '127.0.0.1',
      port: 2480,
      database: '',
      username: '',
      password: ''
    }
  },
  aiProviders: {
    MOONSHOT: {
      apiKey: 'key-1'
    },
    BIGMODEL: {
      apiKey: 'key-2'
    }
  }
}
```

### Non-JavaScript project

Invokes RESTful API through starting up the web service under directory `sample-project` through steps:  
1. Run `npm install`
2. Run `npm build`
3. Run `node server.js`

Sample configuration should be provided as below.  `aiProviders` is not needed as it does not contain any AI related feature:

```json
{
  graph: {
    type: 'ARCADEDB',
    connectionOptions: {
      host: '127.0.0.1',
      port: 2480,
      database: '',
      username: '',
      password: ''
    }
  }
}
```

## Code Dependency Graph Design Explained

### Edge (Connection between Vertices)

There is ONLY one Edge type `Uses`.  It's used to connect:
- From Micro-Service to System Module
- From System Module to Component
- From Component to Component

A `Uses` B means that A `depends` on B, which is `A -> B`.  When this relationship exists, if B is updated, A is potentially affected.  Business Module, Micro-Service, System Module are mainly used as grouping purpose.  The real dependency or impact actually depends on `Component -> Component` relationship tracking.  Detail explanation of different Vertex categories is in following sections.


### Vertex (Node) categories in Dependency Graph

Vertex has three basic properties:
- name: Brief name of the Vertex and should be unique in same category
- type: Type identifier within same category if required.
- description: Long description of one Vertex.  It must be in detail, especially for Business Module, System Module, Function type Component, etc.  It is provided to AI as RAG with your question so that it can reason out which vertices to look up.

Vertex has four categories:
- Business Module
- Micro-Service
- System Module
- Component

#### Business Module

For example, when one BA asked "I want to add wildcast search support on the Organization name in Organization Search Page", the AI should knows it's talking about the Business Module for Organization, and then the graph engine can retrieve all related, especially children, Vertices starting from this Business Module Vertex.

#### Micro-Service

This is just from technical perspective, especially for the project which separates frontend and backend.  Making it one level of Vertex has better visual output as a tree starting from it, to System Module, and then down to the Component Vertices.


#### System Module

Grouping code files by Roles or by Feature/Module are two popular choices.  This Dependency Graph project would prefer the second choice, but it does not affect your usage only if you name the Vertex in the pattern suits your project.  Name of the System Module Vertex could simply be the folder name, file name or the combination of it.

System Module Vertex has `businessModule` and `microService` properties for graph building.

By Roles:
```
│   ├── app.js
│       ├── controllers
│       │   ├── inquiryController.js
│       │   └── updateController.js
│       ├── dbaccessors
│       │   └── dataAccessor.js
│       ├── models
│       │   └── order.js
│       ├── routes
│       │   └── routes.js
│       └── services
│           └── inquiryService.js
```

By Feature/Module with optional sub-level roles' separation:
```
│   ├── app.js
│   ├── organizations
│   │   ├── organization.controller.js
│   │   ├── organization.routes.js
│   │   └── catalog.routes.js
│   └── orders
│       ├── controllers (optional separation)
│       │   ├── orderInquiryController.js
│       │   └── orderUpdateController.js
│       ├── dbaccessors
│       │   └── orderDataAccessor.js
│       ├── models
│       │   └── order.js
│       ├── routes
│       │   └── orderRoutes.js
│       └── services
│           └── orderInquiryService.js
```

#### Component

This is the actual Vertex that tracks code dependency.  It has extra properties beside `name`, `type`, `description`:

- name: It can be Function Name / Field Name / API URL / Queue Name / Table Name / Store Procedure Name
- type: It can be `Function` / `Field` / `Interface` (API / Queue / Table / Store Procedure), etc.
- microService: Part of the unique constraint of Component.
- systemModule: Part of the unique constraint of Component.  Easier CRUD and graph search starting point.
- sourceCode: Source code of this component.  It can be function signature & body, API route validation code, etc.


### Graph Building

To build a code dependency graph for a project, it should probably go through below steps:
- Create `Business Module` type Vertices.  These vertices should normally be prepared by business analysis and they probabaly cannot be done through codebase scan.
- Create `Micro-Service` type Vertices.  These vertices are normally 1-1 mapping to the code repositories.
- Create `System Module` and `Component` type Vertices.  These should be done automatically by code scan.
  - Take `repo.graph.builder` as a reference.


Sample Vertices:

```javascript
const businessModuleVertices = [
  {
    name: 'Organization',
    category: 'businessModule',
    description: 'Organization Management',
    type: 'Organization'
  },
  {
    name: 'Metering',
    category: 'businessModule',
    description: 'Metering Report',
    type: 'Reporting'
  }
];

const microServiceVertices = [
  {
    name: 'platform_console',
    category: 'microService',
    description: 'Platform Console',
    type: 'frontend'
  },
  {
    name: 'platform_console_service',
    category: 'microService',
    description: 'Platform Console Service',
    type: 'backend'
  }
];

const systemModuleVertices = [
  {
    category: 'systemModule',
    businessModules: ['Organization'],
    microService: 'platform_console_service',
    name: 'organization.routes.js',
    type: 'Class',
    description: 'API Routes for Organization API',
    dependencies: [
      {
        category: 'component',
        name: 'POST /organizations/:orgId/roles',
        type: 'api',
        description: 'API Routes for adding memberRoles for Organization',
        sourceCode: `...`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['Organization', 'Metering'],
    microService: 'platform_console_service',
    name: 'organization.services.js',
    type: 'Class',
    description: 'Service Class for Organization',
    dependencies: [
      {
        category: 'component',
        name: 'addMemberRoles',
        type: 'function',
        description: 'Service API to add memberRoles for Organization',
        sourceCode: `...`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['System'],
    microService: 'platform_console_service',
    name: 'repository.util.js',
    type: 'Class',
    description: 'Repository Utility',
    dependencies: [
      {
        category: 'component',
        name: 'updateAll',
        type: 'function',
        description: 'Repository API for updating data',
        sourceCode: `...`
      }
    ]
  }
];
```

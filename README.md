## Objective

Code dependency graph is always wanted, at least for me.

From Top-Down direction, it's great to know what parts of the system are needed to change when facing a business requirement change.  

From Bottom-Up direction, it's great to know what parts of the system might be impacted when I am making one change in system.

Knowing this can do better change impact analysis and effort estimation.

This project is to build the code dependency graph with the asistance of AI (or AST if security concern is an issue).  Due to the dynamic characteristics of JavaScript, the dependency graph might not be completely correct.

### Scenario
* Component Rename
* Field Change (Removed)
* Function Implementation Change
* API Change (Field Addition)
* Business Module Change (From BA perspective, such as adding field support for search API)


## Usage

module.exports = {
  graph: {
    type: 'ARCADEDB',
    connectionOptions: {
      host: 'localhost',
      port: 2480,
      database: '',
      username: 'root',
      password: ''
    }
  }
}


## Edge (Connection between Vertices)

There is ONLY one Edge type `Uses`.  It's used to connect:
- From Micro-Service to System Module
- From System Module to Component
- From Component to Component

A `Uses` B means A `depends` on B, which is `A -> B`.  When this relationship exists, if B is updated, A is potentially affected.  Business Module, Micro-Service, System Module are mainly used as grouping purpose.  The real dependency or impact actually depends on `Component -> Component` relationship tracking.  Detail explanation of different Vertex categories is in following sections.


## Vertex (Node) categories in Dependency Graph

Vertex has three basic properties:
- name: Brief name of the Vertex and should be unique in same category
- type: Type identifier within same category if required.
- description: Long description of one Vertex.  It must be in detail, especially for Business Module, System Module, Function Component, etc.

Vertex has four categories:
- Business Module
- Micro-Service
- System Module
- Component

### Business Module

It's used for describing a business function in one system.  Hence, the description should be in BA's term so that when presenting BA's question to AI, the AI should be able to tell which business module the BA's talking about.

For example, when one BA asked "I want to add wildcast search support on the Organization name in Organization Search Page", the AI should knows it's talking about the Business Module for Organization, and then the graph engine can retrieve all related, especially children, Vertexes starting from this Business Module Vertex.

### Micro-Service

It's just from technical perspective, especially for the project which separates frontend and backend.  Making it one level of Vertex has better visual output as a tree starting from it, to System Module, and then down to the Component Vertex.


### System Module

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

### Component

This is the actual Vertex that tracks code dependency.  It has extra properties beside `name`, `type`, `description`:

- name: It can be Function Name / Field Name / API URL / Queue Name / Table Name / Store Procedure Name
- type: It can be `Function` / `Field` / `Interface` (API / Queue / Table / Store Procedure), etc.
- microService: Part of the unique constraint of Component.
- systemModule: Part of the unique constraint of Component.  Easier CRUD and graph search starting point.
- sourceCode: Source code of this component.  It can be function signature & body, API route validation code, etc.


## Graph Building

To build a dependency graph for a project, it should probably go through below steps:
- Create `Business Module` type Vertices.  These vertices should normally be prepared by business analysis and they cannot be done through codebase scan.
- Create `Micro-Service` type Vertices.  These vertices are normally 1-1 mapping to code repository.
- Create `System Module` and `Component` type Vertices.  These should be done automatically by code scan.
  - 1st scan on each code file should generates each `System Module` vertex with dependencies vertices of its functions at least.
  - 2nd scan can use the `getRequiredModuleDependencies` for each file, and `getFunctionDependencies` for each function to create Edges

```
const businessModuleVertices = [
  {
    name: 'Organization',
    category: 'businessModule',
    description: 'Organization Management',
    type: 'Profile'
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
    name: 'pm_console',
    category: 'microService',
    description: 'Platform Console',
    type: 'frontend'
  },
  {
    name: 'pm_console_svc',
    category: 'microService',
    description: 'Platform Console Service',
    type: 'backend'
  }
];

const systemModuleVertices = [
  {
    category: 'systemModule',
    businessModules: ['Organization'],
    microService: 'pm_console_svc',
    name: 'organization.platform.routes.js',
    type: 'Class',
    description: 'API Routes for Organization Platform API',
    dependencies: [
      {
        category: 'component',
        name: 'POST /organizations/request/:orgId/roles',
        type: 'api',
        description: 'API Routes for adding memberRoles for Organization',
        sourceCode: `...`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['Organization', 'Metering'],
    microService: 'pm_console_svc',
    name: 'organization.services.js',
    type: 'Class',
    description: 'Service Class for Organization',
    dependencies: [
      {
        category: 'component',
        name: 'addMemberRoles',
        type: 'function',
        description: 'Service API for adding memberRoles for Organization',
        sourceCode: `...`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['System'],
    microService: 'pm_console_svc',
    name: 'repository.server.util.js',
    type: 'Class',
    description: 'Repository Server Util',
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




```sql
-- Find all components that directly or indirectly use a given component
g.V().hasLabel('Component')
  .has('name', 'addMemberRoles')
  .has('systemModule', 'organization.service.js')
  .emit().repeat(__.in('Uses'))
  .path()

["#105:0"]
["#105:0","#114:0"]
["#105:0","#84:0"]
["#105:0","#114:0","#111:0"]
["#105:0","#114:0","#90:0"]
["#105:0","#114:0","#111:0","#87:0"]

-- Find all components that started from a given component
g.V().hasLabel('Component')
  .has('name', 'POST /organizations/request/:orgId/roles')
  .has('systemModule', 'organization.platform.routes.js')
  .emit().repeat(__.out('Uses'))
  .path()

["#111:0"]
["#111:0","#114:0"]
["#111:0","#114:0","#105:0"]
["#111:0","#114:0","#105:0","#108:0"]
```

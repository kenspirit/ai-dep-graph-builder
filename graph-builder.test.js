const businessModuleVertices = [
  {
    name: 'Organization',
    category: 'businessModule',
    description: 'Organization Management',
    type: 'Profile'
  },
  {
    name: 'Organization Create Request',
    category: 'businessModule',
    description: 'Organization Create Request Management',
    type: 'Profile'
  },
  {
    name: 'Metering',
    category: 'businessModule',
    description: 'Metering Report',
    type: 'Reporting'
  },
  {
    name: 'System',
    category: 'businessModule',
    description: 'System Infrastructure',
    type: 'Infrastructure'
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
    name: 'organization.console.routes.js',
    type: 'Class',
    description: 'API Routes for Organization Console Operation'
  },
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
        sourceCode: `{
  path: joi.object().keys({
    orgId: joi.string().required()
  }),
  body: joi.object().keys({
    memberRoles: joi.array().items(joi.string().required()).required()
  })
}`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['Organization'],
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
        sourceCode: `async function addMemberRoles(orgId, memberRoleNames, clientId) {
  await validateOrgRoles({ roles: memberRoleNames });

  let appName = 'System';
  if (clientId) {
    const app = await IntegrationAppService.getIntegrationApplicationByClientId(clientId, false);
    if (app) {
      appName = app.applicationName;
    }
  }

  const { count } = await repositoryUtil.updateAll({
    model: organizationModel.name,
    where: { orgId },
    data: { $addToSet: { roles: { $each: memberRoleNames } } },
    operator: appName
  });

  return count === 1;
}`
      }
    ]
  },
  {
    category: 'systemModule',
    businessModules: ['Metering', 'Organization'],
    microService: 'pm_console_svc',
    name: 'scheduledReport.routes.js',
    type: 'Class',
    description: 'API Routes for Scheduled Report'
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
        sourceCode: `const updateAll = async ({ model, where, data, operator }) => {
    if (operator) {
      data.updatedBy = headerUtil.parseOperatorByModelName(operator, model);
    }
    const Model = MongooseManager.getModelConstructor(model);

    const updateResult = await Model.updateMany(_convertWhere(where, Model), data);
    return {
      count: updateResult.modifiedCount
    };
  };`
      }
    ]
  }
];

import config from './sample.config.js';
import { GraphBuilder } from './index.js';
const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
// builder.initGraph().then(console.log);


async function create(vertices) {
  for (const vertex of vertices) {
    // const result = await builder.getOneVertex(vertex);
    const result = await builder.createVertex(vertex);
    console.log('created ' + vertex.name + ': \n' + JSON.stringify(result, null, 2));
  }
}

create(systemModuleVertices);


// builder.getOneVertex({ name: 'organization.console.routes.js', category: 'systemModule', microService: 'pm_console_svc' }).then(console.log);
// builder.createEdge(
//   { name: 'addMemberRoles', category: 'component', microService: 'pm_console_svc', systemModule: 'organization.services.js' },
//   { name: 'updateAll', category: 'component', microService: 'pm_console_svc', systemModule: 'repository.server.util.js' }
// ).then(console.log);

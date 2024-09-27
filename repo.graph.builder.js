
import path from 'path';
import { loadModules } from './sample-project/server/util/module.loader.js';
import { fileURLToPath } from 'url';
import { AiProvider, GraphBuilder, AstParser } from './index.js';
import config from './sample.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const aiProvider = new AiProvider(config.aiProvider.type, config.aiProvider.providerOptions);
const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
const astParser = new AstParser();

const rootDir = path.join(__dirname, 'sample-project/server');
const microService = 'dep-graph-builder';

async function _getModuleDependencyMapping(filePath, rawContent) {
  // const name = filePath.replace(rootDir, '');
  const requiredModuleDependencies = astParser.getRequiredModuleDependencies(rawContent);
  const result = {};
  for (const requiredModuleDependency of requiredModuleDependencies) {
    const { identifier, source } = requiredModuleDependency;
    if (source.startsWith('.')) {
      const dependencyPath = path.resolve(path.dirname(filePath), source);
      const dependencyName = dependencyPath.replace(rootDir, '');
      result[identifier] = { dependencyPath, dependencyName };
    }
  }

  return result;
}

function traverse(cursor, result) {
  const node = cursor.currentNode;

  if (node.type == 'object') {
    // Start of a new route object definition
    result.push({ actions: [] });
  }
  if (node.type === 'pair' && node.firstChild.type === 'property_identifier') {
    const route = result[result.length - 1];

    switch (node.firstChild.text) {
      case 'method':
      case 'path':
        route[node.firstChild.text] = node.lastChild.text.replace(/['"]/g, '');
        break;
      case 'action':
        const arrayNode = node.lastChild;
        if (arrayNode.type === 'array') {
          const route = result[result.length - 1];
          for (let i = 0; i < arrayNode.namedChildCount; i++) {
            const element = arrayNode.namedChild(i);
            if (element.type === 'member_expression') {
              route.actions.push(element.text);
            }
          }
        }

        break;
      case 'validators':
        route.validators = node.lastChild.text;
        // Collect info done for current route, prepare to the next route
        cursor.gotoParent(); // Back to parent object
        cursor.gotoNextSibling();
        traverse(cursor, result);
        break;
    }
  }

  if (cursor.gotoFirstChild()) {
    do {
      traverse(cursor, result);
    } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}

function _getValidatorsAndActionMapping(basePath, rawContent) {
  const tree = astParser.parse(rawContent);
  const result = [];

  traverse(tree.walk(), result);

  return result.filter(route => route.actions.length > 0).reduce((mapping, route) => {
    mapping[`${route.method} ${basePath}${route.path}`] = route;
    return mapping;
  }, {});
}

async function buildSystemModuleVerticesFromRouteModules() {
  const routeModules = await loadModules(rootDir, /.*\.routes\.js$/, true);

  for (const result of routeModules) {
    const { filePath, loadedModule, rawContent } = result;

    const moduleRoutes = loadedModule.default;
    if (moduleRoutes.basePath && moduleRoutes.routes && Array.isArray(moduleRoutes.routes)) {
      const systemModule = {
        category: 'systemModule',
        microService: microService,
        name: filePath.replace(rootDir, ''),
        type: 'Class',
        description: moduleRoutes.description,
        dependencies: []
      };

      const moduleDependencies = await _getModuleDependencyMapping(filePath, rawContent);
      const parsedRoutes = _getValidatorsAndActionMapping(moduleRoutes.basePath, rawContent);

      for (const route of moduleRoutes.routes) {
        const name = `${route.method} ${moduleRoutes.basePath}${route.path}`;
        const parsedRoute = parsedRoutes[name];

        const component = {
          category: 'component',
          name,
          type: 'API',
          description: route.description,
          sourceCode: parsedRoute.validators,
          dependencies: []
        };

        for (const action of parsedRoute.actions) {
          const [moduleIdentifier, functionName] = action.split('.');
          const moduleDependency = moduleDependencies[moduleIdentifier];
          if (!moduleDependency) {
            console.warn(`Missing Dependency for route ${name} action: ${action}`);
            continue;
          }

          component.dependencies.push({
            category: 'component',
            name: functionName,
            type: 'Function',
            systemModule: moduleDependency.dependencyName.replace(/\\\\/g, '\\')
          });
        }

        systemModule.dependencies.push(component);
      }

      await builder.createVertex(systemModule);
    }
  }
}


async function _getFunctionDescriptionThroughAI(functionSourceCode) {
  const response = await aiProvider.getFunctionDescription(functionSourceCode);
  return response.description;
}

async function buildSystemModuleVerticesFromNonRouteModules() {
  const nonRouteModules = await loadModules(rootDir, /.*(?<!\.routes\.js)$/);

  for (const result of nonRouteModules) {
    const { filePath, loadedModule } = result;
    const name = filePath.replace(rootDir, '');
    const systemModule = {
      category: 'systemModule',
      microService: microService,
      name,
      type: 'Class',
      description: loadedModule.description || name,
      dependencies: []
    };

    for (const instanceName of Object.keys(loadedModule)) {
      const instance = loadedModule[instanceName];
      const isFunction = typeof instance === 'function';

      const component = {
        category: 'component',
        name: instanceName,
        type: isFunction ? 'Function' : 'Field',
        sourceCode: isFunction ? instance.toString() : `${instance}`
      };
      if (isFunction) {
        component.description = await _getFunctionDescriptionThroughAI(component.sourceCode);
      } else {
        component.description = instanceName;
      }

      systemModule.dependencies.push(component);
    };

    await builder.createVertex(systemModule);
  }
}

async function buildGraph() {
  await builder.createVertex({
    name: microService,
    category: 'microService',
    description: 'Dependency graph builder',
    type: 'mono'
  });

  await buildSystemModuleVerticesFromRouteModules();
  await buildSystemModuleVerticesFromNonRouteModules();
}

buildGraph();


import path from 'path';
import { loadModules } from './sample-project/server/util/module.loader.js';
import { fileURLToPath } from 'url';
import { AiProvider, GraphBuilder, AstParser, registerAiProvider } from './index.js';
import BigModel from './ai-providers/bigmodel.js';
import config from './sample.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerAiProvider('BIGMODEL', BigModel);

const aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);
const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
const astParser = new AstParser();

const rootDir = path.join(__dirname, 'sample-project/server');
const microService = 'dep-graph-builder';

async function persistVertex(vertex) {
  await builder.createVertex(vertex);
}

function _resolveRelativeModulePath(filePath, relativeModulePath) {
  const dependencyPath = path.resolve(rootDir, path.dirname(filePath), relativeModulePath);
  const dependencyName = dependencyPath.replace(rootDir, '').replace(/\\/g, '/');
  return { dependencyPath, dependencyName };
}

async function _getModuleDependencyMapping(filePath, requiredModuleDependencies) {
  const result = {};
  for (const identifier in requiredModuleDependencies) {
    const source = requiredModuleDependencies[identifier].source;

    if (source.startsWith('.')) {
      result[identifier] = _resolveRelativeModulePath(filePath, source);
    } else {
      result[identifier] = { dependencyName: identifier };
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
        const actionNode = node.lastChild;
        if (actionNode.type === 'array') {
          const route = result[result.length - 1];
          for (let i = 0; i < actionNode.namedChildCount; i++) {
            const element = actionNode.namedChild(i);
            if (element.type === 'member_expression') {
              route.actions.push(element.text);
            }
          }
        } else {
          route.actions.push(actionNode.text);
        }

        break;
      case 'validators':
        route.validators = node.lastChild.text;
        // Collect info done for current route, prepare to the next route
        cursor.gotoNextSibling();
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
      const systemModuleName = filePath.replace(rootDir, '').replace(/\\/g, '/');
      // const systemModule = {
      //   category: 'systemModule',
      //   microService: microService,
      //   name: filePath.replace(rootDir, '').replace(/\\/g, '/'),
      //   type: 'Class',
      //   description: moduleRoutes.description,
      //   dependencies: []
      // };

      const { requiredModuleDependencies } = astParser.getDependencies(rawContent);
      const moduleDependencyMap = await _getModuleDependencyMapping(filePath, requiredModuleDependencies);
      const parsedRoutes = _getValidatorsAndActionMapping(moduleRoutes.basePath, rawContent);

      for (const route of moduleRoutes.routes) {
        const name = `${route.method} ${moduleRoutes.basePath}${route.path}`;
        const parsedRoute = parsedRoutes[name];

        const component = {
          category: 'component',
          name,
          type: 'API',
          systemModule: systemModuleName,
          microService: microService,
          description: route.description || name,
          sourceCode: parsedRoute.validators,
          dependencies: []
        };

        for (const action of parsedRoute.actions) {
          const [moduleIdentifier, functionName] = action.split('.');
          const moduleDependency = moduleDependencyMap[moduleIdentifier];
          if (!moduleDependency) {
            console.warn(`Missing Dependency for route ${name} action: ${action}`);
            continue;
          }

          component.dependencies.push({
            category: 'component',
            name: functionName,
            type: 'Function',
            systemModule: moduleDependency.dependencyName
          });
        }

        // systemModule.dependencies.push(component);
        await persistVertex(component);
      }

      // await persistVertex(systemModule);
    }
  }
}


async function _getFunctionDescriptionThroughAI(functionSourceCode) {
  const response = await aiProvider.getFunctionDescription(functionSourceCode);
  return response.description;
}

const NATIVE_MODULES = ['JSON', 'Set', 'Array', 'Map', 'console', 'Error', 'Buffer', 'Promise', 'Uint8Array', 'Date', 'process', 'require'];

function _convertInstanceAndFunctionDependencies(systemModuleName, moduleDependencyMap, dependencies = []) {
  const result = dependencies.map(dependency => {
    const isFunction = dependency.type === 'method';

    const converted = {
      public: dependency.public,
      category: 'component',
      name: dependency.instanceName,
      systemModule: dependency.module === '$file' ? systemModuleName : (dependency.module || 'this'),
      microService: microService,
      type: isFunction ? 'Function' : 'Field',
      sourceCode: isFunction ? dependency.sourceCode : dependency.instanceName,
      dependencies: _convertInstanceAndFunctionDependencies(systemModuleName, moduleDependencyMap, dependency.dependencies)
    };

    if (converted.systemModule.startsWith('.')) {
      // Resolve relative path
      const { dependencyName } = _resolveRelativeModulePath(`./${systemModuleName}`, converted.systemModule);
      converted.systemModule = dependencyName;
    }
    if (converted.systemModule === 'this') {
      // Follows its parent system module
      delete converted.systemModule;
    }

    return converted;
  });

  return result.filter(dependency => !NATIVE_MODULES.includes(dependency.systemModule));
}

async function buildSystemModuleVerticesFromNonRouteModules() {
  const fileMatchingPatterns = [
    /^(?!.*\.(routes|test|spec)\.js$)/,
    /^(?!.*\.json$).*$/,
    /^(?!.*(asset_models|rolelist_models|schemas)).*$/
  ]
  const nonRouteModules = await loadModules(rootDir, fileMatchingPatterns, false);

  for (const result of nonRouteModules) {
    const { filePath, loadedModule, rawContent } = result;
    const systemModuleName = filePath.replace(rootDir, '').replace(/\\/g, '/');
    // const systemModule = {
    //   category: 'systemModule',
    //   microService: microService,
    //   name,
    //   type: 'Class',
    //   description: loadedModule.description || name,
    //   dependencies: []
    // };

    console.log(`========== Dependencies built for ${systemModuleName} ===========\n`);
    const { requiredModuleDependencies, instanceAndfunctionDependencies } = astParser.getDependencies(rawContent);
    // console.log('------ Original --------- ', JSON.stringify(instanceAndfunctionDependencies, null, 2));

    const moduleDependencyMap = await _getModuleDependencyMapping(filePath, requiredModuleDependencies);

    const moduleDependencies = _convertInstanceAndFunctionDependencies(systemModuleName, moduleDependencyMap, instanceAndfunctionDependencies.dependencies);
    // console.log('------ Converted --------- ', JSON.stringify(moduleDependencies, null, 2));

    for (const dependency of moduleDependencies) {
      // Only top level public functions are considered
      if (dependency.public && dependency.type === 'Function' && dependency.sourceCode) {
        // dependency.description = await _getFunctionDescriptionThroughAI(dependency.sourceCode);
        dependency.description = 'Testing';
      } else {
        dependency.description = dependency.name;
      }

      await persistVertex(dependency);
    }

    // await persistVertex(systemModule);
  }
}

async function buildGraph() {
  await persistVertex({
    name: microService,
    category: 'microService',
    description: 'Dependency graph builder',
    type: 'mono'
  });

  // await buildSystemModuleVerticesFromRouteModules();
  await buildSystemModuleVerticesFromNonRouteModules();
}

buildGraph();


import path from 'path';
import { loadModules } from './sample-project/server/util/module.loader.js';
import { fileURLToPath } from 'url';
import { AiProvider, GraphBuilder, AstParser, registerAiProvider } from './index.js';
import BigModel from './ai-providers/bigmodel.js';
import config from './sample.config.js';

let aiProvider;

if (process.env.AI_ENABLED !== 'false') {
  registerAiProvider('BIGMODEL', BigModel);

  aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);
}

const builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
const astParser = new AstParser();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.env.PROJECT_ROOT || path.join(__dirname, 'sample-project/server');
const microService = process.env.SERVICE_NAME || 'dep-graph-builder';

async function persistVertex(vertex) {
  try {
    await builder.createVertex(vertex);
  } catch (e) {
    console.error(`Failed to persist vertex: ${vertex.name}`, e);
  }
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
  if (process.env.AI_ENABLED === 'false') {
    return 'AI NOT ENABLED';
  }
  const response = await aiProvider.getFunctionDescription(functionSourceCode);
  return response.description;
}

const NATIVE_MODULES = ['JSON', 'Set', 'Array', 'Map', 'console', 'Error', 'Buffer', 'Promise', 'Uint8Array', 'Date', 'process', 'require'];

function _setSystemModule(dependency, systemModuleName) {
  dependency.systemModule = dependency.systemModule || '';
  if (dependency.systemModule === '$file') {
    dependency.systemModule = systemModuleName;
  }
  if (dependency.systemModule.startsWith('@/')) {
    dependency.systemModule = dependency.systemModule.replace('@/', './src/');
  }
  if (dependency.systemModule.startsWith('.')) {
    // Resolve relative path
    const { dependencyName } = _resolveRelativeModulePath(`./${systemModuleName}`, dependency.systemModule);
    dependency.systemModule = dependencyName;
  }
  if (dependency.systemModule === 'this') {
    // Follows its parent system module
    delete dependency.systemModule;
  };
}

function _convertInstanceAndFunctionDependencies(systemModuleName, moduleDependencyMap, dependencies = []) {
  const result = dependencies.map(dependency => {
    const isFunction = dependency.type === 'method';

    const converted = {
      public: dependency.public,
      category: 'component',
      name: dependency.instanceName,
      systemModule: dependency.module,
      microService: microService,
      type: isFunction ? 'Function' : 'Field',
      sourceCode: isFunction ? dependency.sourceCode : dependency.instanceName,
      dependencies: _convertInstanceAndFunctionDependencies(systemModuleName, moduleDependencyMap, dependency.dependencies)
    };

    _setSystemModule(converted, systemModuleName);

    return converted;
  });

  return result.filter(dependency => !NATIVE_MODULES.includes(dependency.systemModule));
}

const VUE_PROP_TYPES = {
  'props': 'Property',
  'emits': 'EmitEvent',
  'components': 'Component',
  'mixins': 'Component',
  'data': 'Data',
  'watch': 'Watch',
}

function _convertVueDependencies(systemModuleName, moduleDependencyMap, dependencies = [], level = 0) {
  if (dependencies.length === 1 && dependencies[0].instanceName === 'default') {
    // Option definition style
    return _convertVueDependencies(systemModuleName, moduleDependencyMap, dependencies[0].dependencies, level);
  }

  return dependencies.map(dependency => {
    // Type of the children should be set as top level component name
    // Each top level component should be handled differently
    // props, data, emits, components, mixins
    // setup, methods, computed, watch, created should be similar
    const isFunction = dependency.type === 'method';

    const converted = {
      public: typeof dependency.public !== 'undefined' ? dependency.public : (level === 0),
      category: 'component',
      name: dependency.instanceName,
      systemModule: level === 0 ? systemModuleName : dependency.module,
      microService: microService,
      type: isFunction ? 'Function' : 'Field',
      sourceCode: dependency.sourceCode || dependency.instanceName
    };

    _setSystemModule(converted, systemModuleName);

    if (level === 0) {
      // Top level component special handling
      converted.dependencies = dependency.dependencies.map(prop => {
        const innerDependency = {
          public: true,
          category: 'component',
          name: prop.instanceName,
          systemModule: level === 0 ? systemModuleName : dependency.module,
          microService: microService,
          type: VUE_PROP_TYPES[converted.name] || (prop.type === 'method' ? 'Function' : 'Field'),
          description: prop.instanceName,
          sourceCode: dependency.sourceCode || dependency.instanceName
        };

        _setSystemModule(innerDependency, systemModuleName);

        innerDependency.dependencies = _convertVueDependencies(systemModuleName, moduleDependencyMap, prop.dependencies, level + 1);

        return innerDependency;
      });
    } else {
      converted.dependencies = _convertVueDependencies(systemModuleName, moduleDependencyMap, dependency.dependencies, level + 1)
    }

    return converted;
  });
}

const CONVERT_ADAPTOR = {
  DEFAULT: _convertInstanceAndFunctionDependencies,
  JS: _convertInstanceAndFunctionDependencies,
  VUE: _convertVueDependencies
}

async function buildSystemModuleVerticesFromNonRouteModules() {
  const nonRouteModules = await loadModules(rootDir, config.filesMatchingPatterns, false);

  for (const result of nonRouteModules) {
    const { filePath, loadedModule, rawContent } = result;
    const systemModuleName = filePath.replace(rootDir, '').replace(/\\/g, '/');
    const suffix = filePath.split('.').pop().toUpperCase();
    // const systemModule = {
    //   category: 'systemModule',
    //   microService: microService,
    //   name,
    //   type: 'Class',
    //   description: loadedModule.description || name,
    //   dependencies: []
    // };
    let jsSource = rawContent;
    const convertedAdaptor = CONVERT_ADAPTOR[suffix] || CONVERT_ADAPTOR.DEFAULT;

    if (suffix === 'VUE') {
      const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/;
      const match = rawContent.match(scriptContentRegex);
      if (match && match[1]) {
        jsSource = match[1].trim();
      } else {
        console.warn(`No script content found for ${filePath}`);
        continue;
      }
    }

    console.log(`========== Dependencies built for ${systemModuleName} ===========\n`);
    const { requiredModuleDependencies, instanceAndfunctionDependencies } = astParser.getDependencies(jsSource);
    // console.log('------ Original --------- ', JSON.stringify(instanceAndfunctionDependencies, null, 2));

    const moduleDependencyMap = await _getModuleDependencyMapping(filePath, requiredModuleDependencies);

    const moduleDependencies = convertedAdaptor(systemModuleName, moduleDependencyMap, instanceAndfunctionDependencies.dependencies);
    // console.log('------ Converted --------- ', JSON.stringify(moduleDependencies, null, 2));

    for (const dependency of moduleDependencies) {
      // Only top level public functions are considered
      if (dependency.public && dependency.type === 'Function' && dependency.sourceCode) {
        dependency.description = await _getFunctionDescriptionThroughAI(dependency.sourceCode);
      } else {
        dependency.description = dependency.name;
      }

      await persistVertex(dependency);
    }

    // await persistVertex(systemModule);
  }
}

async function buildGraph() {
  await builder.initGraph();
  await persistVertex({
    name: microService,
    category: 'microService',
    description: 'Dependency graph builder',
    type: 'mono'
  });

  await buildSystemModuleVerticesFromRouteModules();
  await buildSystemModuleVerticesFromNonRouteModules();
}

buildGraph();

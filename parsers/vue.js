import { AstParser } from './javascript';

const VUE_PROP_TYPES = {
  'props': 'Property',
  'emits': 'EmitEvent',
  'components': 'Component',
  'mixins': 'Component',
  'data': 'Data',
  'watch': 'Watch',
}

function _convertVueDependencies(systemModuleName, dependencies = [], level = 0) {
  if (dependencies.length === 1 && dependencies[0].instanceName === 'default') {
    // Option definition style
    return _convertVueDependencies(systemModuleName, dependencies[0].dependencies, level);
  }

  return dependencies.map(dependency => {
    // Type of the children should be set as top level component name
    // Each top level component should be handled differently
    // props, data, emits, components, mixins
    // setup, methods, computed, watch, created should be similar
    const isFunction = dependency.type === 'method';

    const converted = {
      language: 'javascript',
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
          language: 'javascript',
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

        innerDependency.dependencies = _convertVueDependencies(systemModuleName, prop.dependencies, level + 1);

        return innerDependency;
      });
    } else {
      converted.dependencies = _convertVueDependencies(systemModuleName, dependency.dependencies, level + 1)
    }

    return converted;
  });
}

class VueParser extends AstParser {
  constructor(rootDir) {
    super(rootDir);
  }

  getDependencies(sourceFilePath, rawContent) {
    const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/;
    const match = rawContent.match(scriptContentRegex);
    let jsSource = rawContent;

    if (match && match[1]) {
      jsSource = match[1].trim();
    } else {
      console.warn(`No script content found for ${sourceFilePath}`);
    }

    const { requiredModuleDependencies, instanceAndfunctionDependencies } = super.getDependencies(jsSource);
    return {
      requiredModuleDependencies,
      instanceAndfunctionDependencies: {
        dependencies: _convertVueDependencies(sourceFilePath, instanceAndfunctionDependencies.dependencies)
      }
    };
  }
}

export {
  VueParser as AstParser
}

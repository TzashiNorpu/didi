import {
  parseAnnotations,
  annotate
} from './annotation.js';

import {
  isArray,
  hasOwnProp
} from './util.js';

/**
 * @typedef { import('./index.js').ModuleDeclaration } ModuleDeclaration
 * @typedef { import('./index.js').ModuleDefinition } ModuleDefinition
 * @typedef { import('./index.js').InjectorContext } InjectorContext
 *
 * @typedef { import('./index.js').TypedDeclaration<any, any> } TypedDeclaration
 */

/**
 * Create a new injector with the given modules.
 *
 * @param {ModuleDefinition[]} modules
 * @param {InjectorContext} [_parent]
 */
export default function Injector(modules, _parent) {

  const parent = _parent || /** @type InjectorContext */ ({
    get: function(name, strict) {
      currentlyResolving.push(name);

      if (strict === false) {
        return null;
      } else {
        throw error(`No provider for "${ name }"!`);
      }
    }
  });

  const currentlyResolving = [];
  const providers = this._providers = Object.create(parent._providers || null);
  const instances = this._instances = Object.create(null);

  const self = instances.injector = this;

  const error = function(msg) {
    const stack = currentlyResolving.join(' -> ');
    currentlyResolving.length = 0;
    return new Error(stack ? `${ msg } (Resolving: ${ stack })` : msg);
  };

  /**
   * Return a named service.
   *
   * @param {string} name
   * @param {boolean} [strict=true] if false, resolve missing services to null
   *
   * @return {any}
   */
  function get(name, strict) {
    if (!providers[name] && name.includes('.')) {

      const parts = name.split('.');
      let pivot = get(/** @type { string } */ (parts.shift()));

      while (parts.length) {
        pivot = pivot[/** @type { string } */ (parts.shift())];
      }

      return pivot;
    }

    if (hasOwnProp(instances, name)) {
      return instances[name];
    }

    if (hasOwnProp(providers, name)) {
      if (currentlyResolving.indexOf(name) !== -1) {
        currentlyResolving.push(name);
        throw error('Cannot resolve circular dependency!');
      }

      currentlyResolving.push(name);
      instances[name] = providers[name][0](providers[name][1]);
      currentlyResolving.pop();

      return instances[name];
    }

    return parent.get(name, strict);
  }

  function fnDef(fn, locals) {

    if (typeof locals === 'undefined') {
      locals = {};
    }

    if (typeof fn !== 'function') {
      if (isArray(fn)) {
        fn = annotate(fn.slice());
      } else {
        throw error(`Cannot invoke "${ fn }". Expected a function!`);
      }
    }

    /**
     * @type {string[]}
     */
    const inject = fn.$inject || parseAnnotations(fn);
    const dependencies = inject.map(dep => {
      if (hasOwnProp(locals, dep)) {
        return locals[dep];
      } else {
        return get(dep);
      }
    });

    return {
      fn: fn,
      dependencies
    };
  }

  /**
   * Instantiate the given type, injecting dependencies.
   *
   * @template T
   *
   * @param { Function | [...string[], Function ]} type
   *
   * @return T
   */
  function instantiate(type) {
    const {
      fn,
      dependencies
    } = fnDef(type);

    // instantiate var args constructor
    const Constructor = Function.prototype.bind.call(fn, null, ...dependencies);

    return new Constructor();
  }

  /**
   * Invoke the given function, injecting dependencies. Return the result.
   *
   * @template T
   *
   * @param { Function | [...string[], Function ]} func
   * @param { Object } [context]
   * @param { Object } [locals]
   *
   * @return {T} invocation result
   */
  function invoke(func, context, locals) {
    const {
      fn,
      dependencies
    } = fnDef(func, locals);

    return fn.apply(context, dependencies);
  }

  /**
   * @param {Injector} childInjector
   *
   * @return {Function}
   */
  function createPrivateInjectorFactory(childInjector) {
    return annotate(key => childInjector.get(key));
  }

  /**
   * @param {ModuleDefinition[]} modules
   * @param {string[]} [forceNewInstances]
   *
   * @return {Injector}
   */
  function createChild(modules, forceNewInstances) {
    if (forceNewInstances && forceNewInstances.length) {
      const fromParentModule = Object.create(null);
      const matchedScopes = Object.create(null);

      const privateInjectorsCache = [];
      const privateChildInjectors = [];
      const privateChildFactories = [];

      let provider;
      let cacheIdx;
      let privateChildInjector;
      let privateChildInjectorFactory;

      for (let name in providers) {
        provider = providers[name];

        if (forceNewInstances.indexOf(name) !== -1) {
          if (provider[2] === 'private') {
            cacheIdx = privateInjectorsCache.indexOf(provider[3]);
            if (cacheIdx === -1) {
              privateChildInjector = provider[3].createChild([], forceNewInstances);
              privateChildInjectorFactory = createPrivateInjectorFactory(privateChildInjector);
              privateInjectorsCache.push(provider[3]);
              privateChildInjectors.push(privateChildInjector);
              privateChildFactories.push(privateChildInjectorFactory);
              fromParentModule[name] = [ privateChildInjectorFactory, name, 'private', privateChildInjector ];
            } else {
              fromParentModule[name] = [ privateChildFactories[cacheIdx], name, 'private', privateChildInjectors[cacheIdx] ];
            }
          } else {
            fromParentModule[name] = [ provider[2], provider[1] ];
          }
          matchedScopes[name] = true;
        }

        if ((provider[2] === 'factory' || provider[2] === 'type') && provider[1].$scope) {
          /* jshint -W083 */
          forceNewInstances.forEach(scope => {
            if (provider[1].$scope.indexOf(scope) !== -1) {
              fromParentModule[name] = [ provider[2], provider[1] ];
              matchedScopes[scope] = true;
            }
          });
        }
      }

      forceNewInstances.forEach(scope => {
        if (!matchedScopes[scope]) {
          throw new Error('No provider for "' + scope + '". Cannot use provider from the parent!');
        }
      });

      modules.unshift(fromParentModule);
    }

    return new Injector(modules, self);
  }

  const factoryMap = {
    factory: invoke,
    type: instantiate,
    value: function(value) {
      return value;
    }
  };

  /**
   * @param {ModuleDefinition} moduleDefinition
   * @param {Injector} injector
   */
  function createInitializer(moduleDefinition, injector) {

    const initializers = moduleDefinition.__init__ || [];

    return function() {
      initializers.forEach(initializer => {

        // eagerly resolve component (fn or string)
        if (typeof initializer === 'string') {
          injector.get(initializer);
        } else {
          injector.invoke(initializer);
        }
      });
    };
  }

  /**
   * @param {ModuleDefinition} moduleDefinition
   */
  function loadModule(moduleDefinition) {

    const moduleExports = moduleDefinition.__exports__;

    // private module
    if (moduleExports) {
      const nestedModules = moduleDefinition.__modules__;

      const clonedModule = Object.keys(moduleDefinition).reduce((clonedModule, key) => {

        /*
        这段代码的作用是检查当前的 key 是否不是以下四个特殊属性之一：
        __exports__：表示模块中需要导出的组件，用于定义模块对外暴露的内容。
        __modules__：表示模块中嵌套的子模块，用于定义模块的内部依赖关系。
        __init__：表示模块的初始化函数列表，用于在模块加载时执行一些初始化逻辑。
        __depends__：表示模块的依赖列表，用于声明当前模块依赖的其他模块。
        只有当 key 不属于这些特殊属性时，代码才会对其进行进一步处理。
        为什么要这么写
          在依赖注入系统中，模块定义 (moduleDefinition) 通常包含两类信息：
          组件定义：模块中实际提供的服务、工厂函数、值等。
          元信息：描述模块结构和行为的特殊属性，例如依赖关系、初始化逻辑等。
          这段代码的目的是区分这两类信息，确保只处理模块中定义的实际组件，而忽略元信息。这种设计有以下几个好处：
          避免冲突：
          如果不排除这些特殊属性，系统可能会尝试将它们当作普通组件处理，导致错误或意外行为。
          模块化设计：
          通过将元信息与组件定义分开，可以更清晰地描述模块的结构和行为，增强代码的可读性和可维护性。
          灵活性：
          这种过滤机制允许模块定义中包含更多的元信息，而不会影响组件的正常处理。
        */
        if (key !== '__exports__' && key !== '__modules__' && key !== '__init__' && key !== '__depends__') {
          clonedModule[key] = moduleDefinition[key];
        }

        return clonedModule;
      }, Object.create(null));

      const childModules = (nestedModules || []).concat(clonedModule);

      /*
      在依赖注入系统中，为 private module（私有模块）创建子注入器的主要目的是隔离依赖关系，确保模块的私有依赖不会影响全局或其他模块，同时提供模块化和灵活性。以下是详细的原因和好处：
      1. 隔离作用域
        私有模块中的依赖是模块内部的实现细节，不应该暴露给外部模块或全局注入器。如果直接将私有模块的依赖注册到全局注入器中，可能会导致以下问题：
        依赖冲突：不同模块可能定义了同名的依赖，如果这些依赖被注册到同一个注入器中，会导致冲突或覆盖。
        意外访问：其他模块可能意外访问到私有模块的依赖，破坏模块的封装性。
        通过为私有模块创建子注入器，可以将这些依赖限制在子注入器的作用域中，确保它们只在私有模块内部可见。

      2. 模块化设计
        子注入器允许每个模块独立管理自己的依赖，而不需要依赖全局注入器。这种模块化设计有以下好处：
        清晰性：模块的依赖关系更加清晰，模块只需要关心自己的依赖，而不需要了解全局的依赖结构。
        可维护性：模块的依赖变更不会影响其他模块，降低了维护成本。
        复用性：模块可以在不同的上下文中复用，因为它的依赖是独立管理的。
      3. 支持嵌套模块
        私有模块可能包含嵌套模块（通过 __modules__ 属性定义）。这些嵌套模块的依赖也需要被隔离在私有模块的作用域中。通过创建子注入器，可以递归地加载嵌套模块，并为它们提供独立的依赖解析环境。

      4. 灵活性
        子注入器可以根据需要覆盖父注入器中的依赖，或者定义新的依赖。例如：
        如果私有模块需要一个特定版本的服务，而全局注入器中已经存在另一个版本的服务，可以通过子注入器为私有模块提供特定版本的服务，而不影响全局注入器中的服务。
      5. 初始化和生命周期管理
        私有模块可能需要在加载时执行一些初始化逻辑（通过 __init__ 属性定义）。子注入器可以独立管理这些初始化逻辑，而不会干扰全局注入器或其他模块的初始化流程。
      */
      const privateInjector = createChild(childModules);

      /*
      annotate 函数的核心作用是为函数添加 $inject 属性，用于显式声明函数的依赖项。
      ```javascript
      function myFunction(dep1, dep2) {
        console.log(dep1, dep2);
      }
      const annotatedFn = annotate('dep1', 'dep2', myFunction);
      console.log(annotatedFn.$inject); // ['dep1', 'dep2']
      ```
      ```javascript
      function myFunction(dep1, dep2) {
        console.log(dep1, dep2);
      }
      const annotatedFn = annotate(['dep1', 'dep2', myFunction]);
      console.log(annotatedFn.$inject); // ['dep1', 'dep2']
      ```
      */

      /*
      privateInjector.get(key) 是子注入器的 get 方法，用于根据 key 从子注入器中解析并返回对应的依赖项。
      */
      const getFromPrivateInjector = annotate(function(key) {
        return privateInjector.get(key);
      });

      console.log('getFromPrivateInjector', getFromPrivateInjector);

      // 私有模块的导出组件（__exports__）通过子注入器注册到父注入器中【父组件可以访问】
      // getFromPrivateInjector：一个工厂函数，用于从子注入器中获取依赖。
      // providers：将私有模块的导出组件注册到父注入器中，但这些组件的依赖仍然由子注入器管理。
      moduleExports.forEach(function(key) {
        providers[key] = [ getFromPrivateInjector, key, 'private', privateInjector ];
      });

      // ensure child injector initializes
      const initializers = (moduleDefinition.__init__ || []).slice();

      initializers.unshift(function() {
        privateInjector.init();
      });

      moduleDefinition = Object.assign({}, moduleDefinition, {
        __init__: initializers
      });

      return createInitializer(moduleDefinition, privateInjector);
    }

    // normal module
    Object.keys(moduleDefinition).forEach(function(key) {

      if (key === '__init__' || key === '__depends__') {
        return;
      }

      const typeDeclaration = /** @type { TypedDeclaration } */ (
        moduleDefinition[key]
      );

      if (typeDeclaration[2] === 'private') {
        providers[key] = typeDeclaration;
        return;
      }

      const type = typeDeclaration[0];
      const value = typeDeclaration[1];

      providers[key] = [ factoryMap[type], arrayUnwrap(type, value), type ];
    });

    return createInitializer(moduleDefinition, self);
  }

  /**
   * @param {ModuleDefinition[]} moduleDefinitions
   * @param {ModuleDefinition} moduleDefinition
   *
   * @return {ModuleDefinition[]}
   */
  function resolveDependencies(moduleDefinitions, moduleDefinition) {

    if (moduleDefinitions.indexOf(moduleDefinition) !== -1) {
      return moduleDefinitions;
    }

    moduleDefinitions = (moduleDefinition.__depends__ || []).reduce(resolveDependencies, moduleDefinitions);

    if (moduleDefinitions.indexOf(moduleDefinition) !== -1) {
      return moduleDefinitions;
    }

    return moduleDefinitions.concat(moduleDefinition);
  }

  /**
   * @param {ModuleDefinition[]} moduleDefinitions
   *
   * @return { () => void } initializerFn
   */
  function bootstrap(moduleDefinitions) {

    const initializers = moduleDefinitions
      .reduce(resolveDependencies, [])
      .map(loadModule);

    let initialized = false;

    return function() {

      if (initialized) {
        return;
      }

      initialized = true;

      initializers.forEach(initializer => initializer());
    };
  }

  // public API
  this.get = get;
  this.invoke = invoke;
  this.instantiate = instantiate;
  this.createChild = createChild;

  // setup
  this.init = bootstrap(modules);
}


// helpers ///////////////

function arrayUnwrap(type, value) {
  if (type !== 'value' && isArray(value)) {
    value = annotate(value.slice());
  }

  return value;
}
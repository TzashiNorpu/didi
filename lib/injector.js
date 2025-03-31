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
    get: function (name, strict) {
      currentlyResolving.push(name);

      if (strict === false) {
        return null;
      } else {
        throw error(`No provider for "${name}"!`);
      }
    }
  });

  const currentlyResolving = [];

  /*
  providers 是依赖注入系统的核心部分，用于存储和管理服务、工厂函数、值等模块的定义和实例化逻辑。它是一个对象，键为服务的名称，值为服务的定义或实例化逻辑。
  1. 存储模块定义：
    providers 保存了所有模块的定义信息，包括服务的类型（如 factory、value、type）以及如何实例化这些服务的逻辑。
    这些定义可以通过依赖注入系统动态解析和实例化。
  2. 管理服务实例：
    providers 还可以存储服务的实例化逻辑，确保服务在需要时被正确创建，并支持单例模式（即同一个服务只会被实例化一次）。
  3. 支持依赖解析：
    当某个服务依赖其他服务时，providers 提供了解析这些依赖的机制，确保服务能够正确获取其依赖的实例。
  4. 注册服务： 在加载模块时，providers 会根据模块定义注册服务
  ```javascript
  Object.keys(moduleDefinition).forEach(function(key) {
    const typeDeclaration = moduleDefinition[key];
    const type = typeDeclaration[0];
    const value = typeDeclaration[1];
    providers[key] = [ factoryMap[type], arrayUnwrap(type, value), type ];
  });
  ```
  5. 解析服务： 当调用 injector.get('serviceName') 时，providers 会被用来查找服务的定义，并根据定义实例化服务。例如：
  ```javascript
  if (hasOwnProp(providers, name)) {
    instances[name] = providers[name][0](providers[name][1]);
    return instances[name];
  }
  ```
  6. 支持私有模块： 如果服务被标记为 private，它会被隔离在特定的子注入器中，避免与全局服务冲突。
  */
  const providers = this._providers = Object.create(parent._providers || null);

  /*
  用于存储已经实例化的服务对象。它是一个对象，键为服务的名称，值为服务的实例。instances 的主要作用是缓存服务实例，以便在后续请求中直接返回，而无需重复实例化。
  1. 缓存服务实例：
  当某个服务第一次被请求时，didi 会根据 providers 中的定义实例化该服务，并将实例存储在 instances 中。
  后续请求同一个服务时，直接从 instances 中返回缓存的实例，而不需要重新实例化。
  2. 支持单例模式：
  instances 确保每个服务在注入器的生命周期内只会被实例化一次（除非明确要求创建新的实例）。
  这符合依赖注入框架中常见的单例模式设计。
  3. 提高性能：
  通过缓存实例，避免了重复的实例化操作，从而提高了性能，尤其是在服务依赖链较长的情况下。

  */
  const instances = this._instances = Object.create(null);

  const self = instances.injector = this;

  const error = function (msg) {
    const stack = currentlyResolving.join(' -> ');
    currentlyResolving.length = 0;
    return new Error(stack ? `${msg} (Resolving: ${stack})` : msg);
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

    // 当请求的服务名称（name）包含点号（.）时，表示这是一个嵌套的属性路径，例如 module.submodule.service。代码的作用是通过递归和逐层解析的方式，获取嵌套属性的最终值。
    /*
    ```javascript
    const module = {
      submodule: {
        service: 'MyService'
      }
    };
    ```
    调用 get('module.submodule.service') 时：
      name.split('.') 将名称分割为 ['module', 'submodule', 'service']。
      调用 get('module') 获取 module 对象。
      --> 获取了对象后用下面的 while 来解析
      在 module 对象中查找 submodule 属性。
      在 submodule 对象中查找 service 属性。
      返回最终的值 'MyService'。
    */
    if (!providers[name] && name.includes('.')) {

      // split('.') 方法将服务名称按点号分割成数组。例如，module.submodule.service 会被分割为 ['module', 'submodule', 'service']
      const parts = name.split('.');

      // 使用 parts.shift() 获取数组的第一个元素（例如 module），并调用 get 方法解析该根属性。
      let pivot = get(/** @type { string } */(parts.shift()));

      while (parts.length) {

        // 在当前 pivot 对象中查找对应的属性。
        pivot = pivot[/** @type { string } */ (parts.shift())];
      }

      return pivot;
    }

    // 检查 instances 中是否已经存在该服务的实例
    if (hasOwnProp(instances, name)) {
      return instances[name];
    }

    // 检查 providers 中是否有该服务的定义
    if (hasOwnProp(providers, name)) {

      // currentlyResolving 是一个数组，用于跟踪当前正在解析的服务或模块名称。
      // 每当一个服务开始解析时，其名称会被添加到 currentlyResolving 中；解析完成后会被移除。
      // 当前正在解析的服务名称 name 是否已经存在于 currentlyResolving 中。 如果存在，说明当前服务的解析过程中又尝试解析自身，形成了循环依赖
      if (currentlyResolving.indexOf(name) !== -1) {

        // 在检测到循环依赖时，仍然将 name 添加到 currentlyResolving 数组中，主要是为了记录完整的依赖解析链，从而帮助开发者更清楚地了解循环依赖的路径
        currentlyResolving.push(name);
        throw error('Cannot resolve circular dependency!');
      }

      // 调用 providers 中的工厂函数实例化服务，并将实例存储到 instances 中
      currentlyResolving.push(name);

      /*
      providers 是一个对象，存储了所有服务的定义信息。
      providers[name] 是一个数组，通常包含以下三个元素：
      providers[name][0]：用于实例化服务的工厂函数（如 invoke 或 instantiate）。
      providers[name][1]：服务的定义值，可能是一个工厂函数、构造函数或直接的值。
      providers[name][2]：服务的类型（如 factory、value、type 等）。

      providers[name][0](providers[name][1])0：调用工厂函数（providers[name][0]），并将服务的定义值（providers[name][1]）作为参数传入。
      工厂函数的作用是根据定义值创建服务实例。例如：
        如果服务是通过构造函数创建的，工厂函数会调用构造函数并返回实例。
        如果服务是一个直接的值，工厂函数会直接返回该值。
      ```javascript
      providers['logger'] = [
        (config) => new Logger(config), // 工厂函数
        { level: 'info' }              // 配置值
      ];
      providers['logger'][0](providers['logger'][1]);
      // 等价于：
      new Logger({ level: 'info' });
      ```
      */
      instances[name] = providers[name][0](providers[name][1]);
      currentlyResolving.pop();

      return instances[name];
    }

    // 从父注入器中查找
    return parent.get(name, strict);
  }

  function fnDef(fn, locals) {

    // 如果调用 fnDef 时未提供 locals 参数，则将其初始化为空对象 {}。
    // locals 是一个局部依赖的上下文，用于覆盖全局依赖，优先从中解析依赖项。
    if (typeof locals === 'undefined') {
      locals = {};
    }

    // 不是函数，则进一步检查：
    // 如果 fn 是一个数组（isArray(fn)），则假定它是一个带有依赖注解的函数定义（例如['dep1', 'dep2', myFunction]）。
    // 调用 annotate(fn.slice()) 提取依赖项并将其附加到函数的 $inject 属性上。
    // 如果 fn 既不是函数也不是数组，则抛出错误，提示无法调用非函数类型。
    if (typeof fn !== 'function') {
      if (isArray(fn)) {
        fn = annotate(fn.slice());
      } else {
        throw error(`Cannot invoke "${fn}". Expected a function!`);
      }
    }

    /**
     * @type {string[]}
     */
    // 检查函数是否显式声明了依赖项（通过 $inject 属性）。
    // 如果未声明，则调用 parseAnnotations(fn) 自动解析依赖项
    const inject = fn.$inject || parseAnnotations(fn);

    // 遍历依赖项列表 inject，为每个依赖项解析其实际值：
    // 如果依赖项存在于 locals 中，则优先使用 locals 中的值。
    // 如果依赖项不在 locals 中，则调用全局的 get(dep) 方法从全局注入器中解析依赖。
    const dependencies = inject.map(dep => {
      if (hasOwnProp(locals, dep)) {
        return locals[dep];
      } else {

        // 递归
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

    // fn 是目标函数：这个函数可能是一个普通函数、类构造函数，或者带有依赖注解的函数。
    // context 是执行上下文：context 指定了函数执行时的 this 值。
    // 如果 context 为 null 或 undefined，在非严格模式下，this 会指向全局对象（如浏览器中的 window 或 Node.js 中的 global）；在严格模式下，this 会是 undefined。
    // dependencies 是参数列表：dependencies 是一个数组，包含了目标函数所需的参数。这些参数通常是通过依赖注入系统动态解析出来的，例如从全局注入器或局部依赖上下文中获取。
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
              fromParentModule[name] = [privateChildInjectorFactory, name, 'private', privateChildInjector];
            } else {
              fromParentModule[name] = [privateChildFactories[cacheIdx], name, 'private', privateChildInjectors[cacheIdx]];
            }
          } else {
            fromParentModule[name] = [provider[2], provider[1]];
          }
          matchedScopes[name] = true;
        }

        if ((provider[2] === 'factory' || provider[2] === 'type') && provider[1].$scope) {
          /* jshint -W083 */
          forceNewInstances.forEach(scope => {
            if (provider[1].$scope.indexOf(scope) !== -1) {
              fromParentModule[name] = [provider[2], provider[1]];
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
    value: function (value) {
      return value;
    }
  };

  /**
   * @param {ModuleDefinition} moduleDefinition
   * @param {Injector} injector
   */
  function createInitializer(moduleDefinition, injector) {

    const initializers = moduleDefinition.__init__ || [];

    return function () {
      initializers.forEach(initializer => {

        // eagerly resolve component (fn or string)
        // 检查 initializer 是否是字符串。
        // 如果是字符串，表示它是一个依赖的名称。
        // injector.get(initializer)：

        // 调用注入器的 get 方法，根据字符串名称解析并获取对应的依赖实例。
        // 例如，如果 initializer 是 'logger'，则 injector.get('logger') 会返回 logger 服务的实例。
        // injector.invoke(initializer)：

        // 如果 initializer 不是字符串，则假定它是一个函数。
        // 调用注入器的 invoke 方法，执行该函数，并为其注入所需的依赖。
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
      const getFromPrivateInjector = annotate(function (key) {
        return privateInjector.get(key);
      });

      // 私有模块的导出组件（__exports__）通过子注入器注册到父注入器中【父组件可以访问】
      // getFromPrivateInjector：一个工厂函数，用于从子注入器中获取依赖。
      // providers：将私有模块的导出组件注册到父注入器中，但这些组件的依赖仍然由子注入器管理。
      moduleExports.forEach(function (key) {
        providers[key] = [getFromPrivateInjector, key, 'private', privateInjector];
      });

      // ensure child injector initializes
      // slice() : 进行浅拷贝
      const initializers = (moduleDefinition.__init__ || []).slice();

      // 将一个初始化函数添加到 initializers 数组的开头，该函数会调用 privateInjector.init() 方法，用于初始化私有注入器（privateInjector）
      // init 方法在 this.init 【下面用 bootstrap 进行赋值了】
      initializers.unshift(function () {
        privateInjector.init();
      });

      // 更新 moduleDefinition 对象，向其中添加或覆盖一个名为 __init__ 的属性，并将其值设置为 initializers 数组
      // Object.assign 用于将一个或多个源对象的属性复制到目标对象中。
      // 在这里，第一个参数是一个空对象 {}，表示创建一个新的对象作为目标对象。
      // 第二个参数是 moduleDefinition，表示将原始模块定义对象的所有属性复制到新对象中。
      // 第三个参数是 { __init__: initializers }，表示将新的 __init__ 属性添加到新对象中，或者覆盖原有的 __init__ 属性
      moduleDefinition = Object.assign({}, moduleDefinition, {
        __init__: initializers
      });

      return createInitializer(moduleDefinition, privateInjector);
    }

    // normal module
    Object.keys(moduleDefinition).forEach(function (key) {

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

      /*
      factoryMap[type]：用于实例化服务的工厂函数（如 invoke 或 instantiate）。
      arrayUnwrap(type, value)：服务的定义值，可能是一个工厂函数、构造函数或直接的值。
      type：服务的类型，可能是以下之一：
      factory：表示服务是通过工厂函数创建的。
      type：表示服务是通过构造函数创建的。
      value：表示服务是一个直接的值。
      private：表示服务是一个私有模块，仅在特定作用域内可用。
      */
      providers[key] = [factoryMap[type], arrayUnwrap(type, value), type];
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

    return function () {

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
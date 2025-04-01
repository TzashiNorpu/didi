# didi 依赖注入流程

## 启动流程

```mermaid
flowchart TD
    A["new Injector(modules:[ModuleDeclaration])"] --> B["bootstrap(modules)"]
    B --> C["modules.forEach(module => {resolveDependencies(module)})"]
    C --> E["递归将 moduleDefinition.\_\_depends\_\_ 中的依赖添加到 moduleDefinitions 数组中"]
    B --> D["moudles.forEach(module => {loadModule(module)})"]
    D --> F["根据 module 对象的 key 生成对应的 providers[key],并收集这个 module 的 \_\_init\_\_[分服务和函数]"]
    B --> G["执行收集到 \_\_init\_\_ 函数"]
    subgraph Group[" "]
        C
        D
        G
    end
```

```mermaid
flowchart TD
    A["providers"] --> B["type 是 factory 的 provider 的是[invoke,fn,'factpey']"]
    A --> C["type 是 type 的 provider 的是[instantiate,fn,'type']"]
    A --> D["type 是 value 的 provider 的是[fn,value,'value']"]
    B --> E["invoke 内会递归解析 fn 的依赖项从而进行对 fn 工厂函数的调用"]
    C --> F["instantiate 内会递归解析 fn 的依赖项从而构建 Constructor 进行对 fn 的实例化"]
    D --> G["将 value 传递给 fn 获取值"]
```

## get 流程

通过 invoke 和 instantiate 调用 provider 中注册的 fn -> 递归解析和获取 fn 的依赖项
支持的依赖解析和注入的方式在 **fnDef** 函数中
providers[key]  索引 1 的元素是进行 fnDef 的位置 -> 也即 module 配置中 key 对应的数组的索引为 1 的位置[ type or factory 的值]

- 数组方式：[dep1,dep2,...,fn]
- 函数的 $inject 属性方式
- 函数的参数名自动解析、参数名注释自动解析、构造函数参数名自动解析

import {
  isArray,
  isClass
} from './util.js';

/**
 * @typedef {import('./index.js').InjectAnnotated } InjectAnnotated
 */

/**
 * @template T
 *
 * @params {[...string[], T] | ...string[], T} args
 *
 * @return {T & InjectAnnotated}
 */
export function annotate(...args) {

  if (args.length === 1 && isArray(args[0])) {
    args = args[0];
  }

  args = [...args] ;

  const fn = args.pop();

  fn.$inject = args;

  return fn;
}


// Current limitations:
// - can't put into "function arg" comments
// function /* (no parenthesis like this) */ (){}
// function abc( /* xx (no parenthesis like this) */ a, b) {}
//
// Just put the comment before function or inside:
// /* (((this is fine))) */ function(a, b) {}
// function abc(a) { /* (((this is fine))) */}
//
// - can't reliably auto-annotate constructor; we'll match the
// first constructor(...) pattern found which may be the one
// of a nested class, too.

const CONSTRUCTOR_ARGS = /constructor\s*[^(]*\(\s*([^)]*)\)/m;
const FN_ARGS = /^(?:async\s+)?(?:function\s*[^(]*)?(?:\(\s*([^)]*)\)|(\w+))/m;
const FN_ARG = /\/\*([^*]*)\*\//m;

/**
 * @param {unknown} fn
 *
 * @return {string[]}
 */

/*
 * 用于解析函数或类构造函数的参数列表，并返回参数名称的数组。它是依赖注入系统中的一个关键工具，通过解析函数的参数列表，自动识别函数所需的依赖项，从而实现动态的依赖注入。
 */
export function parseAnnotations(fn) {

  // parseAnnotations 只处理有效的函数或类构造函数
  if (typeof fn !== 'function') {
    throw new Error(`Cannot annotate "${fn}". Expected a function!`);
  }

  // 将函数 fn 转换为字符串表示形式，并使用正则表达式匹配其参数列表。
  // isClass(fn) 用于判断 fn 是否为一个类。如果是类，则使用 CONSTRUCTOR_ARGS 正则表达式匹配构造函数的参数列表；否则使用 FN_ARGS 匹配普通函数的参数列表
  const match = fn.toString().match(isClass(fn) ? CONSTRUCTOR_ARGS : FN_ARGS);

  /**
   * class MyClass {
   *   constructor(dep1, dep2) {}
   * }
   * 匹配结果为 dep1, dep2。
   * function myFunction(dep1, dep2) {} 匹配结果为 dep1, dep2。
   */
  // may parse class without constructor
  // 如果正则表达式未匹配到任何参数（例如类没有显式定义构造函数），则返回空数组。这种情况下，类可能不需要任何依赖
  if (!match) {
    return [];
  }

  // match[1]：捕获函数的参数列表（括号内的部分），例如 dep1, dep2。
  // match[2]：捕获单参数箭头函数的参数名，例如 param。
  // 如果 match[1] 存在（即匹配到了括号内的参数列表），则使用 match[1]。
  // 如果 match[1] 不存在（例如单参数箭头函数没有括号），则使用 match[2]。
  // 这种逻辑确保了无论是普通函数、类构造函数，还是箭头函数，都能正确提取参数列表。
  const args = match[1] || match[2];

  // 将参数列表字符串按逗号分割为单个参数，并逐一处理：
  // arg.match(FN_ARG)：尝试匹配参数中的注释（如果存在）。
  // (argMatch && argMatch[1] || arg).trim()：如果匹配到注释，则提取注释内容；否则使用原始参数名称。最后使用 trim() 去除多余的空格
  // function myFunction(dep1, dep2) {}
  //  parseAnnotations(myFunction);
  //  返回：['dep1', 'dep2']
  // function myFunction(/* Service A */ dep1, /* Service B */ dep2) {}
  //  parseAnnotations(myFunction);
  //  返回：['Service A', 'Service B']
  // class MyClass {
  //  constructor(dep1, dep2) {}
  // }
  //  parseAnnotations(MyClass);
  //  返回：['dep1', 'dep2']
  // class MyClass {}
  //  parseAnnotations(MyClass);
  //  返回：[]
  return args && args.split(',').map(arg => {
    const argMatch = arg.match(FN_ARG);
    return (argMatch && argMatch[1] || arg).trim();
  }) || [];
}
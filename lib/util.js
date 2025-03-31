const CLASS_PATTERN = /^class[ {]/;


/**
 * @param {function} fn
 *
 * @return {boolean}
 */
export function isClass(fn) {
  return CLASS_PATTERN.test(fn.toString());
}

/**
 * @param {any} obj
 *
 * @return {boolean}
 */
export function isArray(obj) {
  return Array.isArray(obj);
}

/**
 * @param {any} obj
 * @param {string} prop
 *
 * @return {boolean}
 */
// 用于安全地检查一个对象是否拥有某个属性作为其“自身属性”（即不从原型链继承的属性）。
/*
```javascript
const obj = {
  hasOwnProperty: () => false,
  a: 1
};
console.log(obj.hasOwnProperty('a')); // 错误结果：false
console.log(Object.prototype.hasOwnProperty.call(obj, 'a')); // 正确结果：true
```
通过 call 方法，确保调用的是原生的 hasOwnProperty 方法，而不是对象自身的实现。
```javascript
import { hasOwnProp } from './util.js';

const obj = { a: 1 };
console.log(hasOwnProp(obj, 'a')); // true
console.log(hasOwnProp(obj, 'b')); // false
console.log(hasOwnProp(obj, 'toString')); // false（继承自原型链）
```
*/
export function hasOwnProp(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
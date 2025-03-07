import SchemaType from './schematype';
import * as Types from './types/index';
import BluebirdPromise from 'bluebird';
import { getProp, setProp, delProp } from './util';
import PopulationError from './error/population';
import SchemaTypeVirtual from './types/virtual';
import { isPlainObject } from 'is-plain-object';
import type { AddSchemaTypeLoopOptions, AddSchemaTypeOptions, AddSchemaTypeSimpleOptions, Options, queryCallback, queryFilterCallback, queryParseCallback, SchemaTypeOptions } from './types';
import type Model from './model';
import type Document from './document';

const builtinTypes = new Set(['String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Buffer']);

const getSchemaType = (name: string, options: AddSchemaTypeSimpleOptions): SchemaType<any> => {
  const Type: SchemaTypeOptions = (options as any).type || options;
  const typeName = Type.name;

  if (builtinTypes.has(typeName)) {
    return new Types[typeName](name, options);
  }

  return new Type(name, options as Exclude<AddSchemaTypeSimpleOptions, SchemaTypeOptions>);
};

const checkHookType = (type: string): void => {
  if (type !== 'save' && type !== 'remove') {
    throw new TypeError('Hook type must be `save` or `remove`!');
  }
};

const hookWrapper = (fn: (...args: any[]) => void): (...args: any[]) => BluebirdPromise<any> => {
  if (fn.length > 1) {
    return BluebirdPromise.promisify(fn);
  }

  return BluebirdPromise.method(fn);
};

const execSortStack = <T = any>(stack: queryParseCallback<Document<T>>[]): queryParseCallback<Document<T>> => {
  const len = stack.length;

  return (a: Document<T>, b: Document<T>) => {
    let result: number;

    for (let i = 0; i < len; i++) {
      result = stack[i](a, b);
      if (result) break;
    }

    return result;
  };
};

const sortStack = <T = any>(path_: SchemaType<any>, key: string, sort: string | number): queryParseCallback<Document<T>> => {
  const path = path_ || new SchemaType(key);
  const descending = sort === 'desc' || sort === -1;

  return (a: Document<T>, b: Document<T>) => {
    const result = path.compare(getProp(a, key), getProp(b, key));
    return descending && result ? result * -1 : result;
  };
};

class UpdateParser {
  static updateStackNormal(key: string, update: any) {
    return (data: any) => { setProp(data, key, update); };
  }

  static updateStackOperator(path_: SchemaType<unknown>, ukey: string, key: string, update: any) {
    const path = path_ || new SchemaType(key);

    return (data: any) => {
      const result = path[ukey](getProp(data, key), update, data);
      setProp(data, key, result);
    };
  }

  // eslint-disable-next-line no-useless-constructor
  constructor(private paths: Record<string, SchemaType<any>>) { }

  /**
   * Parses updating expressions and returns a stack.
   *
   * @param {Object} updates
   * @param {queryCallback[]} [stack]
   * @private
   */
  parseUpdate<T>(updates: object, prefix = '', stack: queryCallback<T>[] = []): queryCallback<T>[] {
    const { paths } = this;
    const { updateStackOperator } = UpdateParser;
    const keys = Object.keys(updates);
    let path: SchemaType<any>, prefixNoDot: string;

    if (prefix) {
      prefixNoDot = prefix.substring(0, prefix.length - 1);
      path = paths[prefixNoDot];
    }

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const update = updates[key];
      const name = prefix + key;

      // Update operators
      if (key[0] === '$') {
        const ukey = `u${key}`;

        // First-class update operators
        if (prefix) {
          stack.push(updateStackOperator(path, ukey, prefixNoDot, update));
        } else { // Inline update operators
          const fields = Object.keys(update);
          const fieldLen = fields.length;

          for (let j = 0; j < fieldLen; j++) {
            const field = fields[i];
            stack.push(updateStackOperator(paths[field], ukey, field, update[field]));
          }
        }
      } else if (isPlainObject(update)) {
        this.parseUpdate(update, `${name}.`, stack);
      } else {
        stack.push(UpdateParser.updateStackNormal(name, update));
      }
    }

    return stack;
  }
}

/**
 * @private
 */
class QueryParser {
  // eslint-disable-next-line no-useless-constructor
  constructor(private paths: Record<string, SchemaType<any>>) { }

  /**
   *
   * @param {string} name
   * @param {*} query
   * @return {queryFilterCallback}
   */
  queryStackNormal(name: string, query: unknown): queryFilterCallback {
    const path = this.paths[name] || new SchemaType(name);

    return (data: unknown) => path.match(getProp(data, name), query, data);
  }

  /**
   *
   * @param {string} qkey
   * @param {string} name
   * @param {*} query
   * @return {queryFilterCallback}
   */
  queryStackOperator(qkey: string, name: string, query: any): queryFilterCallback {
    const path = this.paths[name] || new SchemaType(name);

    return (data: unknown) => path[qkey](getProp(data, name), query, data);
  }

  /**
   * @param {Array} arr
   * @param {queryFilterCallback[]} stack The function generated by query is added to the stack.
   * @return {void}
   * @private
   */
  $and(arr: object[], stack: queryFilterCallback[]): void {
    for (let i = 0, len = arr.length; i < len; i++) {
      stack.push(this.execQuery(arr[i]));
    }
  }

  /**
   * @param {Array} query
   * @return {queryFilterCallback}
   * @private
   */
  $or(query: object[]): queryFilterCallback {
    const stack = this.parseQueryArray(query);
    const len = stack.length;

    return data => {
      for (let i = 0; i < len; i++) {
        if (stack[i](data)) return true;
      }

      return false;
    };
  }

  /**
   * @param {Array} query
   * @return {queryFilterCallback}
   * @private
   */
  $nor(query: object[]): queryFilterCallback {
    const stack = this.parseQueryArray(query);
    const len = stack.length;

    return data => {
      for (let i = 0; i < len; i++) {
        if (stack[i](data)) return false;
      }

      return true;
    };
  }

  /**
   * @param {*} query
   * @return {queryFilterCallback}
   * @private
   */
  $not(query: object): queryFilterCallback {
    const stack = this.parseQuery(query);
    const len = stack.length;

    return data => {
      for (let i = 0; i < len; i++) {
        if (!stack[i](data)) return true;
      }

      return false;
    };
  }

  /**
   * @callback queryWherecallback
   * @return {boolean}
   * @this {QueryPerser}
   */

  /**
   * @param {queryWherecallback} fn
   * @return {queryFilterCallback}
   * @private
   */
  $where(fn: () => boolean): queryFilterCallback {
    return data => Reflect.apply(fn, data, []);
  }

  /**
   * Parses array of query expressions and returns a stack.
   *
   * @param {Array} arr
   * @return {queryFilterCallback[]}
   * @private
   */
  parseQueryArray(arr: object[]): queryFilterCallback[] {
    const stack: queryFilterCallback[] = [];
    this.$and(arr, stack);
    return stack;
  }

  /**
   * Parses normal query expressions and returns a stack.
   *
   * @param {Object} queries
   * @param {String} prefix
   * @param {queryFilterCallback[]} [stack] The function generated by query is added to the stack passed in this argument. If not passed, a new stack will be created.
   * @return {void}
   * @private
   */
  parseNormalQuery(queries: object, prefix: string, stack: queryFilterCallback[] = []): void {
    const keys = Object.keys(queries);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const query = queries[key];

      if (key[0] === '$') {
        stack.push(this.queryStackOperator(`q${key}`, prefix, query));
        continue;
      }

      const name = `${prefix}.${key}`;
      if (isPlainObject(query)) {
        this.parseNormalQuery(query, name, stack);
      } else {
        stack.push(this.queryStackNormal(name, query));
      }
    }
  }

  /**
   * Parses query expressions and returns a stack.
   *
   * @param {Object} queries
   * @return {queryFilterCallback[]}
   * @private
   */
  parseQuery(queries: object): queryFilterCallback[] {

    /** @type {queryFilterCallback[]} */
    const stack: queryFilterCallback[] = [];
    const keys = Object.keys(queries);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const query = queries[key];

      switch (key) {
        case '$and':
          this.$and(query, stack);
          break;

        case '$or':
          stack.push(this.$or(query));
          break;

        case '$nor':
          stack.push(this.$nor(query));
          break;

        case '$not':
          stack.push(this.$not(query));
          break;

        case '$where':
          stack.push(this.$where(query));
          break;

        default:
          if (isPlainObject(query)) {
            this.parseNormalQuery(query, key, stack);
          } else {
            stack.push(this.queryStackNormal(key, query));
          }
      }
    }

    return stack;
  }

  /**
   * Returns a function for querying.
   *
   * @param {Object} query
   * @return {queryFilterCallback}
   * @private
   */
  execQuery(query: object): queryFilterCallback {
    const stack = this.parseQuery(query);
    const len = stack.length;

    return data => {
      for (let i = 0; i < len; i++) {
        if (!stack[i](data)) return false;
      }

      return true;
    };
  }
}


class Schema<T = any> {
  paths: Record<string, SchemaType<any>> = {};
  statics: Record<string, (this: Model<T>, ...args: any[]) => any> = {};
  methods: Record<string, (this: T, ...args: any[]) => any> = {};
  hooks: {
    pre: {
      save: ((data: any) => BluebirdPromise<any>)[]
      remove: ((data: any) => BluebirdPromise<any>)[]
    };
    post: {
      save: ((data: any) => BluebirdPromise<any>)[]
      remove: ((data: any) => BluebirdPromise<any>)[]
    };
  };
  stacks: {
    getter: ((data: object) => void)[];
    setter: ((data: object) => void)[];
    import: ((data: object) => void)[];
    export: ((data: object) => void)[];
  };

  /**
   * Schema constructor.
   *
   * @param {Object} [schema]
   */
  constructor(schema?: Record<string, AddSchemaTypeOptions>) {
    this.hooks = {
      pre: {
        save: [],
        remove: []
      },
      post: {
        save: [],
        remove: []
      }
    };

    this.stacks = {
      getter: [],
      setter: [],
      import: [],
      export: []
    };

    if (schema) {
      this.add(schema);
    }
  }

  /**
   * Adds paths.
   *
   * @param {Object} schema
   * @param {String} prefix
   */
  add(schema: Record<string, AddSchemaTypeOptions>, prefix = ''): void {
    const keys = Object.keys(schema);
    const len = keys.length;

    if (!len) return;

    for (let i = 0; i < len; i++) {
      const key = keys[i];
      const value = schema[key];

      this.path(prefix + key, value);
    }
  }

  /**
   * Gets/Sets a path.
   *
   * @param {String} name
   * @param {*} obj
   * @return {SchemaType | undefined}
   */
  path(name: string): SchemaType<any>;
  path(name: string, obj: AddSchemaTypeOptions): void;
  path(name: string, obj?: AddSchemaTypeOptions): SchemaType<any> | void {
    if (obj == null) {
      return this.paths[name];
    }

    let type;
    let nested = false;

    if (obj instanceof SchemaType) {
      type = obj;
    } else {
      switch (typeof obj) {
        case 'function':
          type = getSchemaType(name, { type: obj });
          break;

        case 'object':
          if (Array.isArray(obj)) {
            type = new Types.Array(name, {
              child: obj.length ? getSchemaType(name, obj[0]) : new SchemaType(name)
            });
          } else if (obj.type) {
            type = getSchemaType(name, obj as { type: SchemaTypeOptions; });
          } else {
            type = new Types.Object();
            nested = Object.keys(obj).length > 0;
          }

          break;

        default:
          throw new TypeError(`Invalid value for schema path \`${name}\``);
      }
    }

    this.paths[name] = type;
    this._updateStack(name, type);

    if (nested) this.add(obj as AddSchemaTypeLoopOptions, `${name}.`);
  }

  /**
   * Updates cache stacks.
   *
   * @param {String} name
   * @param {SchemaType} type
   * @private
   */
  _updateStack(name: string, type: SchemaType<unknown>): void {
    const { stacks } = this;

    stacks.getter.push(data => {
      const value = getProp(data, name);
      const result = type.cast(value, data);

      if (result !== undefined) {
        setProp(data, name, result);
      }
    });

    stacks.setter.push(data => {
      const value = getProp(data, name);
      const result = type.validate(value, data);

      if (result !== undefined) {
        setProp(data, name, result);
      } else {
        delProp(data, name);
      }
    });

    stacks.import.push(data => {
      const value = getProp(data, name);
      const result = type.parse(value);

      if (result !== undefined) {
        setProp(data, name, result);
      }
    });

    stacks.export.push(data => {
      const value = getProp(data, name);
      const result = type.value(value, data);

      if (result !== undefined) {
        setProp(data, name, result);
      } else {
        delProp(data, name);
      }
    });
  }

  /**
   * Adds a virtual path.
   *
   * @param {String} name
   * @param {Function} [getter]
   * @return {SchemaType.Virtual}
   */
  virtual(name: string, getter?: (this: T) => any): SchemaTypeVirtual<T> {
    const virtual = new Types.Virtual(name, {});
    if (getter) virtual.get(getter);

    this.path(name, virtual);

    return virtual;
  }

  /**
   * Adds a pre-hook.
   *
   * @param {String} type Hook type. One of `save` or `remove`.
   * @param {Function} fn
   */
  pre(type: keyof Schema['hooks']['pre'], fn: (...args: any[]) => void): void {
    checkHookType(type);
    if (typeof fn !== 'function') throw new TypeError('Hook must be a function!');

    this.hooks.pre[type].push(hookWrapper(fn));
  }

  /**
   * Adds a post-hook.
   *
   * @param {String} type Hook type. One of `save` or `remove`.
   * @param {Function} fn
   */
  post(type: keyof Schema['hooks']['post'], fn: (...args: any[]) => void): void {
    checkHookType(type);
    if (typeof fn !== 'function') throw new TypeError('Hook must be a function!');

    this.hooks.post[type].push(hookWrapper(fn));
  }

  /**
   * Adds a instance method.
   *
   * @param {String} name
   * @param {Function} fn
   */
  method(name: string, fn: (this: T, ...args: any[]) => any) {
    if (!name) throw new TypeError('Method name is required!');

    if (typeof fn !== 'function') {
      throw new TypeError('Instance method must be a function!');
    }

    this.methods[name] = fn;
  }

  /**
   * Adds a static method.
   *
   * @param {String} name
   * @param {Function} fn
   */
  static(name: string, fn: (this: Model<T>, ...args: any[]) => any) {
    if (!name) throw new TypeError('Method name is required!');

    if (typeof fn !== 'function') {
      throw new TypeError('Static method must be a function!');
    }

    this.statics[name] = fn;
  }

  /**
   * Apply getters.
   *
   * @param {Object} data
   * @return {void}
   * @private
   */
  _applyGetters(data: object): void {
    const stack = this.stacks.getter;

    for (let i = 0, len = stack.length; i < len; i++) {
      stack[i](data);
    }
  }

  /**
   * Apply setters.
   *
   * @param {Object} data
   * @return {void}
   * @private
   */
  _applySetters(data: object): void {
    const stack = this.stacks.setter;

    for (let i = 0, len = stack.length; i < len; i++) {
      stack[i](data);
    }
  }

  /**
   * Parses database.
   *
   * @param {Object} data
   * @return {Object}
   * @private
   */
  _parseDatabase(data: object): any {
    const stack = this.stacks.import;

    for (let i = 0, len = stack.length; i < len; i++) {
      stack[i](data);
    }

    return data;
  }

  /**
   * Exports database.
   *
   * @param {Object} data
   * @return {Object}
   * @private
   */
  _exportDatabase(data: object): any {
    const stack = this.stacks.export;

    for (let i = 0, len = stack.length; i < len; i++) {
      stack[i](data);
    }

    return data;
  }

  /**
   * Parses updating expressions and returns a stack.
   *
   * @param {Object} updates
   * @return {queryCallback[]}
   * @private
   */
  _parseUpdate(updates: object): queryCallback<T>[] {
    return new UpdateParser(this.paths).parseUpdate(updates);
  }

  /**
   * Returns a function for querying.
   *
   * @param {Object} query
   * @return {queryFilterCallback}
   * @private
   */
  _execQuery(query: object): queryFilterCallback {
    return new QueryParser(this.paths).execQuery(query);
  }


  /**
   * Parses sorting expressions and returns a stack.
   *
   * @param {Object} sorts
   * @param {string} [prefix]
   * @param {queryParseCallback[]} [stack]
   * @return {queryParseCallback[]}
   * @private
   */
  _parseSort(sorts: Record<string, number | string | Record<string, any>>, prefix = '', stack: queryParseCallback<Document<T>>[] = []): queryParseCallback<Document<T>>[] {
    const { paths } = this;
    const keys = Object.keys(sorts);

    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const sort = sorts[key];
      const name = prefix + key;

      if (typeof sort === 'object') {
        this._parseSort(sort, `${name}.`, stack);
      } else {
        stack.push(sortStack(paths[name], name, sort));
      }
    }

    return stack;
  }

  /**
   * Returns a function for sorting.
   *
   * @param {Object} sorts
   * @return {queryParseCallback}
   * @private
   */
  _execSort(sorts: Record<string, number | string | Record<string, any>>): queryParseCallback<Document<T>> {
    const stack = this._parseSort(sorts);
    return execSortStack(stack);
  }

  /**
   * Parses population expression and returns a stack.
   *
   * @param {String|Object} expr
   * @return {PopulateResult[]}
   * @private
   */
  _parsePopulate(expr: string | string[] | Partial<Options>[] | Partial<Options>): Partial<Options>[] {
    const { paths } = this;
    const arr: Partial<Options>[] = [];

    if (typeof expr === 'string') {
      const split = expr.split(' ');

      for (let i = 0, len = split.length; i < len; i++) {
        arr[i] = { path: split[i] };
      }
    } else if (Array.isArray(expr)) {
      for (let i = 0, len = expr.length; i < len; i++) {
        const item = expr[i];

        arr[i] = typeof item === 'string' ? { path: item } : item;
      }
    } else {
      arr[0] = expr;
    }

    for (let i = 0, len = arr.length; i < len; i++) {
      const item = arr[i];
      const key = item.path;

      if (!key) {
        throw new PopulationError('path is required');
      }

      if (!item.model) {
        const path = paths[key];
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const ref = path.child ? path.child.options.ref : path.options.ref;

        if (!ref) {
          throw new PopulationError('model is required');
        }

        item.model = ref;
      }
    }

    return arr;
  }
  Types: typeof Types;
  static Types = Types;
}

Schema.prototype.Types = Types;

export default Schema;

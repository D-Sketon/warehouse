import { setProp } from './util';
import ValidationError from './error/validation';

/**
 * This is the basic schema type.
 * All schema types should inherit from this class.
 * For example:
 *
 * ``` js
 * class SchemaTypeCustom extends SchemaType {};
 * ```
 *
 * **Query operators**
 *
 * To add a query operator, defines a method whose name is started with `q$`.
 * For example:
 *
 * ``` js
 * SchemaTypeCustom.q$foo = function(value, query, data){
 *   // ...
 * };
 * ```
 *
 * The `value` parameter is the value of specified field; the `query` parameter
 * is the value passed to the query operator; the `data` parameter is the
 * complete data.
 *
 * The return value must be a boolean indicating whether the data passed.
 *
 * **Update operators**
 *
 * To add a update operator, defines a method whose name is started with `u$`.
 * For example:
 *
 * ``` js
 * SchemaTypeCustom.u$foo = function(value, update, data){
 *   // ...
 * };
 * ```
 *
 * The `value` parameter is the value of specified field; the `update` parameter
 * is the value passed to the update operator; the `data` parameter is the
 * complete data.
 *
 * The return value will replace the original data.
 */
class SchemaType<T> {
  options: { required: boolean; default?: (() => T) | T; };
  default: () => T;

  /**
   * SchemaType constructor.
   *
   * @param {String} name
   * @param {Object} [options]
   *   @param {Boolean} [options.required=false]
   *   @param {*} [options.default]
   */
  constructor(public name: string = '', options?: { required?: boolean; default?: (() => T) | T; }) {
    this.options = Object.assign({
      required: false
    }, options);

    const default_ = this.options.default;

    if (typeof default_ === 'function') {
      this.default = default_ as () => T;
    } else {
      this.default = () => default_;
    }
  }

  /**
   * Casts data. This function is used by getters to cast an object to document
   * instances. If the value is null, the default value will be returned.
   *
   * @param {*} value
   * @param {Object} data
   * @return {*}
   */
  cast(value?: unknown, data?: unknown): unknown {
    if (value == null) {
      return this.default();
    }

    return value;
  }

  /**
   * Validates data. This function is used by setters.
   *
   * @param {*} value
   * @param {Object} data
   * @return {*|Error}
   */
  validate(value: unknown, data?: unknown): unknown {
    if (this.options.required && value == null) {
      throw new ValidationError(`\`${this.name}\` is required!`);
    }

    return value;
  }

  /**
   * Compares data. This function is used when sorting.
   *
   * @param {*} a
   * @param {*} b
   * @return {Number}
   */
  compare(a: unknown, b: unknown): number {
    if (a > b) {
      return 1;
    } else if (a < b) {
      return -1;
    }

    return 0;
  }

  /**
   * Parses data. This function is used when restoring data from database files.
   *
   * @param {*} value
   * @param {Object} data
   * @return {*}
   */
  parse(value: unknown): any {
    return value;
  }

  /**
   * Transforms value. This function is used when saving data to database files.
   *
   * @param {*} value
   * @param {Object} data
   * @return {*}
   */
  value(value: unknown, data?: unknown): any {
    return value;
  }

  /**
   * Checks the equality of data.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  match(value: T, query: unknown, data?: unknown): boolean {
    return value === query;
  }

  /**
   * Checks the existance of data.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$exist(value: unknown, query: unknown, data?: unknown): boolean {
    return (value != null) === query;
  }

  /**
   * Checks the equality of data. Returns true if the value doesn't match.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {boolean}
   */
  q$ne(value: T, query: unknown, data?: unknown): boolean {
    return !this.match(value, query, data);
  }

  /**
   * Checks whether `value` is less than (i.e. <) the `query`.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$lt(value: unknown, query: unknown, data?: unknown): boolean {
    return value < query;
  }

  /**
   * Checks whether `value` is less than or equal to (i.e. <=) the `query`.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$lte(value: unknown, query: unknown, data?: unknown): boolean {
    return value <= query;
  }

  /**
   * Checks whether `value` is greater than (i.e. >) the `query`.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$gt(value: unknown, query: unknown, data?: unknown): boolean {
    return value > query;
  }

  /**
   * Checks whether `value` is greater than or equal to (i.e. >=) the `query`.
   *
   * @param {*} value
   * @param {*} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$gte(value: unknown, query: unknown, data?: unknown): boolean {
    return value >= query;
  }

  /**
   * Checks whether `value` is equal to one of elements in `query`.
   *
   * @param {*} value
   * @param {Array} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$in(value: unknown, query: unknown[], data?: unknown): boolean {
    return query.includes(value);
  }

  /**
   * Checks whether `value` is not equal to any elements in `query`.
   *
   * @param {*} value
   * @param {Array} query
   * @param {Object} data
   * @return {Boolean}
   */
  q$nin(value: unknown, query: unknown[], data?: unknown): boolean {
    return !query.includes(value);
  }

  /**
   * Sets the value.
   *
   * @param {*} value
   * @param {*} update
   * @param {Object} data
   * @return {*}
   */
  u$set<T>(value: unknown, update: T, data?: unknown): T {
    return update;
  }

  /**
   * Unsets the value.
   *
   * @param {*} value
   * @param {*} update
   * @param {Object} data
   * @return {*}
   */
  u$unset<T>(value: T, update: boolean, data?: unknown): T | undefined { return update ? undefined : value; }

  /**
   * Renames a field.
   *
   * @param {*} value
   * @param {*} update
   * @param {Object} data
   * @return {*}
   */
  u$rename(value: unknown, update: string, data: unknown): void {
    if (value !== undefined) setProp(data, update, value);
    return undefined;
  }

  q$exists: SchemaType<T>['q$exist'];
  q$max: SchemaType<T>['q$lte'];
  q$min: SchemaType<T>['q$gte'];
}

SchemaType.prototype.q$exists = SchemaType.prototype.q$exist;

SchemaType.prototype.q$max = SchemaType.prototype.q$lte;

SchemaType.prototype.q$min = SchemaType.prototype.q$gte;

export default SchemaType;

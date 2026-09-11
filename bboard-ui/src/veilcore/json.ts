// Validation at the API boundary.
//
// `res.json()` returns `any`, and `any` disables type checking for everything it
// touches. A malformed response then flows through the app as though it were the
// shape we expected, and the first sign of trouble is a render error somewhere
// unrelated to the request that caused it.
//
// These read a response as `unknown` and narrow it deliberately. A body that does
// not match is rejected at the point it arrives, which is the only place there is
// enough context to say what was wrong.
//
// SPDX-License-Identifier: Apache-2.0

/** Parse a response body without asserting anything about its shape. */
export const readJson = async (res: Response): Promise<unknown> => {
  return (await res.json()) as unknown;
};

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/** Optional field: absent is fine, present must match. */
export const optional = <T>(v: unknown, guard: (x: unknown) => x is T): boolean =>
  v === undefined || v === null || guard(v);

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

/**
 * A named array field on a response body, with malformed members dropped.
 *
 * Dropping rather than rejecting the whole response is deliberate for lists: one
 * bad row should not blank a holder's entire set, and the rows that are well
 * formed are still true.
 */
export const arrayField = <T>(body: unknown, field: string, guard: (x: unknown) => x is T): T[] => {
  if (!isObject(body)) return [];
  const value = body[field];
  return Array.isArray(value) ? value.filter(guard) : [];
};

/** A whole response body that should be an array. */
export const asArray = <T>(body: unknown, guard: (x: unknown) => x is T): T[] =>
  Array.isArray(body) ? body.filter(guard) : [];

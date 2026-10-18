import type { PoolClient, QueryResultRow } from 'pg';

import { pool } from './pool.js';

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type FindOptions = {
  columns?: readonly string[];
  orderBy?: { column: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
};

function quoteIdentifier(name: string): string {
  return name
    .split('.')
    .map((part) => {
      if (!IDENTIFIER_PATTERN.test(part)) {
        throw new Error(`非法的表名或字段名：${name}`);
      }

      return `"${part}"`;
    })
    .join('.');
}

function columnList(columns: readonly string[] = ['*']): string {
  if (columns.length === 0 || columns.includes('*')) {
    return '*';
  }

  return columns.map(quoteIdentifier).join(', ');
}

function buildOrderBy(orderBy?: FindOptions['orderBy']): string {
  if (!orderBy) {
    return '';
  }

  const direction = orderBy.direction === 'desc' ? 'desc' : 'asc';

  return ` order by ${quoteIdentifier(orderBy.column)} ${direction}`;
}

function nonNegativeInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }

  return value;
}

function buildLimitOffset(limit?: number, offset?: number): string {
  const clauses: string[] = [];

  if (limit !== undefined) {
    clauses.push(`limit ${nonNegativeInt(limit, 'limit')}`);
  }

  if (offset !== undefined) {
    clauses.push(`offset ${nonNegativeInt(offset, 'offset')}`);
  }

  return clauses.length > 0 ? ` ${clauses.join(' ')}` : '';
}

function buildWhere(where: Record<string, unknown>, params: unknown[]): string {
  const columns = Object.keys(where);

  if (columns.length === 0) {
    return '';
  }

  const conditions = columns.map((column) => {
    params.push(where[column]);
    return `${quoteIdentifier(column)} = $${params.length}`;
  });

  return ` where ${conditions.join(' and ')}`;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);

  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);

  return rows[0] ?? null;
}

export async function findById<T extends QueryResultRow = QueryResultRow>(
  table: string,
  id: unknown,
  columns: readonly string[] = ['*'],
): Promise<T | null> {
  if (id === undefined || id === null) {
    throw new Error('findById 需要有效的 id');
  }

  return findOne<T>(table, { id }, columns);
}

export async function findOne<T extends QueryResultRow = QueryResultRow>(
  table: string,
  where: Record<string, unknown>,
  columns: readonly string[] = ['*'],
): Promise<T | null> {
  if (Object.keys(where).length === 0) {
    throw new Error('findOne 必须提供 where 条件');
  }

  const params: unknown[] = [];
  const sql = `select ${columnList(columns)} from ${quoteIdentifier(table)}${buildWhere(where, params)} limit 1`;

  return queryOne<T>(sql, params);
}

export async function findMany<T extends QueryResultRow = QueryResultRow>(
  table: string,
  where: Record<string, unknown> = {},
  options: FindOptions = {},
): Promise<T[]> {
  const params: unknown[] = [];
  const sql = [
    `select ${columnList(options.columns)} from ${quoteIdentifier(table)}`,
    buildWhere(where, params),
    buildOrderBy(options.orderBy),
    buildLimitOffset(options.limit, options.offset),
  ].join('');

  return query<T>(sql, params);
}

export async function execute(sql: string, params: readonly unknown[] = []): Promise<number> {
  const result = await pool.query(sql, params as unknown[]);

  return result.rowCount ?? 0;
}

export async function insert<T extends QueryResultRow = QueryResultRow>(
  table: string,
  data: Record<string, unknown>,
  returning: readonly string[] = ['*'],
): Promise<T | null> {
  const columns = Object.keys(data);

  if (columns.length === 0) {
    throw new Error('insert 至少需要一个字段');
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const sql = [
    `insert into ${quoteIdentifier(table)}`,
    `(${columns.map(quoteIdentifier).join(', ')})`,
    `values (${placeholders.join(', ')})`,
    `returning ${columnList(returning)}`,
  ].join(' ');

  return queryOne<T>(sql, Object.values(data));
}

export async function insertMany<T extends QueryResultRow = QueryResultRow>(
  table: string,
  rows: readonly Record<string, unknown>[],
  returning: readonly string[] = ['*'],
): Promise<T[]> {
  const firstRow = rows[0];

  if (!firstRow) {
    return [];
  }

  const columns = Object.keys(firstRow);
  const params: unknown[] = [];

  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      if (!(column in row)) {
        throw new Error(`insertMany 的每行字段必须一致，缺少：${column}`);
      }

      params.push(row[column]);
      return `$${params.length}`;
    });

    return `(${placeholders.join(', ')})`;
  });

  const sql = [
    `insert into ${quoteIdentifier(table)}`,
    `(${columns.map(quoteIdentifier).join(', ')})`,
    `values ${tuples.join(', ')}`,
    `returning ${columnList(returning)}`,
  ].join(' ');

  return query<T>(sql, params);
}

export async function update<T extends QueryResultRow = QueryResultRow>(
  table: string,
  data: Record<string, unknown>,
  where: Record<string, unknown>,
  returning: readonly string[] = ['*'],
): Promise<T[]> {
  const columns = Object.keys(data);

  if (columns.length === 0) {
    throw new Error('update 至少需要一个字段');
  }

  if (Object.keys(where).length === 0) {
    throw new Error('update 必须提供 where 条件，拒绝全表更新');
  }

  const params: unknown[] = [];

  const setSql = columns
    .map((column) => {
      params.push(data[column]);
      return `${quoteIdentifier(column)} = $${params.length}`;
    })
    .join(', ');

  const sql = [
    `update ${quoteIdentifier(table)}`,
    `set ${setSql}`,
    buildWhere(where, params),
    `returning ${columnList(returning)}`,
  ].join(' ');

  return query<T>(sql, params);
}

export async function remove(table: string, where: Record<string, unknown>): Promise<number> {
  if (Object.keys(where).length === 0) {
    throw new Error('remove 必须提供 where 条件，拒绝清空整表');
  }

  const params: unknown[] = [];
  const sql = `delete from ${quoteIdentifier(table)}${buildWhere(where, params)}`;

  return execute(sql, params);
}

export async function count(table: string, where: Record<string, unknown> = {}): Promise<number> {
  const params: unknown[] = [];
  const sql = [
    'select count(*)::text as count from',
    quoteIdentifier(table),
    buildWhere(where, params),
  ].join(' ');

  const row = await queryOne<{ count: string }>(sql, params);

  return Number(row?.count ?? 0);
}

export async function exists(table: string, where: Record<string, unknown>): Promise<boolean> {
  if (Object.keys(where).length === 0) {
    throw new Error('exists 必须提供 where 条件');
  }

  const params: unknown[] = [];
  const sql = [
    'select exists(select 1 from',
    `${quoteIdentifier(table)}${buildWhere(where, params)}) as exists`,
  ].join(' ');

  const row = await queryOne<{ exists: boolean }>(sql, params);

  return row?.exists ?? false;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');

    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

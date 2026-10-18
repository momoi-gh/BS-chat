import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import * as db from '../src/db/dbfunc.js';

const table = 'dbfunc_test_items';

type Item = { id: number; name: string; score: number };

beforeAll(async () => {
  await db.execute(`drop table if exists ${table}`);
  await db.execute(`create table ${table} (id serial primary key, name text not null, score int)`);
});

afterAll(async () => {
  await db.execute(`drop table if exists ${table}`);
});

describe('dbfunc', () => {
  it('insert / insertMany / query / queryOne', async () => {
    const first = await db.insert<Item>(table, { name: 'alice', score: 10 });
    expect(first?.id).toBe(1);

    const many = await db.insertMany<Item>(table, [
      { name: 'bob', score: 20 },
      { name: 'carol', score: 30 },
    ]);
    expect(many).toHaveLength(2);

    const rows = await db.query<Item>(`select * from ${table} order by id`);
    expect(rows).toHaveLength(3);

    const one = await db.queryOne<Item>(`select * from ${table} where name = $1`, ['bob']);
    expect(one?.score).toBe(20);
    expect(
      await db.queryOne<Item>(`select * from ${table} where name = $1`, ['nobody']),
    ).toBeNull();
  });

  it('findById / findOne / findMany', async () => {
    const byId = await db.findById<Item>(table, 1);
    expect(byId?.name).toBe('alice');

    const byName = await db.findOne<Item>(table, { name: 'carol' }, ['id', 'name']);
    expect(byName).toEqual({ id: 3, name: 'carol' });

    const page = await db.findMany<Item>(
      table,
      {},
      {
        columns: ['id', 'name'],
        orderBy: { column: 'id', direction: 'desc' },
        limit: 2,
        offset: 1,
      },
    );
    expect(page.map((item) => item.id)).toEqual([2, 1]);
  });

  it('update / count / exists / remove', async () => {
    const updated = await db.update<Item>(table, { score: 99 }, { id: 1 });
    expect(updated[0]?.score).toBe(99);
    expect(await db.count(table)).toBe(3);
    expect(await db.count(table, { score: 99 })).toBe(1);
    expect(await db.exists(table, { name: 'bob' })).toBe(true);
    expect(await db.exists(table, { name: 'nobody' })).toBe(false);

    const removed = await db.remove(table, { name: 'carol' });
    expect(removed).toBe(1);
    expect(await db.count(table)).toBe(2);
  });

  it('transaction 成功提交、异常回滚', async () => {
    const result = await db.transaction(async (client) => {
      const res = await client.query<{ count: string }>(
        `select count(*)::text as count from ${table}`,
      );
      return Number(res.rows[0]?.count ?? 0);
    });
    expect(result).toBe(2);

    await expect(
      db.transaction(async (client) => {
        await client.query(`insert into ${table} (name, score) values ($1, $2)`, ['rollback', 1]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await db.count(table, { name: 'rollback' })).toBe(0);
  });

  it('防护：空字段、空 where、非法标识符、非法分页', async () => {
    await expect(db.insert(table, {})).rejects.toThrow('至少需要一个字段');
    await expect(db.update(table, {}, { id: 1 })).rejects.toThrow('至少需要一个字段');
    await expect(db.update(table, { score: 1 }, {})).rejects.toThrow('必须提供 where');
    await expect(db.remove(table, {})).rejects.toThrow('必须提供 where');
    await expect(db.findById(table, null)).rejects.toThrow('需要有效的 id');
    await expect(db.findOne(table, {})).rejects.toThrow('必须提供 where');
    await expect(db.insertMany(table, [{ name: 'a', score: 1 }, { name: 'b' }])).rejects.toThrow(
      '字段必须一致',
    );
    await expect(db.findMany(table, {}, { limit: -1 })).rejects.toThrow('非负整数');
    await expect(
      db.findMany(table, {}, { orderBy: { column: 'id; drop table x' } }),
    ).rejects.toThrow('非法');
  });
});

import { UnitOfWork, isRetryableTransactionError, MAX_TRANSACTION_ATTEMPTS } from './UnitOfWork.service';

const deadlock = () => Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

function fakeKnex() {
  const log: string[] = [];
  const knex: any = {
    transaction: async () => ({
      commit: async () => log.push('commit'),
      rollback: async () => log.push('rollback'),
    }),
  };
  return { log, unit: new UnitOfWork(() => knex) };
}

describe('UnitOfWork.withTransaction', () => {
  it('commits and returns the result', async () => {
    const { log, unit } = fakeKnex();
    await expect(unit.withTransaction(async () => 42)).resolves.toBe(42);
    expect(log).toEqual(['commit']);
  });

  it('retries the work after a deadlock', async () => {
    const { log, unit } = fakeKnex();
    let calls = 0;
    const result = await unit.withTransaction(async () => {
      calls++;
      if (calls === 1) throw deadlock();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(log).toEqual(['rollback', 'commit']);
  });

  it('gives up after the last attempt', async () => {
    const { unit } = fakeKnex();
    let calls = 0;
    await expect(
      unit.withTransaction(async () => {
        calls++;
        throw deadlock();
      }),
    ).rejects.toThrow('Deadlock found');
    expect(calls).toBe(MAX_TRANSACTION_ATTEMPTS);
  });

  it('does not retry other errors', async () => {
    const { log, unit } = fakeKnex();
    let calls = 0;
    await expect(
      unit.withTransaction(async () => {
        calls++;
        throw new Error('validation');
      }),
    ).rejects.toThrow('validation');
    expect(calls).toBe(1);
    expect(log).toEqual(['rollback']);
  });

  it('inside an outer transaction, runs once and leaves commit and retry to the owner', async () => {
    const { log, unit } = fakeKnex();
    const outer: any = {};
    let calls = 0;
    await expect(
      unit.withTransaction(async (t) => {
        calls++;
        expect(t).toBe(outer);
        throw deadlock();
      }, outer),
    ).rejects.toThrow('Deadlock found');
    expect(calls).toBe(1);
    expect(log).toEqual([]);
  });

  it('recognises deadlocks wrapped by objection (nativeError)', () => {
    expect(isRetryableTransactionError({ nativeError: deadlock() })).toBe(true);
    expect(isRetryableTransactionError({ nativeError: { errno: 1205 } })).toBe(true);
    expect(isRetryableTransactionError(new Error('other'))).toBe(false);
  });
});

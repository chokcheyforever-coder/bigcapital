import { Transaction } from 'objection';
import { Knex } from 'knex';
import { Inject, Injectable } from '@nestjs/common';
import { IsolationLevel } from './TransactionsHooks';
import { TENANCY_DB_CONNECTION } from '@/modules/Tenancy/TenancyDB/TenancyDB.constants';

// 103 DiTech: concurrent writes in one company (several staff posting at
// once) can deadlock in MariaDB; the database rolls one transaction back and
// expects the client to retry it. Seen in the Stage 7 load test as HTTP 500s.
const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const RETRYABLE_ERRNOS = new Set([1213, 1205]);
export const MAX_TRANSACTION_ATTEMPTS = 3;

export function isRetryableTransactionError(error: any): boolean {
  for (let e = error, depth = 0; e && depth < 3; e = e.nativeError ?? e.cause, depth++) {
    if (RETRYABLE_CODES.has(e.code) || RETRYABLE_ERRNOS.has(e.errno)) return true;
  }
  return false;
}

const backoff = (attempt: number) =>
  new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 75 * attempt));

@Injectable()
export class UnitOfWork {
  constructor(
    @Inject(TENANCY_DB_CONNECTION)
    private readonly tenantKex: () => Knex,
  ) {}

  /**
   * Runs the work in a transaction. When this call owns the transaction (no
   * outer `trx`), a deadlock or lock-wait timeout rolls it back and runs the
   * work again, up to MAX_TRANSACTION_ATTEMPTS times. Inside an outer
   * transaction the error is passed up for the owner to retry.
   * @param {function} work - The work to be done in the transaction.
   * @param {IsolationLevel} isolationLevel
   * @returns {}
   */
  public withTransaction = async <T>(
    work: (knex: Knex.Transaction) => Promise<T> | T,
    trx?: Transaction,
    isolationLevel: IsolationLevel = IsolationLevel.READ_UNCOMMITTED,
  ): Promise<T> => {
    if (trx) return work(trx);

    const knex = this.tenantKex();
    for (let attempt = 1; ; attempt++) {
      const _trx = await knex.transaction({ isolationLevel });
      try {
        const result = await work(_trx);
        await _trx.commit();
        return result;
      } catch (error) {
        await Promise.resolve(_trx.rollback()).catch(() => undefined);
        if (attempt >= MAX_TRANSACTION_ATTEMPTS || !isRetryableTransactionError(error)) {
          throw error;
        }
        await backoff(attempt);
      }
    }
  };
}

import { EventEmitter } from 'events';
import { DiTechPolicyService, POLICY_INVALIDATE_CHANNEL } from './DiTechPolicy.service';

/** One Redis shared by every "process": publish reaches all subscribers. */
function fakeRedis() {
  const bus = new EventEmitter();
  const client = {
    publish: async (channel: string, message: string) => {
      bus.emit('publish', channel, message);
      return 1;
    },
    duplicate: () => {
      const sub = new EventEmitter() as any;
      sub.subscribe = async (channel: string) => {
        bus.on('publish', (c: string, m: string) => c === channel && sub.emit('message', c, m));
      };
      sub.quit = async () => undefined;
      return sub;
    },
  };
  return { getOrThrow: () => client } as any;
}

/** A system database holding one policy row, counting reads. */
function fakeDb() {
  const db = { status: 'active', reads: 0 };
  const builder: any = {
    join: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    first: async () => {
      db.reads++;
      return { companyRef: 'c1', status: db.status, pinnedHost: 'a.example', entitlements: '{"max_users":2}', baseCurrency: 'USD' };
    },
    insert: (row: any) => ({
      onConflict: () => ({
        merge: async () => {
          db.status = row.status;
        },
      }),
    }),
  };
  const knex: any = () => builder;
  return { db, knex };
}

describe('DiTechPolicyService across server processes', () => {
  it('a policy saved by one process is re-read by the others', async () => {
    const redis = fakeRedis();
    const { db, knex } = fakeDb();
    const a = new DiTechPolicyService(knex, redis);
    const b = new DiTechPolicyService(knex, redis);
    await a.onModuleInit();
    await b.onModuleInit();

    expect((await a.getByOrganization('org1'))?.status).toBe('active');
    expect((await a.getByOrganization('org1'))?.status).toBe('active');
    expect(db.reads).toBe(1); // cached

    const policy = { company_ref: 'c1', status: 'suspended', pinned_host: 'a.example', entitlements: { max_users: 2 } } as any;
    await b.save(1, 'org1', policy);

    expect((await a.getByOrganization('org1'))?.status).toBe('suspended');
  });

  it('inside a transaction, announces only after commit', async () => {
    const redis = fakeRedis();
    const published: string[] = [];
    const client = redis.getOrThrow();
    const publish = client.publish;
    client.publish = async (c: string, m: string) => {
      published.push(m);
      return publish(c, m);
    };
    const { knex } = fakeDb();
    const svc = new DiTechPolicyService(knex, redis);
    let commit!: () => void;
    const trx: any = Object.assign(() => knex(), { executionPromise: new Promise<void>((r) => (commit = r)) });

    await svc.save(1, 'org1', { company_ref: 'c1', status: 'active', pinned_host: 'a', entitlements: {} } as any, trx);
    expect(published).toEqual([]);
    commit();
    await new Promise((r) => setImmediate(r));
    expect(published).toEqual(['org1']);
  });

  it('keeps working without Redis (30 s expiry only)', async () => {
    const { knex } = fakeDb();
    const broken: any = { getOrThrow: () => { throw new Error('no redis'); } };
    const svc = new DiTechPolicyService(knex, broken);
    await svc.onModuleInit();
    await svc.save(1, 'org1', { company_ref: 'c1', status: 'read_only', pinned_host: 'a', entitlements: {} } as any);
    expect((await svc.getByOrganization('org1'))?.status).toBe('read_only');
  });

  it('uses a stable channel name', () => {
    expect(POLICY_INVALIDATE_CHANNEL).toBe('ditech:policy:invalidate');
  });
});

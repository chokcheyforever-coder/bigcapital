import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import { authHeaders } from './_utils/gl';
import { fetchAccountsByCode } from './_utils/balance-sheet';

/**
 * Budget approval workflow, revisions and scenarios (DiTech Phase 5a, design §12).
 * The test tenant has a single (admin) user, so role and delegate refusals are
 * covered by workflow/approval.spec.ts; here: self-approval refused, multi-step
 * approval, immutability of approved versions, revisions and comparison.
 * Approval rules are tenant-wide: saved here and restored after.
 */
describe('Budget workflow (e2e)', () => {
  const http = () => request(app.getHttpServer());
  const errorType = (res: request.Response) => res.body.errors?.[0]?.type;
  let expense: number;
  let savedRules: any[] = [];

  const months12 = Array.from({ length: 12 }, (_, i) => `2032-${String(i + 1).padStart(2, '0')}`);
  const flat = (amount: number) => months12.map((month) => ({ month, amount }));

  const createBudget = async (amount = 100) => {
    const res = await http()
      .post('/budgets')
      .set(authHeaders())
      .send({ name: `Workflow ${faker.string.alphanumeric(6)}`, type: 'operating_expenses', fiscalYear: 2032 });
    if (res.status !== 201) throw new Error(`create ${res.status}: ${JSON.stringify(res.body)}`);
    if (amount > 0) {
      await http()
        .put(`/budgets/${res.body.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: expense, amounts: flat(amount) }] })
        .expect(200);
    }
    return res.body;
  };
  const action = (budgetId: number, versionNo: number, name: string, body: Record<string, any> = {}) =>
    http().post(`/budgets/${budgetId}/versions/${versionNo}/${name}`).set(authHeaders()).send(body);
  const saveRules = (rules: any[]) => http().put('/budgets/settings/approval-rules').set(authHeaders()).send({ rules });
  const getVersion = (budgetId: number, versionNo: number) =>
    http().get(`/budgets/${budgetId}/versions/${versionNo}`).set(authHeaders()).expect(200).then((r) => r.body);

  const twoSteps = [{ minAmount: 0, maxAmount: null, preventSelfApproval: false, steps: [{ order: 1, label: 'Finance' }, { order: 2, label: 'CEO' }] }];

  beforeAll(async () => {
    const accounts = await fetchAccountsByCode();
    expense = Object.values(accounts).find((a: any) => a.accountType === 'expense')!.id;
    const res = await http().get('/budgets/settings/approval-rules').set(authHeaders()).expect(200);
    savedRules = res.body.rules.map((r: any) => ({
      minAmount: r.min_amount,
      maxAmount: r.max_amount,
      preventSelfApproval: r.prevent_self_approval,
      steps: r.steps.map((s: any) => ({ order: s.order, roleId: s.role_id ?? s.roleId ?? null, label: s.label })),
    }));
    await saveRules([]).expect(200);
  });

  afterAll(async () => {
    await saveRules(savedRules);
  });

  describe('submitting', () => {
    it('refuses an empty version', async () => {
      const budget = await createBudget(0);
      const res = await action(budget.id, 1, 'submit');
      expect([res.status, errorType(res)]).toEqual([409, 'BUDGET_VERSION_EMPTY']);
    });

    it('without rules, one step that the submitter cannot approve', async () => {
      const budget = await createBudget();
      const submitted = await action(budget.id, 1, 'submit', { comment: 'Please review' }).expect(200);
      expect(submitted.body.version).toMatchObject({ status: 'submitted', submission_no: 1 });
      expect(submitted.body.current_step).toMatchObject({ step_order: 1, decision: 'pending' });
      expect(submitted.body).toMatchObject({ can_decide: false, cannot_decide_reason: 'BUDGET_SELF_APPROVAL', prevent_self_approval: true });

      const self = await action(budget.id, 1, 'approve');
      expect([self.status, errorType(self)]).toEqual([403, 'BUDGET_SELF_APPROVAL']);
      const selfReject = await action(budget.id, 1, 'reject', { comment: 'no' });
      expect([selfReject.status, errorType(selfReject)]).toEqual([403, 'BUDGET_SELF_APPROVAL']);

      const pending = await http().get('/budgets/approvals').set(authHeaders()).expect(200);
      const row = pending.body.data.find((r: any) => r.budget.id === budget.id);
      expect(row).toMatchObject({ steps_total: 1, steps_approved: 0, can_decide: false, gross_amount: 1200 });
      expect(row.waiting_step).toMatchObject({ label: 'Approval' });
      const mine = await http().get('/budgets/approvals?mine=true').set(authHeaders()).expect(200);
      expect(mine.body.data.some((r: any) => r.budget.id === budget.id)).toBe(false);

      // While in review the version is read-only.
      const edit = await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion: submitted.body.version.lock_version, lines: [{ accountId: expense, amounts: flat(1) }] });
      expect([edit.status, errorType(edit)]).toEqual([409, 'BUDGET_VERSION_NOT_EDITABLE']);

      const withdrawn = await action(budget.id, 1, 'withdraw').expect(200);
      expect(withdrawn.body.version.status).toBe('draft');
      expect(withdrawn.body.submissions[0].steps[0].decision).toBe('cancelled');
    });

    it('validates rules: no overlaps, existing roles only', async () => {
      const overlap = await saveRules([
        { minAmount: 0, maxAmount: 1000, steps: [{ order: 1, label: 'A' }] },
        { minAmount: 500, maxAmount: null, steps: [{ order: 1, label: 'B' }] },
      ]);
      expect([overlap.status, errorType(overlap)]).toEqual([400, 'BUDGET_INVALID_APPROVAL_RULES']);
      const role = await saveRules([{ minAmount: 0, steps: [{ order: 1, label: 'A', roleId: 999999 }] }]);
      expect(errorType(role)).toBe('BUDGET_ROLE_NOT_FOUND');
    });

    it('picks the rule by the gross amount', async () => {
      await saveRules([
        { minAmount: 0, maxAmount: 5000, preventSelfApproval: false, steps: [{ order: 1, label: 'Manager' }] },
        { minAmount: 5000, maxAmount: null, preventSelfApproval: false, steps: [{ order: 1, label: 'Manager' }, { order: 2, label: 'Board' }] },
      ]).expect(200);
      const small = await createBudget(100); // 1,200 a year
      const big = await createBudget(1000); // 12,000 a year
      const s = await action(small.id, 1, 'submit').expect(200);
      const b = await action(big.id, 1, 'submit').expect(200);
      expect(s.body.submissions[0].steps.map((x: any) => x.label)).toEqual(['Manager']);
      expect(b.body.submissions[0].steps.map((x: any) => x.label)).toEqual(['Manager', 'Board']);
      await saveRules([]).expect(200);
    });
  });

  describe('approval and immutability', () => {
    let budget: any;

    beforeAll(async () => {
      await saveRules(twoSteps).expect(200);
      budget = await createBudget(250);
    });
    afterAll(async () => {
      await saveRules([]);
    });

    it('approves step by step; the last step makes the version active', async () => {
      await action(budget.id, 1, 'submit').expect(200);
      const mine = await http().get('/budgets/approvals?mine=true').set(authHeaders()).expect(200);
      expect(mine.body.data.some((r: any) => r.budget.id === budget.id)).toBe(true);

      const first = await action(budget.id, 1, 'approve', { comment: 'OK from finance' }).expect(200);
      expect(first.body.version.status).toBe('under_review');
      expect(first.body.current_step).toMatchObject({ step_order: 2, label: 'CEO' });

      const second = await action(budget.id, 1, 'approve').expect(200);
      expect(second.body.version.status).toBe('approved');
      expect(second.body.version.approved_by).toBeTruthy();
      expect(second.body.current_step).toBeNull();

      const detail = await http().get(`/budgets/${budget.id}`).set(authHeaders()).expect(200);
      expect(detail.body.active_version_id).toBe(second.body.version.id);
    });

    it('refuses every change to an approved version', async () => {
      const v = await getVersion(budget.id, 1);
      const lockVersion = v.version.lock_version;
      const lines = await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion, lines: [{ accountId: expense, amounts: flat(1) }] });
      expect([lines.status, errorType(lines)]).toEqual([409, 'BUDGET_VERSION_NOT_EDITABLE']);
      const remove = await http()
        .put(`/budgets/${budget.id}/versions/1/lines`)
        .set(authHeaders())
        .send({ lockVersion, lines: [], removeLineIds: [v.lines[0].id] });
      expect([remove.status, errorType(remove)]).toEqual([409, 'BUDGET_VERSION_NOT_EDITABLE']);
      const imported = await http()
        .post(`/budgets/${budget.id}/versions/1/import`)
        .set(authHeaders())
        .field('lock_version', String(lockVersion))
        .attach('file', Buffer.from(`Account code,Branch,Project,${months12.join(',')}\n`), 'budget.csv');
      expect([imported.status, errorType(imported)]).toEqual([409, 'BUDGET_VERSION_NOT_EDITABLE']);

      for (const name of ['submit', 'approve', 'withdraw', 'cancel', 'unlock']) {
        const res = await action(budget.id, 1, name, { comment: 'x' });
        expect({ name, status: res.status }).toEqual({ name, status: 409 });
      }
      const del = await http().delete(`/budgets/${budget.id}`).set(authHeaders());
      expect([del.status, errorType(del)]).toEqual([409, 'BUDGET_NOT_DELETABLE']);

      const after = await getVersion(budget.id, 1);
      expect(after.totals.grand.total).toBe(3000);
      expect(after.version.lock_version).toBe(lockVersion);
    });

    it('locks and unlocks an approved version', async () => {
      const locked = await action(budget.id, 1, 'lock').expect(200);
      expect(locked.body.versions[0]).toMatchObject({ status: 'locked' });
      const again = await action(budget.id, 1, 'lock');
      expect(again.status).toBe(409);
      const unlocked = await action(budget.id, 1, 'unlock').expect(200);
      expect(unlocked.body.versions[0]).toMatchObject({ status: 'approved', locked_at: null });
      await action(budget.id, 1, 'lock').expect(200);
    });

    it('revises: copy, one at a time, reject needs a reason, resubmit, approve, compare with the original', async () => {
      const draft = await http().post(`/budgets/${budget.id}/revisions`).set(authHeaders()).send({ reason: 'Rent went up' }).expect(201);
      expect(draft.body.version).toMatchObject({ version_no: 2, kind: 'revision', status: 'draft', label: 'Revision 1', revision_reason: 'Rent went up' });
      expect(draft.body.totals.grand.total).toBe(3000);
      expect(draft.body.lines).toHaveLength(1);

      const second = await http().post(`/budgets/${budget.id}/revisions`).set(authHeaders()).send({ reason: 'Again' });
      expect([second.status, errorType(second)]).toEqual([409, 'BUDGET_OPEN_REVISION_EXISTS']);
      const noReason = await http().post(`/budgets/${budget.id}/revisions`).set(authHeaders()).send({});
      expect(noReason.status).toBe(400);

      await http()
        .put(`/budgets/${budget.id}/versions/2/lines`)
        .set(authHeaders())
        .send({ lockVersion: 0, lines: [{ accountId: expense, amounts: [{ month: '2032-12', amount: 400 }] }] })
        .expect(200);
      // The original stays as approved.
      expect((await getVersion(budget.id, 1)).totals.grand.total).toBe(3000);

      await action(budget.id, 2, 'submit').expect(200);
      const noComment = await action(budget.id, 2, 'reject', {});
      expect(noComment.status).toBe(400);
      const rejected = await action(budget.id, 2, 'reject', { comment: 'Show the new lease' }).expect(200);
      expect(rejected.body.version.status).toBe('rejected');
      expect(rejected.body.submissions[0].steps.map((s: any) => s.decision)).toEqual(['rejected', 'cancelled']);

      const resubmitted = await action(budget.id, 2, 'submit').expect(200);
      expect(resubmitted.body.version.submission_no).toBe(2);
      expect(resubmitted.body.submissions.map((s: any) => s.submission_no)).toEqual([2, 1]);
      await action(budget.id, 2, 'approve').expect(200);
      const approved = await action(budget.id, 2, 'approve').expect(200);
      expect(approved.body.version.status).toBe('approved');

      const detail = await http().get(`/budgets/${budget.id}`).set(authHeaders()).expect(200);
      expect(detail.body.active_version_id).toBe(approved.body.version.id);

      const compare = await http().get(`/budgets/${budget.id}/compare`).set(authHeaders()).expect(200);
      expect(compare.body.base.version_no).toBe(1);
      expect(compare.body.compare.version_no).toBe(2);
      expect(compare.body.totals).toEqual({ base: 3000, compare: 3150, difference: 150, difference_percent: 5 });
      expect(compare.body.lines[0]).toMatchObject({ change: 'changed', difference: 150 });
      expect(compare.body.lines[0].compare.months['2032-12-01']).toBe(400);
    });

    it('scenarios are free to edit, never submitted, and can be cancelled; the original cannot', async () => {
      const scenario = await http()
        .post(`/budgets/${budget.id}/scenarios`)
        .set(authHeaders())
        .send({ scenario: 'worst', label: 'Rent +20%' })
        .expect(201);
      expect(scenario.body.version).toMatchObject({ kind: 'scenario', scenario: 'worst', status: 'draft', source_version_id: expect.any(Number) });
      expect(scenario.body.totals.grand.total).toBe(3150);
      const no = scenario.body.version.version_no;
      const submit = await action(budget.id, no, 'submit');
      expect([submit.status, errorType(submit)]).toEqual([409, 'BUDGET_VERSION_NOT_SUBMITTABLE']);
      const cancelled = await action(budget.id, no, 'cancel').expect(200);
      expect(cancelled.body.versions.find((v: any) => v.version_no === no).status).toBe('cancelled');

      const original = await createBudget();
      const res = await action(original.id, 1, 'cancel');
      expect([res.status, errorType(res)]).toEqual([409, 'BUDGET_CANNOT_CANCEL_ORIGINAL']);
    });

    it('delegation needs an active user who can approve', async () => {
      const other = await createBudget();
      await action(other.id, 1, 'submit').expect(200);
      const unknown = await action(other.id, 1, 'delegate', { userId: 999999 });
      expect([unknown.status, errorType(unknown)]).toEqual([404, 'BUDGET_DELEGATE_NOT_FOUND']);

      const users = await http().get('/users').set(authHeaders()).expect(200);
      const list = users.body.users ?? users.body.data ?? users.body;
      const me = list.find((u: any) => u.active !== false && u.role?.slug === 'admin') ?? list[0];
      const delegated = await action(other.id, 1, 'delegate', { userId: me.id }).expect(200);
      expect(delegated.body.current_step.assigned_user_id).toBeTruthy();
      expect(delegated.body.can_decide).toBe(true);
    });

    it('keeps an audit history', async () => {
      const audit = await http().get(`/budgets/${budget.id}/audit?pageSize=100`).set(authHeaders()).expect(200);
      const actions = audit.body.data.map((r: any) => r.action);
      for (const a of ['created', 'lines_saved', 'submitted', 'step_approved', 'approved', 'locked', 'unlocked', 'revision_created', 'rejected', 'scenario_created', 'cancelled']) {
        expect(actions).toContain(a);
      }
      expect(audit.body.data[0].id).toBeGreaterThan(audit.body.data[audit.body.data.length - 1].id);
      expect(audit.body.pagination.total).toBe(audit.body.data.length);
    });
  });
});

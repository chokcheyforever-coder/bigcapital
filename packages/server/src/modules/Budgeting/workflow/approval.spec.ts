import {
  Actor,
  APPROVAL_ERRORS,
  ApprovalError,
  ApprovalRule,
  ApprovalStepState,
  DEFAULT_RULE,
  ensureCanDecide,
  ensureCanRevise,
  ensureCancellable,
  ensureSubmittable,
  grossAmount,
  pickRule,
  statusAfterApproval,
  validateRules,
} from './approval';

const rule = (minAmount: number, maxAmount: number | null, roles: Array<number | null> = [null], preventSelfApproval = true): ApprovalRule => ({
  id: minAmount,
  minAmount,
  maxAmount,
  steps: roles.map((roleId, i) => ({ order: i + 1, roleId, label: `Step ${i + 1}` })),
  preventSelfApproval,
});

const step = (stepOrder: number, overrides: Partial<ApprovalStepState> = {}): ApprovalStepState => ({
  stepOrder,
  roleId: null,
  assignedUserId: null,
  decision: 'pending',
  decidedBy: null,
  ...overrides,
});

const actor = (userId: number, roleId: number | null = 2, isAdmin = false): Actor => ({ userId, roleId, isAdmin });

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApprovalError) return err.code;
    throw err;
  }
  return null;
};

describe('approval rules', () => {
  const rules = [rule(0, 10_000_000), rule(10_000_000, 100_000_000, [2, 3]), rule(100_000_000, null, [2, 3, 4])];

  it('matches the amount on [min, max)', () => {
    expect(pickRule(rules, 0).id).toBe(0);
    expect(pickRule(rules, 9_999_999).id).toBe(0);
    expect(pickRule(rules, 10_000_000).id).toBe(10_000_000);
    expect(pickRule(rules, 5_000_000_000).steps).toHaveLength(3);
  });

  it('falls back to one default step that refuses self-approval', () => {
    expect(pickRule([], 123)).toBe(DEFAULT_RULE);
    expect(pickRule([rule(1_000, 2_000)], 5_000)).toBe(DEFAULT_RULE);
    expect(DEFAULT_RULE.preventSelfApproval).toBe(true);
  });

  it('uses the gross amount (signs ignored)', () => {
    expect(grossAmount([1_000, -2_500, 0])).toBe(3_500);
  });

  it('refuses overlapping ranges, an unbounded rule below another, and bad steps', () => {
    expect(() => validateRules(rules)).not.toThrow();
    expect(code(() => validateRules([rule(0, 10), rule(5, 20)]))).toBe(APPROVAL_ERRORS.INVALID_RULES);
    expect(code(() => validateRules([rule(0, null), rule(5, 20)]))).toBe(APPROVAL_ERRORS.INVALID_RULES);
    expect(code(() => validateRules([rule(10, 10)]))).toBe(APPROVAL_ERRORS.INVALID_RULES);
    expect(code(() => validateRules([rule(0, null, [])]))).toBe(APPROVAL_ERRORS.INVALID_RULES);
    expect(code(() => validateRules([{ ...rule(0, null, [1, 2]), steps: [{ order: 1, roleId: 1, label: 'a' }, { order: 1, roleId: 2, label: 'b' }] }]))).toBe(
      APPROVAL_ERRORS.INVALID_RULES,
    );
  });
});

describe('submitting', () => {
  it('needs a draft or rejected original/revision with lines', () => {
    expect(code(() => ensureSubmittable({ status: 'draft', kind: 'original' }, 1))).toBeNull();
    expect(code(() => ensureSubmittable({ status: 'rejected', kind: 'revision' }, 1))).toBeNull();
    expect(code(() => ensureSubmittable({ status: 'approved', kind: 'original' }, 1))).toBe(APPROVAL_ERRORS.INVALID_STATUS);
    expect(code(() => ensureSubmittable({ status: 'submitted', kind: 'original' }, 1))).toBe(APPROVAL_ERRORS.INVALID_STATUS);
    expect(code(() => ensureSubmittable({ status: 'draft', kind: 'scenario' }, 1))).toBe(APPROVAL_ERRORS.NOT_SUBMITTABLE);
    expect(code(() => ensureSubmittable({ status: 'draft', kind: 'forecast' }, 1))).toBe(APPROVAL_ERRORS.NOT_SUBMITTABLE);
    expect(code(() => ensureSubmittable({ status: 'draft', kind: 'original' }, 0))).toBe(APPROVAL_ERRORS.EMPTY_VERSION);
  });
});

describe('deciding a step', () => {
  const SUBMITTER = 1;

  it('refuses the submitter when self-approval is prevented, allows otherwise', () => {
    expect(code(() => ensureCanDecide([step(1)], actor(SUBMITTER), SUBMITTER, true))).toBe(APPROVAL_ERRORS.SELF_APPROVAL);
    expect(code(() => ensureCanDecide([step(1)], actor(SUBMITTER, 2, true), SUBMITTER, true))).toBe(APPROVAL_ERRORS.SELF_APPROVAL);
    expect(code(() => ensureCanDecide([step(1)], actor(SUBMITTER), SUBMITTER, false))).toBeNull();
  });

  it('needs the step role, unless admin', () => {
    const steps = [step(1, { roleId: 7 })];
    expect(code(() => ensureCanDecide(steps, actor(5, 2), SUBMITTER, true))).toBe(APPROVAL_ERRORS.NOT_YOUR_STEP);
    expect(code(() => ensureCanDecide(steps, actor(5, 7), SUBMITTER, true))).toBeNull();
    expect(code(() => ensureCanDecide(steps, actor(5, 2, true), SUBMITTER, true))).toBeNull();
  });

  it('a delegated step belongs to the delegate only (or an admin)', () => {
    const steps = [step(1, { roleId: 7, assignedUserId: 9 })];
    expect(code(() => ensureCanDecide(steps, actor(5, 7), SUBMITTER, true))).toBe(APPROVAL_ERRORS.NOT_YOUR_STEP);
    expect(code(() => ensureCanDecide(steps, actor(9, 2), SUBMITTER, true))).toBeNull();
  });

  it('decides steps in order and refuses one approver for two steps', () => {
    const steps = [step(1, { decision: 'approved', decidedBy: 5 }), step(2), step(3)];
    expect(ensureCanDecide(steps, actor(6), SUBMITTER, true).stepOrder).toBe(2);
    expect(code(() => ensureCanDecide(steps, actor(5), SUBMITTER, true))).toBe(APPROVAL_ERRORS.SAME_APPROVER);
    expect(code(() => ensureCanDecide(steps, actor(5), SUBMITTER, false))).toBeNull();
  });

  it('has nothing to decide when no step is pending', () => {
    expect(code(() => ensureCanDecide([step(1, { decision: 'approved', decidedBy: 5 })], actor(6), SUBMITTER, true))).toBe(APPROVAL_ERRORS.NO_PENDING_STEP);
  });

  it('is approved after the last step, under review before', () => {
    expect(statusAfterApproval([step(1)])).toBe('approved');
    expect(statusAfterApproval([step(1), step(2)])).toBe('under_review');
    expect(statusAfterApproval([step(1, { decision: 'approved' }), step(2)])).toBe('approved');
  });
});

describe('revisions and cancelling', () => {
  const approved = { kind: 'original', status: 'approved' };

  it('revises an approved or locked version, or a scenario, once something is approved', () => {
    expect(code(() => ensureCanRevise(approved, [approved]))).toBeNull();
    expect(code(() => ensureCanRevise({ kind: 'original', status: 'locked' }, [{ kind: 'original', status: 'locked' }]))).toBeNull();
    expect(code(() => ensureCanRevise({ kind: 'scenario', status: 'draft' }, [approved]))).toBeNull();
    expect(code(() => ensureCanRevise({ kind: 'forecast', status: 'draft' }, [approved]))).toBeNull();
    expect(code(() => ensureCanRevise({ kind: 'original', status: 'draft' }, [{ kind: 'original', status: 'draft' }]))).toBe(APPROVAL_ERRORS.INVALID_SOURCE);
    expect(code(() => ensureCanRevise({ kind: 'scenario', status: 'draft' }, [{ kind: 'original', status: 'draft' }]))).toBe(
      APPROVAL_ERRORS.INVALID_SOURCE,
    );
  });

  it('allows one revision in progress at a time', () => {
    for (const status of ['draft', 'submitted', 'under_review', 'rejected']) {
      expect(code(() => ensureCanRevise(approved, [approved, { kind: 'revision', status }]))).toBe(APPROVAL_ERRORS.OPEN_REVISION_EXISTS);
    }
    for (const status of ['approved', 'locked', 'cancelled']) {
      expect(code(() => ensureCanRevise(approved, [approved, { kind: 'revision', status }]))).toBeNull();
    }
    expect(code(() => ensureCanRevise(approved, [approved, { kind: 'scenario', status: 'draft' }]))).toBeNull();
  });

  it('cancels draft or rejected revisions and scenarios, never the original', () => {
    expect(code(() => ensureCancellable({ kind: 'revision', status: 'draft' }))).toBeNull();
    expect(code(() => ensureCancellable({ kind: 'scenario', status: 'rejected' }))).toBeNull();
    expect(code(() => ensureCancellable({ kind: 'revision', status: 'approved' }))).toBe(APPROVAL_ERRORS.INVALID_STATUS);
    expect(code(() => ensureCancellable({ kind: 'original', status: 'draft' }))).toBe(APPROVAL_ERRORS.CANNOT_CANCEL_ORIGINAL);
  });
});

import { alertReaches, approvers, Candidate, escapeHtml, interested, stepDeciders } from './recipients';

const user = (userId: number, roleId: number | null, extra: Partial<Candidate> = {}): Candidate => ({
  userId,
  roleId,
  active: true,
  isAdmin: false,
  canApprove: false,
  ...extra,
});

const users = [
  user(1, 1, { isAdmin: true, canApprove: true }), // admin
  user(2, 2, { canApprove: true }), // finance
  user(3, 2, { canApprove: true }), // finance
  user(4, 3), // clerk
  user(5, 2, { canApprove: true, active: false }), // inactive finance
];

describe('stepDeciders', () => {
  it('a delegated step goes to the delegate only', () => {
    expect(stepDeciders(users, { roleId: 2, assignedUserId: 4 })).toEqual([4]);
  });

  it('a role step goes to the active users of that role', () => {
    expect(stepDeciders(users, { roleId: 2, assignedUserId: null })).toEqual([2, 3]);
  });

  it('a role nobody holds falls back to the admins', () => {
    expect(stepDeciders(users, { roleId: 9, assignedUserId: null })).toEqual([1]);
  });

  it('an open step goes to everyone who can approve', () => {
    expect(stepDeciders(users, { roleId: null, assignedUserId: null })).toEqual([1, 2, 3]);
  });

  it('leaves out the submitter and earlier approvers', () => {
    expect(stepDeciders(users, { roleId: 2, assignedUserId: null }, [2])).toEqual([3]);
    expect(stepDeciders(users, { roleId: null, assignedUserId: null }, [1, 3])).toEqual([2]);
  });
});

describe('other recipients', () => {
  it('override requests go to approvers except the requester', () => {
    expect(approvers(users, [3])).toEqual([1, 2]);
  });

  it('decisions go to submitter and owner once, not to the decider', () => {
    expect(interested([4, 4, null, 2], [2])).toEqual([4]);
  });

  it('alert levels', () => {
    expect(alertReaches('exceeded', 'exceeded')).toBe(true);
    expect(alertReaches('warning', 'exceeded')).toBe(false);
    expect(alertReaches('warning', 'warning')).toBe(true);
    expect(alertReaches('info', 'warning')).toBe(false);
    expect(alertReaches('exceeded', 'off')).toBe(false);
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<b>"A&B"</b>'`)).toBe('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;&#39;');
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSION_KEY } from '@/modules/Roles/RequirePermission.decorator';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { BudgetingController } from './Budgeting.controller';
import { BudgetReportsController } from './BudgetReports.controller';
import { BudgetAction } from './Budgeting.types';

/**
 * Every budget endpoint must require a Budget permission, behind the
 * authorization and permission guards (design §7: "each permission enforced").
 */
describe('BudgetingController permissions', () => {
  const expected: Record<string, BudgetAction> = {
    getBudgets: BudgetAction.View,
    getBudget: BudgetAction.View,
    getVersion: BudgetAction.View,
    createBudget: BudgetAction.Create,
    editBudget: BudgetAction.EditDraft,
    saveLines: BudgetAction.EditDraft,
    allocate: BudgetAction.EditDraft,
    deleteBudget: BudgetAction.Delete,
    prefillPreview: BudgetAction.EditDraft,
    exportVersion: BudgetAction.ImportExport,
    importTemplate: BudgetAction.ImportExport,
    importPreview: BudgetAction.ImportExport,
    // Also checks ImportExport inside the handler.
    importCommit: BudgetAction.EditDraft,
  };

  it('guards the controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, BudgetingController);
    expect(guards).toEqual([AuthorizationGuard, PermissionGuard]);
  });

  it('declares the right permission on every route, and no route without one', () => {
    const routes = Object.getOwnPropertyNames(BudgetingController.prototype).filter((n) => n !== 'constructor');
    expect(routes.sort()).toEqual(Object.keys(expected).sort());
    for (const route of routes) {
      const permission = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, BudgetingController.prototype[route]);
      expect({ route, permission }).toEqual({ route, permission: { ability: expected[route], subject: AbilitySubject.Budget } });
    }
  });
});

describe('BudgetReportsController permissions', () => {
  it('guards the controller and needs Budget View on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BudgetReportsController)).toEqual([AuthorizationGuard, PermissionGuard]);
    const routes = Object.getOwnPropertyNames(BudgetReportsController.prototype).filter((n) => n !== 'constructor');
    expect(routes.sort()).toEqual(['exportReport', 'getReport']);
    for (const route of routes) {
      expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, BudgetReportsController.prototype[route])).toEqual({
        ability: BudgetAction.View,
        subject: AbilitySubject.Budget,
      });
    }
  });
});

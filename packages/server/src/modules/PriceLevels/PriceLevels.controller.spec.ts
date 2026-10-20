import { GUARDS_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSION_KEY } from '@/modules/Roles/RequirePermission.decorator';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { PriceLevelsController } from './PriceLevels.controller';
import { PriceLevelAction } from './PriceLevels.types';

/**
 * Every price level endpoint requires a PriceLevel permission, except
 * `resolve`: anyone signed in who prepares a document needs the rates.
 */
describe('PriceLevelsController permissions', () => {
  const expected: Record<string, PriceLevelAction | null> = {
    getPriceLevels: PriceLevelAction.View,
    getPriceLevel: PriceLevelAction.View,
    createPriceLevel: PriceLevelAction.Create,
    editPriceLevel: PriceLevelAction.Edit,
    assign: PriceLevelAction.Edit,
    deletePriceLevel: PriceLevelAction.Delete,
    salesReport: PriceLevelAction.View,
    exportPrices: PriceLevelAction.View,
    importPrices: PriceLevelAction.Edit,
    resolve: null,
  };

  it('guards the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PriceLevelsController)).toEqual([AuthorizationGuard, PermissionGuard]);
  });

  it('declares the right permission on every route', () => {
    const routes = Object.getOwnPropertyNames(PriceLevelsController.prototype).filter((n) => n !== 'constructor');
    expect(routes.sort()).toEqual(Object.keys(expected).sort());
    for (const route of routes) {
      const permission = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, PriceLevelsController.prototype[route]);
      const ability = expected[route];
      expect({ route, permission }).toEqual({
        route,
        permission: ability ? { ability, subject: AbilitySubject.PriceLevel } : undefined,
      });
    }
  });
});

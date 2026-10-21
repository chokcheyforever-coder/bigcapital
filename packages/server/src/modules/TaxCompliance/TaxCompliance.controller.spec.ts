import { GUARDS_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSION_KEY } from '@/modules/Roles/RequirePermission.decorator';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { PreferencesAction } from '@/modules/Settings/Settings.types';
import { TaxComplianceController } from './TaxCompliance.controller';

/** Saving the tax profile needs the Preferences permission; reading it does not. */
describe('TaxComplianceController permissions', () => {
  it('guards the controller and protects saving', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TaxComplianceController)).toEqual([AuthorizationGuard, PermissionGuard]);
    const meta = (route: string) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, TaxComplianceController.prototype[route]);
    expect(meta('saveProfile')).toEqual({ ability: PreferencesAction.Mutate, subject: AbilitySubject.Preferences });
    expect(meta('getProfile')).toBeUndefined();
    expect(meta('khrRate')).toBeUndefined();
  });
});

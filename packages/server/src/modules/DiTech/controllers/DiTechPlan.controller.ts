import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { DiTechPolicyService } from '../services/DiTechPolicy.service';
import { FEATURE_ROUTES } from '../DiTech.types';

/**
 * Plan features of the current organization, so the webapp can show locked
 * features instead of failing after a click. Read-only; enforcement stays in
 * DiTechPolicyGuard. Not under /api/ditech (the gateway blocks that prefix).
 */
@ApiExcludeController()
@Controller('plan-features')
export class DiTechPlanController {
  constructor(
    private readonly cls: ClsService,
    private readonly policies: DiTechPolicyService,
  ) {}

  @Get()
  async features() {
    const policy = await this.policies.getByOrganization(this.cls.get('organizationId'));
    // No policy (development without DiTech provisioning): nothing is locked.
    const all = [...Object.keys(FEATURE_ROUTES), 'multi_currency', 'api_access'];
    return { features: policy?.entitlements.features ?? all };
  }
}

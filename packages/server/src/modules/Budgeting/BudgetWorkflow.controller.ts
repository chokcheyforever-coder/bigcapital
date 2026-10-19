import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { BudgetAction } from './Budgeting.types';
import { BudgetWorkflowService } from './commands/BudgetWorkflow.service';
import { BudgetWorkflowQueriesService } from './queries/BudgetWorkflowQueries.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import {
  CompareVersionsQueryDto,
  CreateRevisionDto,
  CreateScenarioDto,
  DelegateStepDto,
  GetApprovalsQueryDto,
  GetBudgetAuditQueryDto,
  RejectVersionDto,
  SaveApprovalRulesDto,
  WorkflowCommentDto,
} from './dtos/BudgetWorkflow.dto';

/**
 * Approval workflow, revisions, scenarios, comparison and audit (design §12).
 * Registered before BudgetingController so `budgets/approvals` never reaches `:id`.
 */
@Controller('budgets')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetWorkflowController {
  constructor(
    private readonly workflow: BudgetWorkflowService,
    private readonly workflowQueries: BudgetWorkflowQueriesService,
    private readonly queries: BudgetQueriesService,
  ) {}

  @Get('approvals')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Approval status report: versions in review, the step each waits on and for how long (mine=true: the ones I can decide).' })
  getApprovals(@Query() query: GetApprovalsQueryDto) {
    return this.workflowQueries.getApprovals(query);
  }

  @Get('settings/approval-rules')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Approval rules: steps by gross version amount.' })
  async getApprovalRules() {
    return { rules: await this.workflow.getRules() };
  }

  @Put('settings/approval-rules')
  @RequirePermission(BudgetAction.ConfigurePolicy, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Replaces the approval rules (ranges must not overlap). Applies to later submissions only.' })
  async saveApprovalRules(@Body() dto: SaveApprovalRulesDto) {
    return { rules: await this.workflow.saveRules(dto) };
  }

  @Get(':id/versions/:versionNo/approvals')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Approval history of a version (every submission and step) and whether I can decide now.' })
  getVersionApprovals(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/submit')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Submit, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Submits a draft or rejected version; its steps come from the approval rules.' })
  @ApiResponse({ status: 409, description: 'Wrong status, a scenario, or no lines.' })
  async submit(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number, @Body() dto: WorkflowCommentDto) {
    await this.workflow.submit(id, versionNo, dto.comment);
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/approve')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Approve, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Approves the current step; after the last step the version is approved and becomes active.' })
  @ApiResponse({ status: 403, description: 'Another role\'s step, a delegated step, or self-approval.' })
  async approve(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number, @Body() dto: WorkflowCommentDto) {
    await this.workflow.approve(id, versionNo, dto.comment);
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/reject')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Approve, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Rejects the version at the current step (comment required); it can be edited and resubmitted.' })
  async reject(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number, @Body() dto: RejectVersionDto) {
    await this.workflow.reject(id, versionNo, dto.comment);
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/delegate')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Approve, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Hands the current step to another user who can approve budgets.' })
  async delegate(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number, @Body() dto: DelegateStepDto) {
    await this.workflow.delegate(id, versionNo, dto);
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/withdraw')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Submit, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Takes a version in review back to draft.' })
  async withdraw(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    await this.workflow.withdraw(id, versionNo);
    return this.workflowQueries.getVersionApprovals(id, versionNo);
  }

  @Post(':id/versions/:versionNo/cancel')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Revise, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Cancels a draft or rejected revision or scenario.' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    await this.workflow.cancel(id, versionNo);
    return this.queries.getBudget(id);
  }

  @Post(':id/versions/:versionNo/lock')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Lock, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Locks an approved version.' })
  async lock(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    await this.workflow.lock(id, versionNo);
    return this.queries.getBudget(id);
  }

  @Post(':id/versions/:versionNo/unlock')
  @HttpCode(200)
  @RequirePermission(BudgetAction.Lock, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Unlocks a locked version (back to approved; still read-only).' })
  async unlock(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    await this.workflow.unlock(id, versionNo);
    return this.queries.getBudget(id);
  }

  @Post(':id/revisions')
  @RequirePermission(BudgetAction.Revise, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Creates a draft revision copied from an approved/locked version or a scenario (one revision in progress at a time).' })
  async createRevision(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateRevisionDto) {
    const version = await this.workflow.createRevision(id, dto);
    return this.queries.getVersion(id, version.versionNo);
  }

  @Post(':id/scenarios')
  @RequirePermission(BudgetAction.Revise, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Creates a what-if scenario copied from a version; scenarios are edited freely and never submitted.' })
  async createScenario(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateScenarioDto) {
    const version = await this.workflow.createScenario(id, dto);
    return this.queries.getVersion(id, version.versionNo);
  }

  @Get(':id/compare')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Compares two versions line by line (default: original vs active).' })
  compareVersions(@Param('id', ParseIntPipe) id: number, @Query() query: CompareVersionsQueryDto) {
    return this.workflowQueries.compareVersions(id, query);
  }

  @Get(':id/audit')
  @RequirePermission(BudgetAction.ViewAudit, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Audit history of the budget, newest first.' })
  getAudit(@Param('id', ParseIntPipe) id: number, @Query() query: GetBudgetAuditQueryDto) {
    return this.workflowQueries.getAudit(id, query);
  }
}

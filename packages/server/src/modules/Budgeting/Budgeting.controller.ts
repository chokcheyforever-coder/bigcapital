import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { AllocateBudgetDto, CreateBudgetDto, EditBudgetDto, GetBudgetsQueryDto, SaveBudgetLinesDto } from './dtos/Budget.dto';
import { BudgetCommandsService } from './commands/BudgetCommands.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import { BudgetAction } from './Budgeting.types';

@Controller('budgets')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetingController {
  constructor(
    private readonly commands: BudgetCommandsService,
    private readonly queries: BudgetQueriesService,
  ) {}

  @Get()
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Lists budgets (paginated) with their latest version.' })
  getBudgets(@Query() filter: GetBudgetsQueryDto) {
    return this.queries.getBudgets(filter);
  }

  @Post()
  @RequirePermission(BudgetAction.Create, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Creates a budget with its original (draft) version.' })
  async createBudget(@Body() dto: CreateBudgetDto) {
    const budget = await this.commands.createBudget(dto);
    return this.queries.getBudget(budget.id);
  }

  @Get(':id')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Budget details, its months and versions with totals.' })
  @ApiResponse({ status: 404, description: 'The budget was not found.' })
  getBudget(@Param('id', ParseIntPipe) id: number) {
    return this.queries.getBudget(id);
  }

  @Put(':id')
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Edits the budget header (name, reference, owner, description, notes).' })
  async editBudget(@Param('id', ParseIntPipe) id: number, @Body() dto: EditBudgetDto) {
    await this.commands.editBudget(id, dto);
    return this.queries.getBudget(id);
  }

  @Delete(':id')
  @RequirePermission(BudgetAction.Delete, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Deletes a budget whose versions are all draft, rejected or cancelled.' })
  async deleteBudget(@Param('id', ParseIntPipe) id: number) {
    await this.commands.deleteBudget(id);
    return { id, message: 'The budget has been deleted.' };
  }

  @Get(':id/versions/:versionNo')
  @RequirePermission(BudgetAction.View, AbilitySubject.Budget)
  @ApiOperation({ summary: 'A version with its lines, monthly/quarterly/total amounts and group totals.' })
  getVersion(@Param('id', ParseIntPipe) id: number, @Param('versionNo', ParseIntPipe) versionNo: number) {
    return this.queries.getVersion(id, versionNo);
  }

  @Put(':id/versions/:versionNo/lines')
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Adds/updates lines and monthly amounts of a draft version (only the months given change).' })
  @ApiResponse({ status: 409, description: 'The version is not editable, or changed since it was read (lock_version).' })
  async saveLines(
    @Param('id', ParseIntPipe) id: number,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @Body() dto: SaveBudgetLinesDto,
  ) {
    await this.commands.saveLines(id, versionNo, dto);
    return this.queries.getVersion(id, versionNo);
  }

  @Post(':id/allocate')
  @HttpCode(200)
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Previews an allocation over the budget months (equal, percentage, seasonal, growth); saves nothing.' })
  allocate(@Param('id', ParseIntPipe) id: number, @Body() dto: AllocateBudgetDto) {
    return this.queries.allocate(id, dto);
  }
}

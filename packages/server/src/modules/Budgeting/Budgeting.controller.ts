import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request, Response } from 'express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { AllocateBudgetDto, CreateBudgetDto, EditBudgetDto, GetBudgetsQueryDto, PrefillBudgetDto, SaveBudgetLinesDto } from './dtos/Budget.dto';
import { BudgetPrefillService } from './queries/BudgetPrefill.service';
import { BudgetSheetService, MAX_IMPORT_BYTES, SheetFormat } from './commands/BudgetSheet.service';
import { BudgetCommandsService } from './commands/BudgetCommands.service';
import { BudgetQueriesService } from './queries/BudgetQueries.service';
import { BudgetAction } from './Budgeting.types';

const sheetFormat = (format?: string): SheetFormat => (format === 'csv' ? 'csv' : 'xlsx');

const sendFile = (res: Response, file: { body: Buffer; filename: string; contentType: string }) => {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`);
  res.send(file.body);
};

const importUpload = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new BadRequestException('Upload a .csv or .xlsx file.'), ok);
  },
};

@Controller('budgets')
@ApiTags('Budgets')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class BudgetingController {
  constructor(
    private readonly commands: BudgetCommandsService,
    private readonly queries: BudgetQueriesService,
    private readonly prefill: BudgetPrefillService,
    private readonly sheets: BudgetSheetService,
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

  @Post(':id/prefill')
  @HttpCode(200)
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiOperation({ summary: 'Previews lines from posted actuals of an earlier period or another budget version (with growth); saves nothing.' })
  prefillPreview(@Param('id', ParseIntPipe) id: number, @Body() dto: PrefillBudgetDto) {
    return this.prefill.preview(id, dto);
  }

  @Get(':id/versions/:versionNo/export')
  @RequirePermission(BudgetAction.ImportExport, AbilitySubject.Budget)
  @ApiQuery({ name: 'format', enum: ['xlsx', 'csv'], required: false })
  @ApiOperation({ summary: 'Downloads a version as Excel or CSV (one row per line, one column per month).' })
  async exportVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const file = await this.sheets.exportVersion(id, versionNo, sheetFormat(format));
    sendFile(res, file);
  }

  @Get(':id/import-template')
  @RequirePermission(BudgetAction.ImportExport, AbilitySubject.Budget)
  @ApiQuery({ name: 'format', enum: ['xlsx', 'csv'], required: false })
  @ApiOperation({ summary: 'Downloads an empty import template with the budget months and allowed accounts.' })
  async importTemplate(@Param('id', ParseIntPipe) id: number, @Query('format') format: string, @Res() res: Response) {
    const file = await this.sheets.template(id, sheetFormat(format));
    sendFile(res, file);
  }

  @Post(':id/versions/:versionNo/import/preview')
  @HttpCode(200)
  @RequirePermission(BudgetAction.ImportExport, AbilitySubject.Budget)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Checks an Excel/CSV file and reports each row; saves nothing.' })
  @UseInterceptors(FileInterceptor('file', importUpload))
  importPreview(
    @Param('id', ParseIntPipe) id: number,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Attach the file as "file".');
    return this.sheets.importFile(id, versionNo, file.buffer, { dryRun: true });
  }

  @Post(':id/versions/:versionNo/import')
  @HttpCode(200)
  @RequirePermission(BudgetAction.EditDraft, AbilitySubject.Budget)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, lock_version: { type: 'integer' } } } })
  @ApiOperation({ summary: 'Imports an Excel/CSV file into a draft version: all rows or none (committed=false with the errors).' })
  @UseInterceptors(FileInterceptor('file', importUpload))
  importCommit(
    @Param('id', ParseIntPipe) id: number,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ) {
    // Committing needs both: changing the draft (route) and importing.
    if (!(req as any).ability?.can(BudgetAction.ImportExport, AbilitySubject.Budget)) {
      throw new ForbiddenException(`You do not have permission to ${BudgetAction.ImportExport} ${AbilitySubject.Budget}`);
    }
    if (!file) throw new BadRequestException('Attach the file as "file".');
    // Multer parses the form after the key-converting interceptor ran, so accept both spellings.
    const lockVersion = body?.lockVersion ?? body?.lock_version;
    if (lockVersion === undefined || !/^\d+$/.test(String(lockVersion))) throw new BadRequestException('lock_version is required.');
    return this.sheets.importFile(id, versionNo, file.buffer, { dryRun: false, lockVersion: Number(lockVersion) });
  }
}

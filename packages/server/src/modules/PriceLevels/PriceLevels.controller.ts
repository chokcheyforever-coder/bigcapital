import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import {
  AssignPriceLevelDto,
  CreatePriceLevelDto,
  EditPriceLevelDto,
  GetPriceLevelsQueryDto,
  PriceLevelSalesReportQueryDto,
  ResolvePricesDto,
} from './dtos/PriceLevel.dto';
import { PriceLevelCommandsService } from './commands/PriceLevelCommands.service';
import { PriceLevelQueriesService } from './queries/PriceLevelQueries.service';
import { PriceLevelSheetService } from './commands/PriceLevelSheet.service';
import { MAX_IMPORT_BYTES } from '@/modules/Budgeting/commands/BudgetSheet.service';
import { PriceLevelAction } from './PriceLevels.types';

const importUpload = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new BadRequestException('Upload a .csv or .xlsx file.'), ok);
  },
};

@Controller('price-levels')
@ApiTags('Price levels')
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class PriceLevelsController {
  constructor(
    private readonly commands: PriceLevelCommandsService,
    private readonly queries: PriceLevelQueriesService,
    private readonly sheets: PriceLevelSheetService,
  ) {}

  @Get()
  @RequirePermission(PriceLevelAction.View, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Retrieves the price levels (active ones by default).' })
  getPriceLevels(@Query() filter: GetPriceLevelsQueryDto) {
    return this.queries.getPriceLevels(filter);
  }

  /**
   * Rates for document lines. Anyone who can create sales or purchase
   * documents needs it, so it only requires being signed in to the company.
   */
  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Calculates the rates of document lines under a price level (or the contact\'s default one).' })
  resolve(@Body() dto: ResolvePricesDto) {
    return this.queries.resolve(dto);
  }

  @Get('reports/sales')
  @RequirePermission(PriceLevelAction.View, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Sales by price level: normal vs charged amounts per level, customer and item.' })
  salesReport(@Query() query: PriceLevelSalesReportQueryDto) {
    return this.queries.salesReport(query);
  }

  @Get(':id')
  @RequirePermission(PriceLevelAction.View, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Retrieves a price level with its item prices and categories.' })
  @ApiResponse({ status: 404, description: 'The price level was not found.' })
  getPriceLevel(@Param('id', ParseIntPipe) id: number) {
    return this.queries.getPriceLevel(id);
  }

  @Post()
  @RequirePermission(PriceLevelAction.Create, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Creates a price level.' })
  async createPriceLevel(@Body() dto: CreatePriceLevelDto) {
    const level = await this.commands.createPriceLevel(dto);
    return this.queries.getPriceLevel(level.id);
  }

  @Put(':id')
  @RequirePermission(PriceLevelAction.Edit, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Edits a price level (also deactivates or reactivates it through `active`).' })
  async editPriceLevel(@Param('id', ParseIntPipe) id: number, @Body() dto: EditPriceLevelDto) {
    await this.commands.editPriceLevel(id, dto);
    return this.queries.getPriceLevel(id);
  }

  @Get(':id/export')
  @RequirePermission(PriceLevelAction.View, AbilitySubject.PriceLevel)
  @ApiQuery({ name: 'format', enum: ['xlsx', 'csv'], required: false })
  @ApiOperation({ summary: 'Downloads a per-item level\'s prices as Excel or CSV (every item with an empty price when it has none yet).' })
  async exportPrices(@Param('id', ParseIntPipe) id: number, @Query('format') format: string, @Res() res: Response) {
    const file = await this.sheets.exportLevel(id, format === 'csv' ? 'csv' : 'xlsx');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`);
    res.send(file.body);
  }

  @Post(':id/import')
  @HttpCode(200)
  @RequirePermission(PriceLevelAction.Edit, AbilitySubject.PriceLevel)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Replaces a per-item level\'s prices from an Excel/CSV file: all rows or none.' })
  @UseInterceptors(FileInterceptor('file', importUpload))
  importPrices(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the file as "file".');
    return this.sheets.importLevel(id, file.buffer);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission(PriceLevelAction.Edit, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Makes this the default price level of the given customers or vendors.' })
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPriceLevelDto) {
    return this.commands.assign(id, dto);
  }

  @Delete(':id')
  @RequirePermission(PriceLevelAction.Delete, AbilitySubject.PriceLevel)
  @ApiOperation({ summary: 'Deletes a price level that nothing uses.' })
  async deletePriceLevel(@Param('id', ParseIntPipe) id: number) {
    await this.commands.deletePriceLevel(id);
    return { id, message: 'The price level has been deleted.' };
  }
}

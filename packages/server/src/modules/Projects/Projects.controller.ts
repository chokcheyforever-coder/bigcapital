import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { ApiCommonHeaders } from '@/common/decorators/ApiCommonHeaders';
import { RequirePermission } from '@/modules/Roles/RequirePermission.decorator';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { CreateProjectDto, EditProjectDto, GetProjectsQueryDto } from './dtos/Project.dto';
import { ProjectResponseDto } from './dtos/ProjectResponse.dto';
import { ProjectCommandsService } from './commands/ProjectCommands.service';
import { GetProjectsService } from './queries/GetProjects.service';
import { ProjectAction } from './Projects.types';

@Controller('projects')
@ApiTags('Projects')
@ApiExtraModels(ProjectResponseDto)
@ApiCommonHeaders()
@UseGuards(AuthorizationGuard, PermissionGuard)
export class ProjectsController {
  constructor(
    private readonly commands: ProjectCommandsService,
    private readonly queries: GetProjectsService,
  ) {}

  @Get()
  @RequirePermission(ProjectAction.View, AbilitySubject.Project)
  @ApiOperation({ summary: 'Retrieves the projects.' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: { $ref: getSchemaPath(ProjectResponseDto) } } })
  getProjects(@Query() filter: GetProjectsQueryDto) {
    return this.queries.getProjects(filter);
  }

  @Get(':id')
  @RequirePermission(ProjectAction.View, AbilitySubject.Project)
  @ApiOperation({ summary: 'Retrieves the project details.' })
  @ApiResponse({ status: 200, schema: { $ref: getSchemaPath(ProjectResponseDto) } })
  @ApiResponse({ status: 404, description: 'The project was not found.' })
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.queries.getProject(id);
  }

  @Post()
  @RequirePermission(ProjectAction.Create, AbilitySubject.Project)
  @ApiOperation({ summary: 'Creates a project.' })
  @ApiResponse({ status: 201, schema: { $ref: getSchemaPath(ProjectResponseDto) } })
  async createProject(@Body() dto: CreateProjectDto) {
    const project = await this.commands.createProject(dto);
    return this.queries.getProject(project.id);
  }

  @Put(':id')
  @RequirePermission(ProjectAction.Edit, AbilitySubject.Project)
  @ApiOperation({ summary: 'Edits the project (also closes or reopens it through `status`).' })
  @ApiResponse({ status: 200, schema: { $ref: getSchemaPath(ProjectResponseDto) } })
  async editProject(@Param('id', ParseIntPipe) id: number, @Body() dto: EditProjectDto) {
    await this.commands.editProject(id, dto);
    return this.queries.getProject(id);
  }

  @Delete(':id')
  @RequirePermission(ProjectAction.Delete, AbilitySubject.Project)
  @ApiOperation({ summary: 'Deletes a project that no transaction uses.' })
  @ApiResponse({ status: 200 })
  async deleteProject(@Param('id', ParseIntPipe) id: number) {
    await this.commands.deleteProject(id);
    return { id, message: 'The project has been deleted.' };
  }
}

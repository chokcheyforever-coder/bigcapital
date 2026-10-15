import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { pick } from 'lodash';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AuditLogService } from '@/modules/AuditLogs/AuditLog.service';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { Project } from '../models/Project.model';
import { CreateProjectDto, EditProjectDto } from '../dtos/Project.dto';
import { ProjectStatus } from '../Projects.types';
import { ProjectValidator } from './ProjectValidator.service';

const FIELDS = ['name', 'code', 'description', 'contactId', 'startDate', 'deadline', 'status'] as const;

const toModel = (dto: CreateProjectDto) => ({
  name: dto.name.trim(),
  code: dto.code?.trim() || null,
  description: dto.description?.trim() || null,
  contactId: dto.contactId ?? null,
  startDate: dto.startDate ?? null,
  deadline: dto.deadline ?? null,
  status: dto.status ?? ProjectStatus.Active,
});

@Injectable()
export class ProjectCommandsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly validator: ProjectValidator,
    private readonly auditLog: AuditLogService,

    @Inject(Project.name)
    private readonly projectModel: TenantModelProxy<typeof Project>,
  ) {}

  createProject(dto: CreateProjectDto): Promise<Project> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const data = toModel(dto);
      await this.validator.validateCodeUnique(data.code, undefined, trx);
      await this.validator.validateCustomer(data.contactId, trx);

      const project = await this.projectModel().query(trx).insertAndFetch(data);
      await this.auditLog.record({
        action: 'created',
        subject: AbilitySubject.Project,
        subjectId: project.id,
        metadata: { after: pick(project, FIELDS) },
        trx,
      });
      return project;
    });
  }

  editProject(projectId: number, dto: EditProjectDto): Promise<Project> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const old = await this.validator.getOrThrow(projectId, trx);
      const data = toModel(dto);
      await this.validator.validateCodeUnique(data.code, projectId, trx);
      await this.validator.validateCustomer(data.contactId, trx);

      const project = await this.projectModel().query(trx).patchAndFetchById(projectId, data);
      await this.auditLog.record({
        action: 'edited',
        subject: AbilitySubject.Project,
        subjectId: projectId,
        metadata: { before: pick(old, FIELDS), after: pick(project, FIELDS) },
        trx,
      });
      return project;
    });
  }

  deleteProject(projectId: number): Promise<void> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const old = await this.validator.getOrThrow(projectId, trx);
      await this.validator.validateNotUsed(projectId, trx);

      await this.projectModel().query(trx).deleteById(projectId);
      await this.auditLog.record({
        action: 'deleted',
        subject: AbilitySubject.Project,
        subjectId: projectId,
        metadata: { before: pick(old, FIELDS) },
        trx,
      });
    });
  }
}

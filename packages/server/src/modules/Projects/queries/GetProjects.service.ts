import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Project } from '../models/Project.model';
import { GetProjectsQueryDto } from '../dtos/Project.dto';
import { ProjectValidator } from '../commands/ProjectValidator.service';

const date = (d: Date | string | null) => (d ? moment(d).format('YYYY-MM-DD') : null);

export const toProjectResponse = (p: Project & { customer?: { displayName?: string } | null }) => ({
  id: p.id,
  name: p.name,
  code: p.code ?? null,
  description: p.description ?? null,
  contactId: p.contactId ?? null,
  customerName: p.customer?.displayName ?? null,
  startDate: date(p.startDate),
  deadline: date(p.deadline),
  status: p.isClosed ? 'closed' : 'active',
  createdAt: p.createdAt,
});

@Injectable()
export class GetProjectsService {
  constructor(
    private readonly validator: ProjectValidator,

    @Inject(Project.name)
    private readonly projectModel: TenantModelProxy<typeof Project>,
  ) {}

  async getProjects(filter: GetProjectsQueryDto) {
    const query = this.projectModel().query().withGraphFetched('customer').orderBy('name');
    if (filter.status === 'active') query.modify('active');
    if (filter.status === 'closed') query.modify('closed');
    if (filter.search?.trim()) query.modify('search', filter.search.trim());

    const projects = await query;
    return projects.map(toProjectResponse);
  }

  async getProject(projectId: number) {
    await this.validator.getOrThrow(projectId);
    const project = await this.projectModel().query().findById(projectId).withGraphFetched('customer');
    return toProjectResponse(project);
  }
}

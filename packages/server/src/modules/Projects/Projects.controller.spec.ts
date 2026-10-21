import { GUARDS_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSION_KEY } from '@/modules/Roles/RequirePermission.decorator';
import { AuthorizationGuard } from '@/modules/Roles/Authorization.guard';
import { PermissionGuard } from '@/modules/Roles/Permission.guard';
import { AbilitySubject } from '@/modules/Roles/Roles.types';
import { ProjectsController } from './Projects.controller';
import { ProjectAction } from './Projects.types';

/** Every project endpoint requires a Project permission (security review, Phase 7). */
describe('ProjectsController permissions', () => {
  const expected: Record<string, ProjectAction> = {
    getProjects: ProjectAction.View,
    getProject: ProjectAction.View,
    createProject: ProjectAction.Create,
    editProject: ProjectAction.Edit,
    deleteProject: ProjectAction.Delete,
  };

  it('guards the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ProjectsController)).toEqual([AuthorizationGuard, PermissionGuard]);
  });

  it('declares the right permission on every route', () => {
    const routes = Object.getOwnPropertyNames(ProjectsController.prototype).filter((n) => n !== 'constructor');
    expect(routes.sort()).toEqual(Object.keys(expected).sort());
    for (const route of routes) {
      const permission = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ProjectsController.prototype[route]);
      expect({ route, permission }).toEqual({ route, permission: { ability: expected[route], subject: AbilitySubject.Project } });
    }
  });
});

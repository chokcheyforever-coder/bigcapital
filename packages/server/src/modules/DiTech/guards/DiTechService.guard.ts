import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ditechConfig, safeEqual } from '../DiTech.config';

/** Protects /api/ditech/* internal routes with the per-cell service token. */
@Injectable()
export class DiTechServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { serviceToken } = ditechConfig();
    const header: string = context.switchToHttp().getRequest().headers['authorization'] ?? '';
    const [scheme, token] = header.split(' ');
    if (!serviceToken || scheme !== 'Bearer' || !token || !safeEqual(token, serviceToken)) {
      throw new UnauthorizedException('Invalid service token.');
    }
    return true;
  }
}

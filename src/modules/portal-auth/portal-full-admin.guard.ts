import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PortalAuthedRequest } from './portal-auth.guard';

@Injectable()
export class PortalFullAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PortalAuthedRequest>();

    if (req.portalRole !== 'admin') {
      throw new ForbiddenException('full admin access required');
    }

    return true;
  }
}

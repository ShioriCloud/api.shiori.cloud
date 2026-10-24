import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PortalAuthService } from './portal-auth.service';

export type PortalAuthedRequest = {
  portalToken: string;
  portalTelegramUserId: string;
  portalRole: 'admin' | 'moderator';
};

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      PortalAuthedRequest & {
        headers: Record<string, string | string[] | undefined>;
      }
    >();

    const rawToken = req.headers['x-portal-token'];
    const token = String(
      Array.isArray(rawToken) ? rawToken[0] : (rawToken ?? ''),
    ).trim();

    const session = await this.portalAuthService.verifySession(token);
    if (!session) {
      throw new UnauthorizedException('authentication required');
    }

    req.portalToken = token;
    req.portalTelegramUserId = String(session.user_id);
    req.portalRole = session.role as 'admin' | 'moderator';
    return true;
  }
}

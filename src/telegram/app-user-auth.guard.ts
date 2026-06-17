import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppUserAuthService } from './app-user-auth.service';

export type AppUserAuthedRequest = {
  telegramUserId: number;
  authMethod: 'telegram' | 'session';
};

@Injectable()
export class AppUserAuthGuard implements CanActivate {
  constructor(private readonly appUserAuthService: AppUserAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      AppUserAuthedRequest & {
        headers: Record<string, string | string[] | undefined>;
      }
    >();

    const resolved = await this.appUserAuthService.resolveAuth(req.headers);
    if (!resolved) {
      throw new UnauthorizedException('authentication required');
    }

    req.telegramUserId = resolved.telegramUserId;
    req.authMethod = resolved.authMethod;
    return true;
  }
}

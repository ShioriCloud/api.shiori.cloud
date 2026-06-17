import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CronAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const cronSecret = this.config.get<string>('cron.secret')?.trim();
    if (!cronSecret) {
      throw new ServiceUnavailableException('CRON_SECRET not configured');
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const headerSecret = String(req.headers['x-cron-secret'] ?? '').trim();
    if (headerSecret && headerSecret === cronSecret) return true;

    const auth = String(req.headers['authorization'] ?? '').trim();
    if (auth === `Bearer ${cronSecret}`) return true;

    throw new UnauthorizedException('Unauthorized');
  }
}

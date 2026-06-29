import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BotAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('bot.apiToken')?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('BOT_API_TOKEN not configured');
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const token = String(req.headers['x-bot-token'] ?? '').trim();
    if (!token || token !== expected) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}

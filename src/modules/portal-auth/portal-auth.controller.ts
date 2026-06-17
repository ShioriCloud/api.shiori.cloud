import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalLoginDto } from './portal-auth.dto';
import { PortalAuthService } from './portal-auth.service';

@ApiTags('Portal Auth')
@Controller('portal-auth')
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Admin portal login (admin/moderator only)' })
  login(@Body() body: PortalLoginDto) {
    return this.portalAuthService.login(body);
  }

  @Get('session')
  @ApiOperation({ summary: 'Verify admin portal session' })
  async session(@Headers('x-portal-token') token?: string) {
    const session = await this.portalAuthService.verifySession(
      String(token ?? '').trim(),
    );
    if (!session) {
      throw new UnauthorizedException('invalid session');
    }
    return session;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout admin portal session' })
  async logout(@Headers('x-portal-token') token?: string) {
    await this.portalAuthService.logout(String(token ?? '').trim());
    return { ok: true };
  }
}


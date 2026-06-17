import {

  Body,

  Controller,

  Get,

  Headers,

  Post,

  Query,

  UnauthorizedException,

} from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {

  AppLoginDto,

  AppRegisterDto,

  CompleteTelegramLinkDto,

  LinkTelegramCredentialsDto,

  LinkTelegramStartDto,

} from './app-auth.dto';

import { AppAuthService } from './app-auth.service';



@ApiTags('App Auth')

@Controller('app-auth')

export class AppAuthController {

  constructor(private readonly appAuthService: AppAuthService) {}



  @Post('register')

  @ApiOperation({ summary: 'Register web app user (email + password)' })

  register(@Body() body: AppRegisterDto) {

    return this.appAuthService.register(body);

  }



  @Post('login')

  @ApiOperation({ summary: 'Login web app user' })

  login(@Body() body: AppLoginDto) {

    return this.appAuthService.login(body);

  }



  @Post('logout')

  @ApiOperation({ summary: 'Logout web session' })

  async logout(@Headers('x-app-session-token') token?: string) {

    await this.appAuthService.logout(String(token ?? '').trim());

    return { ok: true };

  }



  @Get('session')

  @ApiOperation({ summary: 'Verify web session' })

  async session(@Headers('x-app-session-token') token?: string) {

    const session = await this.appAuthService.verifySession(

      String(token ?? '').trim(),

    );

    if (!session) {

      throw new UnauthorizedException('invalid session');

    }

    return session;

  }



  @Post('link-telegram/start')

  @ApiOperation({ summary: 'Start web → Telegram account link flow' })

  startTelegramLink(

    @Headers('x-app-session-token') token: string | undefined,

    @Body() body: LinkTelegramStartDto,

  ) {

    const sessionToken = String(token ?? '').trim();

    if (!sessionToken) {

      throw new UnauthorizedException('web session required');

    }

    return this.appAuthService.startTelegramLink(sessionToken, body);

  }



  @Get('link-telegram/status')

  @ApiOperation({ summary: 'Poll Telegram link token status' })

  telegramLinkStatus(@Query('token') token?: string) {

    return this.appAuthService.getTelegramLinkStatus(String(token ?? ''));

  }



  @Post('link-telegram/complete')

  @ApiOperation({ summary: 'Complete web → Telegram link from mini-app' })

  completeTelegramLink(

    @Headers('x-telegram-init-data') initData: string | undefined,

    @Body() body: CompleteTelegramLinkDto,

  ) {

    return this.appAuthService.completeTelegramLink(initData, body);

  }



  @Post('link-telegram')

  @ApiOperation({ summary: 'Merge web account into Telegram via email + password' })

  linkTelegramWithCredentials(

    @Headers('x-telegram-init-data') initData: string | undefined,

    @Body() body: LinkTelegramCredentialsDto,

  ) {

    return this.appAuthService.linkTelegramWithCredentials(initData, body);

  }

}


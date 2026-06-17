import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserPortalSession } from '../../entities';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalAuthService } from './portal-auth.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser, UserPortalSession])],
  controllers: [PortalAuthController],
  providers: [PortalAuthService, PortalAuthGuard],
  exports: [PortalAuthService, PortalAuthGuard],
})
export class PortalAuthModule {}
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HomeBlock } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { HomeAdminController } from './home-admin.controller';
import { HomeAdminService } from './home-admin.service';

@Module({
  imports: [PortalAuthModule, TypeOrmModule.forFeature([HomeBlock])],
  controllers: [HomeAdminController],
  providers: [HomeAdminService],
})
export class HomeAdminModule {}

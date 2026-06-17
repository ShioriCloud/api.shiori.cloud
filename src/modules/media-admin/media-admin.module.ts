import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAsset } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { MediaAdminController, MediaPublicController } from './media-admin.controller';
import { MediaAdminService } from './media-admin.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  imports: [PortalAuthModule, TypeOrmModule.forFeature([MediaAsset])],
  controllers: [MediaAdminController, MediaPublicController],
  providers: [MediaAdminService, MediaStorageService],
  exports: [MediaAdminService],
})
export class MediaAdminModule {}

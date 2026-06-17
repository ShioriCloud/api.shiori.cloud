import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotFile, FilePack, FilePackItem } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { FilesAdminController } from './files-admin.controller';
import { FilesAdminService } from './files-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    TypeOrmModule.forFeature([BotFile, FilePack, FilePackItem]),
  ],
  controllers: [FilesAdminController],
  providers: [FilesAdminService],
})
export class FilesAdminModule {}

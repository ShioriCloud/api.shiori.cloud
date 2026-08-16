import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BootQuote } from '../../entities/boot-quote.entity';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { BootQuotesAdminController } from './boot-quotes-admin.controller';
import { BootQuotesAdminService } from './boot-quotes-admin.service';

@Module({
  imports: [PortalAuthModule, TypeOrmModule.forFeature([BootQuote])],
  controllers: [BootQuotesAdminController],
  providers: [BootQuotesAdminService],
  exports: [BootQuotesAdminService],
})
export class BootQuotesAdminModule {}

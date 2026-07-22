import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HomeBlock } from '../../entities';
import { AnimeCatalogModule } from '../anime-catalog/anime-catalog.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [TypeOrmModule.forFeature([HomeBlock]), AnimeCatalogModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}

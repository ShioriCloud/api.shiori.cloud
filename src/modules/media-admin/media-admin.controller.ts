import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { PortalAuthGuard, type PortalAuthedRequest } from '../portal-auth/portal-auth.guard';
import { ListMediaQueryDto, UpdateMediaDto } from './media-admin.dto';
import { MediaAdminService } from './media-admin.service';
import { MediaStorageService } from './media-storage.service';

@ApiTags('Media Admin')
@Controller('media-admin')
@UseGuards(PortalAuthGuard)
export class MediaAdminController {
  constructor(private readonly mediaAdminService: MediaAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List uploaded media assets' })
  list(@Query() query: ListMediaQueryDto) {
    return this.mediaAdminService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get media asset by id' })
  getById(@Param('id') id: string) {
    return this.mediaAdminService.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Upload image to media library' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string | undefined,
    @Req() req: PortalAuthedRequest,
  ) {
    return this.mediaAdminService.upload(file, req.portalTelegramUserId, name);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update media metadata' })
  update(@Param('id') id: string, @Body() body: UpdateMediaDto) {
    return this.mediaAdminService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete media asset' })
  async remove(@Param('id') id: string) {
    await this.mediaAdminService.delete(id);
    return { ok: true };
  }
}

@ApiTags('Media')
@Controller('media')
export class MediaPublicController {
  constructor(
    private readonly mediaAdminService: MediaAdminService,
    private readonly storage: MediaStorageService,
  ) {}

  @Get('serve/:id')
  @ApiOperation({ summary: 'Serve uploaded media file (public)' })
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async serve(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const asset = await this.mediaAdminService.getEntityForServe(id);
    res.setHeader('Content-Type', asset.mimetype);
    if (asset.originalName) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(asset.originalName)}"`,
      );
    }

    return new StreamableFile(this.storage.createReadStream(asset.storagePath));
  }
}

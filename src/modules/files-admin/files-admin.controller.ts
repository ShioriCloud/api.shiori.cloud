import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import {
  AddFilePackItemDto,
  AddFilePackItemsBulkDto,
  FilePickerKeysQueryDto,
  FilePickerRecentQueryDto,
  FilePickerSearchBodyDto,
  FilePickerSearchQueryDto,
  ListFilesStatsQueryDto,
  ListBotFilesQueryDto,
  PatchBotFileMetadataDto,
  ReorderFilePackItemsDto,
  UpdatePackItemSortDto,
  UpsertFilePackDto,
} from './files-admin.dto';
import { FilesAdminService } from './files-admin.service';

@ApiTags('Files Admin')
@Controller('files-admin')
@UseGuards(PortalAuthGuard)
export class FilesAdminController {
  constructor(private readonly filesAdminService: FilesAdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Files download overview stats' })
  overview() {
    return this.filesAdminService.getDownloadOverview();
  }

  @Get('stats/export')
  @ApiOperation({ summary: 'Export filtered file download stats as CSV' })
  async exportStats(@Query() query: ListFilesStatsQueryDto) {
    const csv = await this.filesAdminService.exportDownloadStatsCsv(query);
    return { csv };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Paginated file download stats' })
  stats(@Query() query: ListFilesStatsQueryDto) {
    return this.filesAdminService.listDownloadStats(query);
  }

  @Get('files')
  @ApiOperation({ summary: 'Paginated bot file library with references' })
  listBotFiles(@Query() query: ListBotFilesQueryDto) {
    return this.filesAdminService.listBotFiles(query);
  }

  @Get('files/:key/references')
  @ApiOperation({ summary: 'Catalog and pack references for a bot file key' })
  fileReferences(@Param('key') key: string) {
    return this.filesAdminService.getFileReferences(decodeURIComponent(key));
  }

  @Get('files/:key')
  @ApiOperation({ summary: 'Bot file detail by key' })
  getBotFile(@Param('key') key: string) {
    return this.filesAdminService.getBotFileByKey(decodeURIComponent(key));
  }

  @Patch('files/:key/deactivate')
  @ApiOperation({ summary: 'Soft-deactivate a bot file' })
  deactivateBotFile(@Param('key') key: string) {
    return this.filesAdminService.deactivateBotFile(decodeURIComponent(key));
  }

  @Patch('files/:key/reactivate')
  @ApiOperation({ summary: 'Reactivate a bot file' })
  reactivateBotFile(@Param('key') key: string) {
    return this.filesAdminService.reactivateBotFile(decodeURIComponent(key));
  }

  @Patch('files/:key')
  @ApiOperation({ summary: 'Update bot file metadata (display name, caption)' })
  patchBotFile(
    @Param('key') key: string,
    @Body() body: PatchBotFileMetadataDto,
  ) {
    return this.filesAdminService.patchBotFileMetadata(decodeURIComponent(key), body);
  }

  @Get('picker/search')
  pickerSearch(@Query() query: FilePickerSearchQueryDto) {
    return this.filesAdminService.searchPicker(query);
  }

  @Post('picker/search')
  @ApiOperation({ summary: 'Search files for picker (POST — use when matchAnyTerms is large)' })
  pickerSearchPost(@Body() body: FilePickerSearchBodyDto) {
    return this.filesAdminService.searchPicker(body);
  }

  @Get('picker/recent')
  pickerRecent(@Query() query: FilePickerRecentQueryDto) {
    return this.filesAdminService.getRecentPicker(query);
  }

  @Get('picker/by-keys')
  pickerByKeys(@Query() query: FilePickerKeysQueryDto) {
    return this.filesAdminService.getPickerByKeys(query.keys);
  }

  @Get('picker/:key')
  pickerOne(@Param('key') key: string) {
    return this.filesAdminService.getPickerByKey(decodeURIComponent(key));
  }

  @Get('packs')
  listPacks() {
    return this.filesAdminService.listPacks();
  }

  @Post('packs')
  upsertPack(@Body() body: UpsertFilePackDto) {
    return this.filesAdminService.upsertPack(body);
  }

  @Delete('packs/:id')
  async deletePack(@Param('id') id: string) {
    await this.filesAdminService.deletePack(id);
    return { ok: true };
  }

  @Get('packs/:id/items')
  listPackItems(@Param('id') id: string) {
    return this.filesAdminService.listPackItems(id);
  }

  @Post('packs/:id/items')
  async addPackItem(@Param('id') id: string, @Body() body: AddFilePackItemDto) {
    await this.filesAdminService.addPackItem(id, body);
    return { ok: true };
  }

  @Post('packs/:id/items/bulk')
  @ApiOperation({ summary: 'Add multiple files to a pack (skips duplicates)' })
  async addPackItemsBulk(@Param('id') id: string, @Body() body: AddFilePackItemsBulkDto) {
    return this.filesAdminService.addPackItemsBulk(id, body.file_keys ?? []);
  }

  @Delete('packs/:packId/items/:fileKey')
  async removePackItem(
    @Param('packId') packId: string,
    @Param('fileKey') fileKey: string,
  ) {
    await this.filesAdminService.removePackItem(
      packId,
      decodeURIComponent(fileKey),
    );
    return { ok: true };
  }

  @Put('packs/:packId/items/:fileKey/sort')
  async updatePackItemSort(
    @Param('packId') packId: string,
    @Param('fileKey') fileKey: string,
    @Body() body: UpdatePackItemSortDto,
  ) {
    await this.filesAdminService.updatePackItemSort(
      packId,
      decodeURIComponent(fileKey),
      body.sort_order,
    );
    return { ok: true };
  }

  @Put('packs/:id/items/reorder')
  async reorderPackItems(
    @Param('id') id: string,
    @Body() body: ReorderFilePackItemsDto,
  ) {
    await this.filesAdminService.reorderPackItems(id, body);
    return { ok: true };
  }
}

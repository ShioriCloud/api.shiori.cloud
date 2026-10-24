import { NotFoundException } from '@nestjs/common';

import { Test, TestingModule } from '@nestjs/testing';

import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { BotFile, BotSetting, FilePack, FilePackItem } from '../../entities';

import { BotService } from './bot.service';

describe('BotService', () => {
  let service: BotService;

  let filesRepo: jest.Mocked<
    Pick<Repository<BotFile>, 'findOne' | 'create' | 'save'>
  >;

  beforeEach(async () => {
    filesRepo = {
      findOne: jest.fn(),

      create: jest.fn(),

      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,

        { provide: getRepositoryToken(BotFile), useValue: filesRepo },

        { provide: getRepositoryToken(FilePack), useValue: {} },

        { provide: getRepositoryToken(FilePackItem), useValue: {} },

        { provide: getRepositoryToken(BotSetting), useValue: {} },

        { provide: DataSource, useValue: { query: jest.fn() } },
      ],
    }).compile();

    service = module.get(BotService);
  });

  it('returns mapped DTO for active file', async () => {
    filesRepo.findOne.mockResolvedValue({
      key: '482391056',

      messageId: '12345',

      type: 'document',

      fileId: 'BQACAgEAAxk',

      fileName: 'episode.mkv',

      caption: 'test',

      isActive: true,
    } as BotFile);

    await expect(service.getArchiveLinkByCode('482391056')).resolves.toEqual({
      ok: true,

      data: {
        id: '482391056',

        code: '482391056',

        title: 'episode.mkv',

        type: 'document',

        telegramFileId: 'BQACAgEAAxk',

        archiveMessageId: 12345,

        caption: 'test',
      },
    });
  });

  it('throws 404 when file is missing', async () => {
    filesRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getArchiveLinkByCode('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 404 when file is inactive', async () => {
    filesRepo.findOne.mockResolvedValue({
      key: '482391056',

      isActive: false,
    } as BotFile);

    await expect(
      service.getArchiveLinkByCode('482391056'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('health returns ok', () => {
    expect(service.health()).toEqual({ ok: true });
  });
});

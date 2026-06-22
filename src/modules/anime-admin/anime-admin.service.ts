import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeries,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeStudioLink,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
} from '../../entities';

type Payload = Record<string, unknown>;

@Injectable()
export class AnimeAdminService {
  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeEpisode) private readonly episodeRepo: Repository<AnimeEpisode>,
    @InjectRepository(AnimeGenre) private readonly genreRepo: Repository<AnimeGenre>,
    @InjectRepository(AnimeGenreLink) private readonly genreLinkRepo: Repository<AnimeGenreLink>,
    @InjectRepository(AnimeStudio) private readonly studioRepo: Repository<AnimeStudio>,
    @InjectRepository(AnimeStudioLink) private readonly studioLinkRepo: Repository<AnimeStudioLink>,
    @InjectRepository(AnimeSubtitle) private readonly subtitleRepo: Repository<AnimeSubtitle>,
    @InjectRepository(AnimeSubtitlePack) private readonly subtitlePackRepo: Repository<AnimeSubtitlePack>,
    @InjectRepository(AnimeSeries) private readonly seriesRepo: Repository<AnimeSeries>,
    @InjectRepository(AnimeSeriesMember) private readonly seriesMemberRepo: Repository<AnimeSeriesMember>,
    @InjectRepository(AnimeTranslator) private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink) private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
  ) {}

  private pick<T>(body: Payload, snake: string, camel: string): T | undefined {
    if (body[snake] !== undefined) return body[snake] as T;
    if (body[camel] !== undefined) return body[camel] as T;
    return undefined;
  }

  private numOrNull(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private toGenre(g: AnimeGenre) {
    return { id: g.id, slug: g.slug, name_en: g.nameEn, name_fa: g.nameFa };
  }

  private toStudio(s: AnimeStudio) {
    return { id: s.id, slug: s.slug, name: s.name };
  }

  private toTranslator(t: AnimeTranslator) {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      avatar_url: t.avatarUrl,
      cover_url: t.coverUrl,
      bio: t.bio,
      experience: t.experience,
      is_active: t.isActive,
    };
  }

  private toAnimeCard(anime: Anime, genres: AnimeGenre[] = []) {
    return {
      id: anime.id,
      title: anime.title,
      title_romaji: anime.titleRomaji,
      image: anime.coverImage ?? '',
      featuredImage: anime.featuredImage ?? '',
      description: anime.synopsis ?? '',
      format: anime.format ?? undefined,
      status: anime.airingStatus ?? '',
      airing_status: anime.airingStatus ?? undefined,
      genres: genres.map((g) => ({
        slug: g.slug,
        name_en: g.nameEn ?? undefined,
        name_fa: g.nameFa ?? undefined,
      })),
      episodes_count: anime.episodesCount ?? undefined,
      studio: anime.studio ?? undefined,
      season: anime.season ?? undefined,
      year: anime.year ?? undefined,
      startDate: anime.startDate ?? undefined,
      endDate: anime.endDate ?? undefined,
      isFeatured: anime.isFeatured,
      averageScore: this.numOrNull(anime.averageScore) ?? undefined,
      malScore: this.numOrNull(anime.malScore) ?? undefined,
      imdbScore: this.numOrNull(anime.imdbScore) ?? undefined,
      anilist_id: anime.anilistId ?? undefined,
      mal_id: anime.malId ?? undefined,
      imdb_id: anime.imdbId ?? undefined,
    };
  }

  private toAnimeAdminRow(anime: Anime) {
    const editor = anime.lastEditedBy;
    return {
      id: anime.id,
      title: anime.title,
      title_romaji: anime.titleRomaji,
      synopsis: anime.synopsis,
      format: anime.format,
      season: anime.season,
      year: anime.year,
      anilist_id: anime.anilistId,
      mal_id: anime.malId,
      imdb_id: anime.imdbId,
      mal_score: this.numOrNull(anime.malScore),
      imdb_score: this.numOrNull(anime.imdbScore),
      featured_image: anime.featuredImage,
      cover_image: anime.coverImage,
      is_featured: anime.isFeatured,
      airing_status: anime.airingStatus,
      average_score: this.numOrNull(anime.averageScore),
      episodes_count: anime.episodesCount,
      studio: anime.studio,
      start_date: anime.startDate,
      end_date: anime.endDate,
      episode_pack_title: anime.episodePackTitle,
      episode_pack_link: anime.episodePackLink,
      updated_at: anime.updatedAt?.toISOString?.() ?? null,
      last_edited_by: anime.lastEditedById ? Number(anime.lastEditedById) : null,
      last_editor: editor
        ? {
            first_name: editor.firstName ?? null,
            last_name: editor.lastName ?? null,
            email: editor.email ?? null,
            username: editor.username ?? null,
          }
        : null,
      prev_anime_id: anime.prevAnimeId,
      next_anime_id: anime.nextAnimeId,
    };
  }

  private applyAnimeFields(anime: Anime, body: Payload) {
    const assign = <K extends keyof Anime>(key: K, val: Anime[K] | undefined) => {
      if (val !== undefined) anime[key] = val;
    };

    assign('title', this.pick<string>(body, 'title', 'title'));
    assign('titleRomaji', this.pick<string | null>(body, 'title_romaji', 'titleRomaji'));
    assign('coverImage', this.pick<string | null>(body, 'cover_image', 'coverImage'));
    assign('featuredImage', this.pick<string | null>(body, 'featured_image', 'featuredImage'));
    assign('synopsis', this.pick<string | null>(body, 'synopsis', 'synopsis'));
    assign('format', this.pick<string | null>(body, 'format', 'format'));
    assign('airingStatus', this.pick<string | null>(body, 'airing_status', 'airingStatus'));
    assign('season', this.pick<string | null>(body, 'season', 'season'));
    assign('year', this.pick<number | null>(body, 'year', 'year'));
    assign('episodesCount', this.pick<number | null>(body, 'episodes_count', 'episodesCount'));
    assign('studio', this.pick<string | null>(body, 'studio', 'studio'));
    assign('isFeatured', this.pick<boolean>(body, 'is_featured', 'isFeatured'));
    assign('anilistId', this.pick<number | null>(body, 'anilist_id', 'anilistId'));
    assign('malId', this.pick<number | null>(body, 'mal_id', 'malId'));
    assign('imdbId', this.pick<string | null>(body, 'imdb_id', 'imdbId'));
    assign('startDate', this.pick<string | null>(body, 'start_date', 'startDate'));
    assign('endDate', this.pick<string | null>(body, 'end_date', 'endDate'));
    assign('episodePackTitle', this.pick<string | null>(body, 'episode_pack_title', 'episodePackTitle'));
    assign('episodePackLink', this.pick<string | null>(body, 'episode_pack_link', 'episodePackLink'));
    assign('prevAnimeId', this.pick<string | null>(body, 'prev_anime_id', 'prevAnimeId'));
    assign('nextAnimeId', this.pick<string | null>(body, 'next_anime_id', 'nextAnimeId'));

    const malScore = this.pick<number | string | null>(body, 'mal_score', 'malScore');
    if (malScore !== undefined) anime.malScore = malScore == null ? null : String(malScore);
    const imdbScore = this.pick<number | string | null>(body, 'imdb_score', 'imdbScore');
    if (imdbScore !== undefined) anime.imdbScore = imdbScore == null ? null : String(imdbScore);
    const averageScore = this.pick<number | string | null>(body, 'average_score', 'averageScore');
    if (averageScore !== undefined) anime.averageScore = averageScore == null ? null : String(averageScore);

    return anime;
  }

  private async loadGenresByAnimeIds(animeIds: string[]): Promise<Map<string, AnimeGenre[]>> {
    const map = new Map<string, AnimeGenre[]>();
    if (animeIds.length === 0) return map;
    const links = await this.genreLinkRepo.find({
      where: { animeId: In(animeIds) },
      relations: { genre: true },
    });
    for (const link of links) {
      const list = map.get(link.animeId) ?? [];
      if (link.genre) list.push(link.genre);
      map.set(link.animeId, list);
    }
    return map;
  }

  private async replaceGenreSlugs(animeId: string, slugs: string[]) {
    await this.genreLinkRepo.delete({ animeId });
    if (slugs.length === 0) return;
    const genres = await this.genreRepo.find({ where: { slug: In(slugs) } });
    const links = genres.map((g) => this.genreLinkRepo.create({ animeId, genreId: g.id }));
    if (links.length > 0) await this.genreLinkRepo.save(links);
  }

  private async replaceStudioSlugs(animeId: string, slugs: string[]) {
    await this.studioLinkRepo.delete({ animeId });
    if (slugs.length === 0) return;
    const studios = await this.studioRepo.find({ where: { slug: In(slugs) } });
    const links = studios.map((s) => this.studioLinkRepo.create({ animeId, studioId: s.id }));
    if (links.length > 0) await this.studioLinkRepo.save(links);
  }

  private async requireAnime(id: string) {
    const anime = await this.animeRepo.findOne({ where: { id } });
    if (!anime) throw new NotFoundException('Anime not found');
    return anime;
  }

  async getAnimeIdsWithEpisodes() {
    const rows = await this.episodeRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.anime_id', 'animeId')
      .getRawMany<{ animeId: string }>();
    return rows.map((r) => r.animeId);
  }

  async listAnime(params?: {
    search?: string;
    page?: number;
    limit?: number;
    filter?: 'all' | 'has-episodes' | 'no-episodes' | 'featured';
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
    const qb = this.animeRepo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (params?.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      qb.andWhere('(a.title ILIKE :q OR a.title_romaji ILIKE :q)', { q });
    }
    const filter = params?.filter ?? 'all';
    if (filter === 'featured') {
      qb.andWhere('a.is_featured = true');
    } else if (filter === 'has-episodes') {
      qb.andWhere('EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id)');
    } else if (filter === 'no-episodes') {
      qb.andWhere('NOT EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id)');
    }
    const [rows, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    const genreMap = await this.loadGenresByAnimeIds(rows.map((r) => r.id));
    const hasEpisodeIds = await this.loadAnimeIdsWithEpisodes(rows.map((r) => r.id));
    return {
      items: rows.map((row) => ({
        ...this.toAnimeCard(row, genreMap.get(row.id) ?? []),
        has_episodes: hasEpisodeIds.has(row.id),
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getAnimeListStats() {
    const total = await this.animeRepo.count();
    const featured = await this.animeRepo.count({ where: { isFeatured: true } });
    const withEpisodesRaw = await this.episodeRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.anime_id)', 'count')
      .getRawOne<{ count: string }>();
    const withEpisodes = Number(withEpisodesRaw?.count ?? 0);
    return {
      total,
      featured,
      withEpisodes,
      withoutEpisodes: Math.max(0, total - withEpisodes),
    };
  }

  private async loadAnimeIdsWithEpisodes(animeIds: string[]): Promise<Set<string>> {
    if (animeIds.length === 0) return new Set();
    const rows = await this.episodeRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.anime_id', 'animeId')
      .where('e.anime_id IN (:...animeIds)', { animeIds })
      .getRawMany<{ animeId: string }>();
    return new Set(rows.map((r) => r.animeId));
  }

  async getAnimeAdmin(id: string) {
    const anime = await this.animeRepo.findOne({
      where: { id },
      relations: { lastEditedBy: true },
    });
    if (!anime) throw new NotFoundException('Anime not found');
    return this.toAnimeAdminRow(anime);
  }

  async createAnime(body: Payload, editorId?: string) {
    const title = this.pick<string>(body, 'title', 'title');
    if (!title?.trim()) throw new BadRequestException('title is required');
    const anime = this.applyAnimeFields(
      this.animeRepo.create({ title: title.trim(), isFeatured: false }),
      body,
    );
    if (editorId) {
      anime.lastEditedById = editorId;
      anime.updatedAt = new Date();
    }
    const saved = await this.animeRepo.save(anime);
    const genreSlugs = this.pick<string[]>(body, 'genre_slugs', 'genreSlugs');
    if (genreSlugs) await this.replaceGenreSlugs(saved.id, genreSlugs);
    const studioSlugs = this.pick<string[]>(body, 'studio_slugs', 'studioSlugs');
    if (studioSlugs) await this.replaceStudioSlugs(saved.id, studioSlugs);
    return this.getAnimeAdmin(saved.id);
  }

  async updateAnime(id: string, body: Payload, editorId?: string) {
    const anime = await this.requireAnime(id);
    this.applyAnimeFields(anime, body);
    if (editorId) {
      anime.lastEditedById = editorId;
      anime.updatedAt = new Date();
    }
    await this.animeRepo.save(anime);
    const genreSlugs = this.pick<string[]>(body, 'genre_slugs', 'genreSlugs');
    if (genreSlugs) await this.replaceGenreSlugs(id, genreSlugs);
    const studioSlugs = this.pick<string[]>(body, 'studio_slugs', 'studioSlugs');
    if (studioSlugs) await this.replaceStudioSlugs(id, studioSlugs);
    return this.getAnimeAdmin(id);
  }

  async upsertAnime(body: Payload, editorId?: string) {
    const id = this.pick<string>(body, 'id', 'id');
    if (id) return this.updateAnime(String(id), body, editorId);
    return this.createAnime(body, editorId);
  }

  async getAnimeGenreSlugs(animeId: string) {
    await this.requireAnime(animeId);
    const links = await this.genreLinkRepo.find({
      where: { animeId },
      relations: { genre: true },
    });
    return links.map((l) => l.genre?.slug).filter(Boolean) as string[];
  }

  async getAnimeStudioSlugs(animeId: string) {
    await this.requireAnime(animeId);
    const links = await this.studioLinkRepo.find({
      where: { animeId },
      relations: { studio: true },
    });
    return links.map((l) => l.studio?.slug).filter(Boolean) as string[];
  }

  async listEpisodes(animeId: string) {
    await this.requireAnime(animeId);
    const episodes = await this.episodeRepo.find({
      where: { animeId },
      order: { episodeNumber: 'ASC' },
    });
    return episodes.map((e) => ({
      id: e.id,
      episode_number: e.episodeNumber ?? 0,
      title: e.title,
      download_link: e.downloadLink,
    }));
  }

  async insertEpisode(body: Payload) {
    const animeId = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    await this.requireAnime(animeId);
    const episode = this.episodeRepo.create({
      animeId,
      episodeNumber: Number(this.pick(body, 'episode_number', 'episodeNumber') ?? 0),
      title: (this.pick<string | null>(body, 'title', 'title') ?? null),
      downloadLink: (this.pick<string | null>(body, 'download_link', 'downloadLink') ?? null),
    });
    const saved = await this.episodeRepo.save(episode);
    return {
      id: saved.id,
      episode_number: saved.episodeNumber ?? 0,
      title: saved.title,
      download_link: saved.downloadLink,
    };
  }

  async insertEpisodesBatch(animeId: string, episodes: Payload[]) {
    await this.requireAnime(animeId);
    const created = [];
    for (const ep of episodes) {
      created.push(await this.insertEpisode({ ...ep, anime_id: animeId }));
    }
    return created;
  }

  async updateEpisode(id: string, body: Payload) {
    const episode = await this.episodeRepo.findOne({ where: { id } });
    if (!episode) throw new NotFoundException('Episode not found');
    const epNum = this.pick<number>(body, 'episode_number', 'episodeNumber');
    if (epNum !== undefined) episode.episodeNumber = epNum;
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) episode.title = title;
    const link = this.pick<string | null>(body, 'download_link', 'downloadLink');
    if (link !== undefined) episode.downloadLink = link;
    const saved = await this.episodeRepo.save(episode);
    return {
      id: saved.id,
      episode_number: saved.episodeNumber ?? 0,
      title: saved.title,
      download_link: saved.downloadLink,
    };
  }

  async deleteEpisode(id: string) {
    const episode = await this.episodeRepo.findOne({ where: { id } });
    if (!episode) throw new NotFoundException('Episode not found');
    await this.episodeRepo.remove(episode);
  }

  async updateEpisodePack(animeId: string, body: Payload) {
    const anime = await this.requireAnime(animeId);
    anime.episodePackTitle = this.pick<string | null>(body, 'episode_pack_title', 'episodePackTitle') ?? null;
    anime.episodePackLink = this.pick<string | null>(body, 'episode_pack_link', 'episodePackLink') ?? null;
    await this.animeRepo.save(anime);
  }

  async listGenres(search?: string) {
    const qb = this.genreRepo.createQueryBuilder('g').orderBy('g.slug', 'ASC');
    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      qb.where(
        'LOWER(g.slug) LIKE :term OR LOWER(g.name_en) LIKE :term OR LOWER(g.name_fa) LIKE :term',
        { term },
      );
    }
    return (await qb.getMany()).map((g) => this.toGenre(g));
  }

  async upsertGenre(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const genre = await this.genreRepo.findOne({ where: { id } });
      if (!genre) throw new NotFoundException('Genre not found');
      const slug = body.slug !== undefined ? String(body.slug).trim() : genre.slug;
      if (!slug) throw new BadRequestException('slug is required');
      genre.slug = slug;
      if (body.name_en !== undefined || body.nameEn !== undefined) {
        genre.nameEn = (body.name_en as string) ?? (body.nameEn as string) ?? null;
      }
      if (body.name_fa !== undefined || body.nameFa !== undefined) {
        genre.nameFa = (body.name_fa as string) ?? (body.nameFa as string) ?? null;
      }
      return this.toGenre(await this.genreRepo.save(genre));
    }
    const slug = String(body.slug ?? '').trim();
    if (!slug) throw new BadRequestException('slug is required');
    const genre = this.genreRepo.create({
      slug,
      nameEn: (body.name_en as string) ?? (body.nameEn as string) ?? null,
      nameFa: (body.name_fa as string) ?? (body.nameFa as string) ?? null,
    });
    return this.toGenre(await this.genreRepo.save(genre));
  }

  async deleteGenre(payload: { id?: string; slug?: string }) {
    if (!payload.id && !payload.slug) throw new BadRequestException('id or slug required');
    const genre = payload.id
      ? await this.genreRepo.findOne({ where: { id: payload.id } })
      : await this.genreRepo.findOne({ where: { slug: String(payload.slug) } });
    if (!genre) throw new NotFoundException('Genre not found');
    await this.genreRepo.remove(genre);
  }

  async listStudios(search?: string) {
    const qb = this.studioRepo.createQueryBuilder('s').orderBy('s.slug', 'ASC');
    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      qb.where('LOWER(s.slug) LIKE :term OR LOWER(s.name) LIKE :term', { term });
    }
    return (await qb.getMany()).map((s) => this.toStudio(s));
  }

  async upsertStudio(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const studio = await this.studioRepo.findOne({ where: { id } });
      if (!studio) throw new NotFoundException('Studio not found');
      if (body.slug !== undefined) studio.slug = String(body.slug).trim();
      if (body.name !== undefined) studio.name = String(body.name).trim();
      return this.toStudio(await this.studioRepo.save(studio));
    }
    const slug = String(body.slug ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!slug || !name) throw new BadRequestException('slug and name are required');
    return this.toStudio(await this.studioRepo.save(this.studioRepo.create({ slug, name })));
  }

  async deleteStudio(id: string) {
    const studio = await this.studioRepo.findOne({ where: { id } });
    if (!studio) throw new NotFoundException('Studio not found');
    await this.studioRepo.remove(studio);
  }

  async replaceAnimeStudios(animeId: string, slugs: string[]) {
    await this.requireAnime(animeId);
    await this.replaceStudioSlugs(animeId, slugs);
  }

  async listTranslators(search?: string) {
    const qb = this.translatorRepo.createQueryBuilder('t').orderBy('t.slug', 'ASC');
    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      qb.where('LOWER(t.slug) LIKE :term OR LOWER(t.name) LIKE :term', { term });
    }
    return (await qb.getMany()).map((t) => this.toTranslator(t));
  }

  async upsertTranslator(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const t = await this.translatorRepo.findOne({ where: { id } });
      if (!t) throw new NotFoundException('Translator not found');
      if (body.slug !== undefined) t.slug = String(body.slug).trim();
      if (body.name !== undefined) t.name = String(body.name).trim();
      if (body.avatar_url !== undefined || body.avatarUrl !== undefined) {
        t.avatarUrl = (body.avatar_url as string) ?? (body.avatarUrl as string) ?? null;
      }
      if (body.cover_url !== undefined || body.coverUrl !== undefined) {
        t.coverUrl = (body.cover_url as string) ?? (body.coverUrl as string) ?? null;
      }
      if (body.bio !== undefined) t.bio = (body.bio as string) ?? null;
      if (body.experience !== undefined) t.experience = (body.experience as string) ?? null;
      if (body.is_active !== undefined) t.isActive = Boolean(body.is_active);
      if (body.isActive !== undefined) t.isActive = Boolean(body.isActive);
      return this.toTranslator(await this.translatorRepo.save(t));
    }
    const slug = String(body.slug ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!slug || !name) throw new BadRequestException('slug and name are required');
    const t = this.translatorRepo.create({
      slug,
      name,
      avatarUrl: (body.avatar_url as string) ?? null,
      coverUrl: (body.cover_url as string) ?? null,
      bio: (body.bio as string) ?? null,
      experience: (body.experience as string) ?? null,
      isActive: body.is_active !== undefined ? Boolean(body.is_active) : true,
    });
    return this.toTranslator(await this.translatorRepo.save(t));
  }

  async deleteTranslator(id: string) {
    const t = await this.translatorRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Translator not found');
    await this.translatorRepo.remove(t);
  }

  async listSubtitles(animeId: string) {
    await this.requireAnime(animeId);
    const rows = await this.subtitleRepo.find({
      where: { animeId },
      order: { episodeNumber: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.id,
      episode_number: s.episodeNumber,
      title: s.title,
      subtitle_link: s.subtitleLink,
    }));
  }

  async insertSubtitle(body: Payload) {
    const animeId = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    await this.requireAnime(animeId);
    const saved = await this.subtitleRepo.save(
      this.subtitleRepo.create({
        animeId,
        episodeNumber: Number(this.pick(body, 'episode_number', 'episodeNumber') ?? 0),
        title: (this.pick<string | null>(body, 'title', 'title') ?? null),
        subtitleLink: (this.pick<string | null>(body, 'subtitle_link', 'subtitleLink') ?? null),
      }),
    );
    return {
      id: saved.id,
      episode_number: saved.episodeNumber,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async updateSubtitle(id: string, body: Payload) {
    const sub = await this.subtitleRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Subtitle not found');
    const epNum = this.pick<number>(body, 'episode_number', 'episodeNumber');
    if (epNum !== undefined) sub.episodeNumber = epNum;
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) sub.title = title;
    const link = this.pick<string | null>(body, 'subtitle_link', 'subtitleLink');
    if (link !== undefined) sub.subtitleLink = link;
    const saved = await this.subtitleRepo.save(sub);
    return {
      id: saved.id,
      episode_number: saved.episodeNumber,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async deleteSubtitle(id: string) {
    const sub = await this.subtitleRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Subtitle not found');
    await this.subtitleRepo.remove(sub);
  }

  async listSubtitlePacks(animeId: string) {
    await this.requireAnime(animeId);
    const packs = await this.subtitlePackRepo.find({
      where: { animeId },
      order: { id: 'ASC' },
    });
    return packs.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle_link: p.subtitleLink,
    }));
  }

  async insertSubtitlePack(body: Payload) {
    const animeId = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    await this.requireAnime(animeId);
    const saved = await this.subtitlePackRepo.save(
      this.subtitlePackRepo.create({
        animeId,
        title: (this.pick<string | null>(body, 'title', 'title') ?? null),
        subtitleLink: (this.pick<string | null>(body, 'subtitle_link', 'subtitleLink') ?? null),
      }),
    );
    return {
      id: saved.id,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async updateSubtitlePack(id: string, body: Payload) {
    const pack = await this.subtitlePackRepo.findOne({ where: { id } });
    if (!pack) throw new NotFoundException('Subtitle pack not found');
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) pack.title = title;
    const link = this.pick<string | null>(body, 'subtitle_link', 'subtitleLink');
    if (link !== undefined) pack.subtitleLink = link;
    const saved = await this.subtitlePackRepo.save(pack);
    return {
      id: saved.id,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async deleteSubtitlePack(id: string) {
    const pack = await this.subtitlePackRepo.findOne({ where: { id } });
    if (!pack) throw new NotFoundException('Subtitle pack not found');
    await this.subtitlePackRepo.remove(pack);
  }

  async listTranslatorLinks(animeId: string) {
    await this.requireAnime(animeId);
    const links = await this.translatorLinkRepo.find({
      where: { animeId },
      relations: { translator: true },
    });
    return links.map((l) => ({
      id: l.id,
      anime_id: l.animeId,
      translator_id: l.translatorId,
      role: l.role,
      translator: l.translator ? this.toTranslator(l.translator) : null,
    }));
  }

  async insertTranslatorLink(body: Payload) {
    const animeId = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    const translatorId = String(this.pick<string>(body, 'translator_id', 'translatorId') ?? '');
    await this.requireAnime(animeId);
    const saved = await this.translatorLinkRepo.save(
      this.translatorLinkRepo.create({
        animeId,
        translatorId,
        role: (this.pick<string | null>(body, 'role', 'role') ?? null),
      }),
    );
    return { id: saved.id };
  }

  async updateTranslatorLink(id: string, body: Payload) {
    const link = await this.translatorLinkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Translator link not found');
    const role = this.pick<string | null>(body, 'role', 'role');
    if (role !== undefined) link.role = role;
    await this.translatorLinkRepo.save(link);
  }

  async deleteTranslatorLink(id: string) {
    const link = await this.translatorLinkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Translator link not found');
    await this.translatorLinkRepo.remove(link);
  }

  async getSeriesDraft(animeId: string) {
    await this.requireAnime(animeId);
    const member = await this.seriesMemberRepo.findOne({
      where: { animeId },
      relations: { series: true },
    });
    if (!member?.series) {
      return { series_id: null, title: '', members: [] };
    }
    const members = await this.seriesMemberRepo.find({
      where: { seriesId: member.seriesId },
      order: { sortOrder: 'ASC' },
    });
    return {
      series_id: member.seriesId,
      title: member.series.title,
      members: members.map((m) => ({
        anime_id: m.animeId,
        sort_order: m.sortOrder,
        label_fa: m.labelFa,
      })),
    };
  }

  async saveSeries(animeId: string, body: Payload) {
    await this.requireAnime(animeId);
    const seriesId = this.pick<string | null>(body, 'series_id', 'seriesId');
    const title = String(this.pick(body, 'title', 'title') ?? '');
    const members = (this.pick<Payload[]>(body, 'members', 'members') ?? []) as Payload[];

    if (!seriesId && members.length === 0) {
      const existing = await this.seriesMemberRepo.findOne({ where: { animeId } });
      if (existing) {
        const sid = existing.seriesId;
        await this.seriesMemberRepo.delete({ seriesId: sid });
        const remaining = await this.seriesMemberRepo.count({ where: { seriesId: sid } });
        if (remaining === 0) await this.seriesRepo.delete({ id: sid });
      }
      return this.getSeriesDraft(animeId);
    }

    let series: AnimeSeries;
    if (seriesId) {
      const found = await this.seriesRepo.findOne({ where: { id: seriesId } });
      if (!found) throw new NotFoundException('Series not found');
      series = found;
      series.title = title;
      await this.seriesRepo.save(series);
      await this.seriesMemberRepo.delete({ seriesId: series.id });
    } else {
      series = await this.seriesRepo.save(this.seriesRepo.create({ title }));
    }

    const entities = members.map((m) =>
      this.seriesMemberRepo.create({
        seriesId: series.id,
        animeId: String(m.anime_id ?? m.animeId),
        sortOrder: Number(m.sort_order ?? m.sortOrder ?? 0),
        labelFa: (m.label_fa as string) ?? (m.labelFa as string) ?? null,
      }),
    );
    if (entities.length > 0) await this.seriesMemberRepo.save(entities);
    return this.getSeriesDraft(animeId);
  }
}

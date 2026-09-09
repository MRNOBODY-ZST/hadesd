export type ContentType = 'POST' | 'PROJECT' | 'RESEARCH' | 'PAGE';
export type Theme = 'amber' | 'green' | 'paper';
export type CrtLevel = 'off' | 'low' | 'full';
export interface RevisionInput { title: string; slug: string; summary: string; markdown: string; tags: string[]; language: string; coverMediaId?: string | null; }
export interface Revision extends RevisionInput { id: string; contentId: string; createdAt: string; }
export interface Content { id: string; type: ContentType; version: number; createdAt: string; latestRevision: Revision; }
export interface PublicContent extends RevisionInput { id: string; type: ContentType; revisionId: string; route: string; publishedAt: string; updatedAt: string; }
export interface SiteSettings { title: string; tagline: string; introduction: string; homeText: string; navigation: { label: string; href: string }[]; links: { label: string; url: string; description?: string }[]; }
export interface ReleaseSnapshot { releaseId: string; createdAt: string; site: SiteSettings; contents: PublicContent[]; }
export interface ReleaseInfo { state: 'EMPTY' | 'ACTIVE'; releaseId: string | null; createdAt?: string; }
export type JobStatus = 'QUEUED' | 'BUILDING' | 'READY' | 'DEPLOYING' | 'SUCCEEDED' | 'FAILED';
export interface PublishJob { id: string; releaseId: string; operation: 'PUBLISH' | 'WITHDRAW' | 'ROLLBACK' | 'INITIALIZE' | 'SETTINGS'; status: JobStatus; createdAt: string; attempts: number; error?: string | null; leaseToken?: string | null; }
export interface PublishRequest { operation: PublishJob['operation']; contentId?: string; revisionId?: string; releaseId?: string; }
export interface Release { id: string; createdAt: string; status: string; }
export interface Media { id: string; filename: string; mime: string; size: number; createdAt: string; }
export interface UserAccount { id: string; username: string; displayName: string; role: 'ADMIN' | 'USER'; }
export interface BlogComment { id: string; contentId: string; parentId: string | null; body: string; author: UserAccount; attachments: Media[]; createdAt: string; updatedAt: string; }
export interface CommentInput { body: string; parentId?: string; attachmentIds?: string[]; }
export interface Page<T> { items: T[]; page: number; size: number; total: number; }
export interface Problem { type: string; title: string; status: number; detail: string; code: string; requestId: string; }
export interface VfsNode { id: string; kind: 'directory' | 'file'; path: string; route: string; title: string; summary: string; updatedAt?: string; tags: string[]; contentId?: string; }
export const DEFAULT_SITE: SiteSettings = { title: 'HADESD', tagline: 'a personal daemon.', introduction: 'Hades', homeText: '记录研究、工程与思考。让好奇心持续运行。', navigation: [{label:'文章',href:'/posts'},{label:'项目',href:'/projects'},{label:'研究',href:'/research'},{label:'关于',href:'/about'}], links: [] };
export const EMPTY_SNAPSHOT: ReleaseSnapshot = { releaseId: 'empty', createdAt: '', site: DEFAULT_SITE, contents: [] };
export function contentRoute(type: ContentType, slug: string): string { return type === 'PAGE' ? `/${slug}` : `/${({POST:'posts',PROJECT:'projects',RESEARCH:'research'})[type]}/${slug}`; }

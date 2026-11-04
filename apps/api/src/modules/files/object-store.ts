import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config.js';
import type { Signer } from '../../common/signing.js';

export type Bucket = 'quarantine' | 'attachments';

/** S3-compatible object storage (AWS S3 / MinIO), or the local filesystem for dev and tests. */
export interface ObjectStore {
  put(bucket: Bucket, key: string, body: Readable | Buffer, contentType?: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Readable>;
  delete(bucket: Bucket, key: string): Promise<void>;
  /** Short-lived URL that forces download (`Content-Disposition: attachment`). */
  signedDownloadUrl(
    bucket: Bucket,
    key: string,
    fileName: string,
    ttlSeconds: number,
  ): Promise<string>;
}

const contentDisposition = (fileName: string) =>
  `attachment; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
export { contentDisposition };

export class FsObjectStore implements ObjectStore {
  private readonly root: string;
  constructor(
    root: string,
    private readonly signer: Signer,
    private readonly publicApiUrl: string,
  ) {
    this.root = resolve(root);
  }
  path(bucket: Bucket, key: string): string {
    const p = resolve(join(this.root, bucket, key));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid object key');
    return p;
  }
  async put(bucket: Bucket, key: string, body: Readable | Buffer): Promise<void> {
    const p = this.path(bucket, key);
    await mkdir(dirname(p), { recursive: true });
    if (Buffer.isBuffer(body))
      await pipeline(async function* () {
        yield body;
      }, createWriteStream(p));
    else await pipeline(body, createWriteStream(p));
  }
  async get(bucket: Bucket, key: string): Promise<Readable> {
    const p = this.path(bucket, key);
    await stat(p);
    return createReadStream(p);
  }
  async delete(bucket: Bucket, key: string): Promise<void> {
    await rm(this.path(bucket, key), { force: true });
  }
  async signedDownloadUrl(
    bucket: Bucket,
    key: string,
    fileName: string,
    ttl: number,
  ): Promise<string> {
    const t = this.signer.sign({ b: bucket, k: key, f: fileName }, ttl);
    return `${this.publicApiUrl}/api/v1/files/${t}`;
  }
}

export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;
  /** Separate client so presigned URLs carry the browser-facing host (signature covers the host). */
  private readonly signer: S3Client;
  constructor(private readonly cfg: AppConfig) {
    const client = (endpoint: string | undefined) =>
      new S3Client({
        region: cfg.S3_REGION,
        endpoint,
        forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
        credentials: cfg.S3_ACCESS_KEY
          ? { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY ?? '' }
          : undefined,
      });
    this.s3 = client(cfg.S3_ENDPOINT);
    this.signer = cfg.S3_PUBLIC_ENDPOINT ? client(cfg.S3_PUBLIC_ENDPOINT) : this.s3;
  }

  /** Creates the quarantine and attachment buckets if they do not exist. */
  async ensureBuckets(): Promise<void> {
    for (const b of [this.cfg.S3_BUCKET_QUARANTINE, this.cfg.S3_BUCKET_ATTACHMENTS]) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: b }));
      } catch {
        await this.s3.send(new CreateBucketCommand({ Bucket: b }));
      }
    }
  }
  private name(b: Bucket) {
    return b === 'quarantine' ? this.cfg.S3_BUCKET_QUARANTINE : this.cfg.S3_BUCKET_ATTACHMENTS;
  }
  async put(
    bucket: Bucket,
    key: string,
    body: Readable | Buffer,
    contentType?: string,
  ): Promise<void> {
    await new Upload({
      client: this.s3,
      params: {
        Bucket: this.name(bucket),
        Key: key,
        Body: body,
        ContentType: contentType ?? 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      },
    }).done();
  }
  async get(bucket: Bucket, key: string): Promise<Readable> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.name(bucket), Key: key }));
    return r.Body as Readable;
  }
  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.name(bucket), Key: key }));
  }
  async signedDownloadUrl(
    bucket: Bucket,
    key: string,
    fileName: string,
    ttl: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.name(bucket),
        Key: key,
        ResponseContentDisposition: contentDisposition(fileName),
        ResponseContentType: 'application/octet-stream',
      }),
      { expiresIn: ttl },
    );
  }
}

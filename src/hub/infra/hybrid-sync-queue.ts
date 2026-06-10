import { JobsOptions, Queue, Worker } from 'bullmq';
import { InMemorySyncQueue, SyncJob, SyncQueue } from '../sync/stock-sync-engine';

export class HybridSyncQueue implements SyncQueue {
  private readonly fallbackQueue = new InMemorySyncQueue();
  private readonly bullQueue?: Queue;
  private readonly connection?: { host: string; port: number; password?: string; username?: string; tls?: Record<string, never> };
  private worker?: Worker;

  constructor(private readonly queueName = 'hub-stock-sync') {
    if (process.env.HUB_REDIS_URL) {
      this.connection = this.createConnectionFromUrl(process.env.HUB_REDIS_URL);
      this.bullQueue = new Queue(queueName, {
        connection: this.connection,
        defaultJobOptions: this.getDefaultJobOptions()
      });
    }
  }

  isBullMqEnabled(): boolean {
    return Boolean(this.bullQueue);
  }

  async publish(job: SyncJob): Promise<void> {
    if (this.bullQueue) {
      await this.bullQueue.add('sync-stock', job, this.getDefaultJobOptions());
      return;
    }

    await this.fallbackQueue.publish(job);
  }

  async start(handler: (job: SyncJob) => Promise<void>): Promise<void> {
    if (this.bullQueue && this.connection) {
      this.worker = new Worker(
        this.queueName,
        async (job) => handler(job.data as SyncJob),
        { connection: this.connection }
      );
      return;
    }

    this.fallbackQueue.subscribe(handler);
  }

  private getDefaultJobOptions(): JobsOptions {
    return {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 3000
      },
      removeOnComplete: 500,
      removeOnFail: 2000
    };
  }

  private createConnectionFromUrl(redisUrl: string) {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined
    };
  }
}
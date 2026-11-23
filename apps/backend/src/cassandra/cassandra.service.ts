import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Client, types } from 'cassandra-driver';
import { APP_CONFIG, type AppConfig } from '../config/config';

const CONNECT_ATTEMPTS = 10;
const CONNECT_DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class CassandraService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Cassandra');
  private _client!: Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** za paging, `executeConcurrent` i batch */
  get client(): Client {
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    const { contactPoints, localDataCenter, keyspace } = this.config.cassandra;

    let lastError: unknown;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
      // novi client po pokušaju: posle neuspelog connect() stari nije pouzdan
      const client = new Client({
        contactPoints,
        localDataCenter,
        keyspace,
        queryOptions: {
          // rf=1 u razvoju, pa local_one; u produkciji sa rf=3 prebaciti na local_quorum
          consistency: types.consistencies.localOne,
          prepare: true,
        },
      });
      try {
        // otvara konekcije i učitava keyspace
        await client.connect();
        this._client = client;
        this.logger.log(
          `povezan na ${contactPoints.join(',')} (dc=${localDataCenter}, keyspace=${keyspace})`,
        );
        return;
      } catch (err) {
        lastError = err;
        await client.shutdown().catch(() => undefined);
        this.logger.warn(
          `pokušaj ${attempt}/${CONNECT_ATTEMPTS} neuspešan: ${(err as Error).message}`,
        );
        if (attempt < CONNECT_ATTEMPTS) await sleep(CONNECT_DELAY_MS);
      }
    }
    throw new Error(
      `Ne mogu da se povežem na Cassandru (${contactPoints.join(',')}, keyspace "${keyspace}") posle ${CONNECT_ATTEMPTS} pokušaja: ${(lastError as Error)?.message}. ` +
        'Proveri da je cassandra-init završio i da keyspace postoji.',
    );
  }

  /** izvršava upit kao prepared statement */
  execute(
    query: string,
    params: unknown[] | Record<string, unknown> = [],
    options: { prepare?: boolean; fetchSize?: number } = {},
  ) {
    return this._client.execute(query, params, { prepare: true, ...options });
  }

  /** zatvara konekcije pri gašenju */
  async onApplicationShutdown(): Promise<void> {
    await this._client?.shutdown();
  }
}

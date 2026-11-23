import { Client } from 'cassandra-driver';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * integracioni testovi rade nad posebnim keyspace-om (podrazumevano `pixelboard_test`),
 * da ne zagađuju razvojne podatke; pri svakom pokretanju se pravi iznova iz schema.cql.
 */
export default async function globalSetup(): Promise<void> {
  const keyspace = process.env.INT_CASSANDRA_KEYSPACE ?? 'pixelboard_test';
  if (keyspace === 'pixelboard') {
    throw new Error(
      'INT_CASSANDRA_KEYSPACE ne sme biti razvojni keyspace "pixelboard"',
    );
  }
  const contactPoints = (
    process.env.CASSANDRA_CONTACT_POINTS ?? 'localhost'
  ).split(',');
  const localDataCenter = process.env.CASSANDRA_DC ?? 'datacenter1';

  // šema bez komentara, razdvojena po ';'; USE se preskače, keyspace se menja
  const schema = readFileSync(
    join(__dirname, '..', '..', '..', 'infra', 'cassandra', 'schema.cql'),
    'utf8',
  )
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^USE\b/i.test(s))
    .map((s) =>
      s.replace(
        /CREATE KEYSPACE IF NOT EXISTS pixelboard\b/i,
        `CREATE KEYSPACE IF NOT EXISTS ${keyspace}`,
      ),
    );

  const admin = new Client({ contactPoints, localDataCenter });
  await admin.connect();
  try {
    // test keyspace se pravi iznova
    await admin.execute(`DROP KEYSPACE IF EXISTS ${keyspace}`);
    await admin.execute(statements[0]);
  } finally {
    await admin.shutdown();
  }

  const client = new Client({ contactPoints, localDataCenter, keyspace });
  await client.connect();
  try {
    for (const statement of statements.slice(1)) {
      await client.execute(statement);
    }
  } finally {
    await client.shutdown();
  }
}

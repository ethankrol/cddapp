import type { CachedHealthRecord, HealthDataRemoteStore } from './aws-sync-service.ts';
import { MeasurementServiceError } from '../measurement/errors.ts';

/** Injection contract for an AWS Lambda/API endpoint or approved DynamoDB client boundary. */
export interface DynamoDbWriter { readonly writeHealthRecords: (tableName: string, records: readonly CachedHealthRecord[], signal?: AbortSignal) => Promise<void> }
export interface DynamoDbConfiguration { readonly tableName: string }

export function createDynamoDbRemoteStore(writer: DynamoDbWriter, configuration: DynamoDbConfiguration): HealthDataRemoteStore {
  if (!configuration.tableName.trim()) throw new RangeError('A provisioned DynamoDB table name is required.');
  return {
    async putBatch(records, signal) {
      if (signal?.aborted) throw new MeasurementServiceError({ stage: 'storage', code: 'SYNC_FAILED', message: 'DynamoDB write was cancelled.', retryable: true });
      await writer.writeHealthRecords(configuration.tableName, records, signal);
    },
  };
}

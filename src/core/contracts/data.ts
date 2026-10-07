/**
 * Data source contracts — ground truth for verification.
 */

import type { DataSourceKind } from '../constants/index.js';
import type {
  BalanceSnapshot,
  BetResponseSnapshot,
  DataSourcePayload,
  HistoryEntry,
  ObservableWaitOptions,
  SessionSnapshot,
  WalletSnapshot,
} from '../models/index.js';

export interface IDataSource<K extends DataSourceKind = DataSourceKind> {
  readonly kind: K;
  read(options?: ObservableWaitOptions): Promise<DataSourcePayload<K>>;
}

export interface IBetResponseDataSource extends IDataSource<'betResponse'> {
  read(options?: ObservableWaitOptions): Promise<BetResponseSnapshot>;
}

export interface IBalanceDataSource extends IDataSource<'balance'> {
  read(options?: ObservableWaitOptions): Promise<BalanceSnapshot>;
}

export interface IHistoryDataSource extends IDataSource<'history'> {
  read(options?: ObservableWaitOptions): Promise<readonly HistoryEntry[]>;
}

export interface ISessionDataSource extends IDataSource<'session'> {
  read(options?: ObservableWaitOptions): Promise<SessionSnapshot>;
}

export interface IWalletDataSource extends IDataSource<'wallet'> {
  read(options?: ObservableWaitOptions): Promise<WalletSnapshot>;
}

export interface IDataSourceRegistry {
  register<K extends DataSourceKind>(source: IDataSource<K>): void;
  get<K extends DataSourceKind>(kind: K): IDataSource<K>;
  tryGet<K extends DataSourceKind>(kind: K): IDataSource<K> | undefined;
}

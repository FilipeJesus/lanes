/**
 * Platform-agnostic configuration provider interface.
 * Abstracts reading extension configuration values.
 */

import { IDisposable } from './IDisposable';

export interface IConfigProvider {
    get<T>(section: string, key: string, defaultValue: T): T;
    onDidChange(section: string, callback: () => void): IDisposable;
}

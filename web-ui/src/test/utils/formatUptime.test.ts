import { describe, it, expect } from 'vitest';
import { formatUptime } from '../../utils/formatUptime';

describe('formatUptime', () => {
    describe('seconds range', () => {
        it('Given 45 seconds, then returns "45s"', () => {
            expect(formatUptime(45)).toBe('45s');
        });

        it('Given 0 seconds, then returns "0s"', () => {
            expect(formatUptime(0)).toBe('0s');
        });

        it('Given 59 seconds, then returns "59s"', () => {
            expect(formatUptime(59)).toBe('59s');
        });
    });

    describe('minutes range', () => {
        it('Given 135 seconds (2m 15s), then returns "2m 15s"', () => {
            expect(formatUptime(135)).toBe('2m 15s');
        });

        it('Given exactly 60 seconds, then returns "1m 0s"', () => {
            expect(formatUptime(60)).toBe('1m 0s');
        });
    });

    describe('hours range', () => {
        it('Given 8100 seconds (2h 15m), then returns "2h 15m"', () => {
            expect(formatUptime(8100)).toBe('2h 15m');
        });

        it('Given exactly 3600 seconds, then returns "1h 0m"', () => {
            expect(formatUptime(3600)).toBe('1h 0m');
        });
    });

    describe('days range', () => {
        it('Given 277200 seconds (3d 5h), then returns "3d 5h"', () => {
            expect(formatUptime(277200)).toBe('3d 5h');
        });

        it('Given exactly 86400 seconds, then returns "1d 0h"', () => {
            expect(formatUptime(86400)).toBe('1d 0h');
        });
    });
});

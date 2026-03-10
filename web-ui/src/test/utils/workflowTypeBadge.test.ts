import { describe, it, expect } from 'vitest';
import { getWorkflowTypeBadgeClass } from '../../utils/workflowTypeBadge';

const styles = {
    typeBadgeLoop: 'loop-class',
    typeBadgeRalph: 'ralph-class',
    typeBadgeStep: 'step-class',
    typeBadgeOther: 'other-class',
};

describe('getWorkflowTypeBadgeClass', () => {
    it('Given type "loop", then it returns loop class', () => {
        expect(getWorkflowTypeBadgeClass('loop', styles)).toBe('loop-class');
    });

    it('Given type "ralph", then it returns ralph class', () => {
        expect(getWorkflowTypeBadgeClass('ralph', styles)).toBe('ralph-class');
    });

    it('Given type "step", then it returns step class', () => {
        expect(getWorkflowTypeBadgeClass('step', styles)).toBe('step-class');
    });

    it('Given unknown type, then it returns fallback class', () => {
        expect(getWorkflowTypeBadgeClass('custom', styles)).toBe('other-class');
    });

    it('Given uppercase type, then matching is case-insensitive', () => {
        expect(getWorkflowTypeBadgeClass('LOOP', styles)).toBe('loop-class');
    });
});

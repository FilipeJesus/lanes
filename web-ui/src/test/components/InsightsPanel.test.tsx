import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InsightsPanel } from '../../components/InsightsPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel(overrides: Partial<React.ComponentProps<typeof InsightsPanel>> = {}) {
    const defaults = {
        insights: '',
        analysis: undefined,
        loading: false,
        error: null,
        onGenerate: vi.fn(),
    };
    return render(<InsightsPanel {...defaults} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InsightsPanel', () => {
    it('Given an insights string, when rendered, then the insights text is visible', () => {
        renderPanel({ insights: 'Session completed 3 tasks.' });
        expect(screen.getByText('Session completed 3 tasks.')).toBeInTheDocument();
    });

    it('Given no insights (empty string), when rendered, then an empty state placeholder is shown', () => {
        renderPanel({ insights: '' });
        expect(
            screen.getByText('No insights available. Click Refresh Insights to generate them.')
        ).toBeInTheDocument();
    });

    it('Given an analysis string provided, when rendered, then analysis text is visible', () => {
        renderPanel({ insights: 'Some insights.', analysis: 'Detailed analysis here.' });
        expect(screen.getByText('Detailed analysis here.')).toBeInTheDocument();
    });

    it('Given no analysis provided, when rendered, then the analysis section is not shown', () => {
        renderPanel({ insights: 'Some insights.', analysis: undefined });
        expect(screen.queryByText(/Analysis/i, { selector: 'h3' })).not.toBeInTheDocument();
    });

    it('Given onGenerate callback provided, when Refresh Insights button is clicked, then onGenerate(false) is called', () => {
        const onGenerate = vi.fn();
        renderPanel({ onGenerate });
        fireEvent.click(screen.getByRole('button', { name: /refresh insights/i }));
        expect(onGenerate).toHaveBeenCalledOnce();
        expect(onGenerate).toHaveBeenCalledWith(false);
    });

    it('Given onGenerate callback provided, when Generate Analysis button is clicked, then onGenerate(true) is called', () => {
        const onGenerate = vi.fn();
        renderPanel({ onGenerate });
        fireEvent.click(screen.getByRole('button', { name: /generate analysis/i }));
        expect(onGenerate).toHaveBeenCalledOnce();
        expect(onGenerate).toHaveBeenCalledWith(true);
    });

    it('Given loading is true, when rendered, then buttons are disabled', () => {
        renderPanel({ loading: true });
        const refreshBtn = screen.getByRole('button', { name: /refresh insights/i });
        const analysisBtn = screen.getByRole('button', { name: /generate analysis/i });
        expect(refreshBtn).toBeDisabled();
        expect(analysisBtn).toBeDisabled();
    });

    it('Given loading is true, when rendered, then the Refresh Insights button shows Loading text', () => {
        renderPanel({ loading: true });
        expect(screen.getByRole('button', { name: /refresh insights/i })).toHaveTextContent('Loading\u2026');
    });

    it('Given an error is set, when rendered, then the error message is visible', () => {
        renderPanel({ error: new Error('Network failure') });
        expect(screen.getByRole('alert')).toHaveTextContent('Network failure');
    });
});

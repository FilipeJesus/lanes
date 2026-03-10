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

    // -------------------------------------------------------------------------
    // Critical: insights-panel-shows-spinner-when-loading
    // -------------------------------------------------------------------------

    it('Given loading=true, when InsightsPanel renders, then an element with aria-label "Loading insights" is present in the DOM', () => {
        renderPanel({ loading: true });
        expect(screen.getByLabelText('Loading insights')).toBeInTheDocument();
    });

    it('Given loading=true, when InsightsPanel renders, then no <pre> content element is rendered', () => {
        const { container } = renderPanel({ loading: true, insights: 'some insights text' });
        expect(container.querySelector('pre')).not.toBeInTheDocument();
    });

    it('Given loading=false and insights is non-empty, when InsightsPanel renders, then a <pre> element containing the insights text is rendered and the spinner is not present', () => {
        const { container } = renderPanel({ loading: false, insights: 'My insights content.' });
        expect(screen.getByText('My insights content.')).toBeInTheDocument();
        expect(container.querySelector('pre')).toBeInTheDocument();
        expect(screen.queryByLabelText('Loading insights')).not.toBeInTheDocument();
    });

    it('Given loading=false and insights is empty string, when InsightsPanel renders, then the empty-state paragraph is shown and the spinner is not present', () => {
        renderPanel({ loading: false, insights: '' });
        expect(
            screen.getByText('No insights available. Click Refresh Insights to generate them.')
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Loading insights')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Low: insights-panel-spinner-css-class-exists
    // -------------------------------------------------------------------------

    it('Given loading=true, when InsightsPanel renders, then the spinner container element has a non-empty className applied', () => {
        const { container } = renderPanel({ loading: true });
        const spinnerContainer = container.querySelector('[aria-label="Loading insights"]');
        expect(spinnerContainer).toBeInTheDocument();
        // CSS module applies a non-empty class to the container
        expect(spinnerContainer?.className).toBeTruthy();
        expect((spinnerContainer?.className ?? '').length).toBeGreaterThan(0);
    });
});

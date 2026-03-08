/**
 * InsightsPanel — displays session insights and optional deeper analysis.
 *
 * Renders insights text in a pre-formatted block (the daemon returns plain text
 * or markdown-like content). A "Generate Analysis" button triggers a deeper
 * analysis pass via the `onGenerate` callback.
 */

import styles from '../styles/InsightsPanel.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InsightsPanelProps {
    /** Insights text from the daemon */
    insights: string;
    /** Optional deeper analysis text */
    analysis?: string;
    /** True while insights are being fetched */
    loading: boolean;
    /** Error from the last fetch attempt */
    error: Error | null;
    /** Called when the user requests analysis generation */
    onGenerate: (includeAnalysis: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InsightsPanel({
    insights,
    analysis,
    loading,
    error,
    onGenerate,
}: InsightsPanelProps) {
    return (
        <div className={styles.root}>
            {/* Toolbar */}
            <div className={styles.toolbar}>
                <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => onGenerate(false)}
                    disabled={loading}
                    aria-label="Refresh insights"
                >
                    {loading ? 'Loading\u2026' : 'Refresh Insights'}
                </button>
                <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => onGenerate(true)}
                    disabled={loading}
                    aria-label="Generate analysis"
                >
                    Generate Analysis
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className={styles.errorBanner} role="alert">
                    <span className={styles.errorTitle}>Failed to load insights: </span>
                    <span className={styles.errorMessage}>{error.message}</span>
                </div>
            )}

            {/* Insights */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Insights</h3>
                {!loading && !insights ? (
                    <p className={styles.empty}>
                        No insights available. Click Refresh Insights to generate them.
                    </p>
                ) : (
                    <pre className={styles.content}>{insights}</pre>
                )}
            </div>

            {/* Analysis — only shown when available */}
            {analysis && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Analysis</h3>
                    <pre className={styles.content}>{analysis}</pre>
                </div>
            )}
        </div>
    );
}

export interface WorkflowTypeBadgeStyles {
    typeBadgeLoop: string;
    typeBadgeRalph: string;
    typeBadgeStep: string;
    typeBadgeOther: string;
}

export function getWorkflowTypeBadgeClass(
    type: string,
    styles: WorkflowTypeBadgeStyles
): string {
    switch (type.toLowerCase()) {
        case 'loop':
            return styles.typeBadgeLoop;
        case 'ralph':
            return styles.typeBadgeRalph;
        case 'step':
            return styles.typeBadgeStep;
        default:
            return styles.typeBadgeOther;
    }
}

/**
 * Platform-agnostic UI provider interface.
 * Abstracts user-facing dialogs and input prompts.
 */

export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    picked?: boolean;
}

export interface QuickPickOptions {
    placeHolder?: string;
    title?: string;
    canPickMany?: boolean;
}

export interface InputBoxOptions {
    prompt?: string;
    placeHolder?: string;
    value?: string;
    title?: string;
    validateInput?: (value: string) => string | undefined | null | Promise<string | undefined | null>;
}

export interface IUIProvider {
    showInfo(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, ...actions: string[]): Promise<string | undefined>;
    showError(message: string, ...actions: string[]): Promise<string | undefined>;
    showQuickPick<T extends QuickPickItem>(items: T[], options?: QuickPickOptions): Promise<T | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
}

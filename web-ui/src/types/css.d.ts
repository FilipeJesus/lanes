/**
 * CSS Module type declarations.
 * Allows TypeScript to recognize `*.module.css` imports as typed objects.
 */
declare module '*.module.css' {
    const classes: Record<string, string>;
    export default classes;
}

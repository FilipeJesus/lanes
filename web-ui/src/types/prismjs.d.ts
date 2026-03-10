declare module 'prismjs' {
    interface PrismGrammar {
        [name: string]: unknown;
    }

    interface PrismLanguages {
        [name: string]: PrismGrammar | undefined;
    }

    interface PrismStatic {
        languages: PrismLanguages;
        highlight(text: string, grammar: PrismGrammar, language: string): string;
    }

    const Prism: PrismStatic;
    export default Prism;
}

declare module 'prismjs/components/*';

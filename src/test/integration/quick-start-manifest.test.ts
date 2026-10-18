import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface CommandContribution {
    command: string;
    title: string;
    icon?: string;
}

interface MenuContribution {
    command: string;
    when?: string;
    group?: string;
}

interface ViewContribution {
    id: string;
    name: string;
    type?: string;
}

interface ExtensionManifest {
    contributes?: {
        commands?: CommandContribution[];
        menus?: Record<string, MenuContribution[]>;
        views?: Record<string, ViewContribution[]>;
    };
}

suite('Quick Start Manifest Integration', () => {
    let manifest: ExtensionManifest;

    setup(() => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as ExtensionManifest;
    });

    test('contributes the Quick Start command', () => {
        const command = manifest.contributes?.commands?.find(
            contribution => contribution.command === 'lanes.quickStart'
        );

        assert.deepStrictEqual(command, {
            command: 'lanes.quickStart',
            title: 'Lanes: Quick Start',
            icon: '$(rocket)',
        });
    });

    test('offers lifecycle actions for quick sessions while hiding worktree-specific actions', () => {
        const menus = manifest.contributes?.menus?.['view/item/context'] ?? [];
        for (const contextValue of ['sessionItemQuick', 'sessionItemQuickPinned']) {
            const commands = menus.filter(menu => (menu.when ?? '').split(' && ').every(clause => {
                const match = clause.match(/^viewItem (=~|==) (.+)$/);
                if (!match) { return true; }
                if (match[1] === '==') { return contextValue === match[2]; }
                return new RegExp(match[2].slice(1, -1)).test(contextValue);
            })).map(menu => menu.command);
            for (const command of ['lanes.renameSession', 'lanes.clearSession', 'lanes.deleteSession', 'lanes.createTerminal']) {
                assert.ok(commands.includes(command), `${contextValue}: ${command}`);
            }
            assert.ok(commands.includes(contextValue.endsWith('Pinned') ? 'lanes.unpinSession' : 'lanes.pinSession'));
            for (const command of ['lanes.showGitChanges', 'lanes.openWorkflowState', 'lanes.searchInWorktree']) {
                assert.ok(!commands.includes(command), `${contextValue} must omit ${command}`);
            }
        }
    });

    test('places Quick Start first in the New Session view title', () => {
        const newSessionView = manifest.contributes?.views?.['lanes-sidebar']?.find(
            view => view.id === 'lanesSessionFormView'
        );
        assert.deepStrictEqual(newSessionView, {
            type: 'webview',
            id: 'lanesSessionFormView',
            name: 'New Session',
            icon: '$(add)',
        });

        const titleItems = manifest.contributes?.menus?.['view/title'] ?? [];
        const quickStartItem = titleItems.find(item => item.command === 'lanes.quickStart');

        assert.deepStrictEqual(quickStartItem, {
            command: 'lanes.quickStart',
            when: 'view == lanesSessionFormView',
            group: 'navigation@0',
        });
        assert.strictEqual(
            titleItems.filter(item => item.when === 'view == lanesSessionFormView')[0],
            quickStartItem,
            'Quick Start should be the first title action above the New Session webview contents'
        );
    });
});
